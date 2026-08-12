/**
 * Check: the live schema is the schema the migration describes, and the
 * guarantees sync() cannot express are really there.
 *
 * ⚠️ A migration is proven by asking the database, not by the runner printing
 * "applied". Everything below reads from information_schema / pg_catalog or tries
 * a write the constraint should refuse.
 *
 * Nothing here leaves a row behind: writes happen inside a transaction that is
 * always rolled back.
 */

import assert from "node:assert/strict";

import { resolveDatabaseConfig } from "../../database/connection-config.js";
import { assertThrows } from "../lib/harness.mjs";

export default (ctx) => {
    const { config, db } = ctx;
    const target = resolveDatabaseConfig(config);

    return [
        {
            label: "the server agrees about who we are and where we are",
            fn: async () => {
                // Ask the server for identity — never assert a literal from config
                // against itself, which proves nothing.
                const [row] = await db.sequelize.query(
                    "SELECT current_user, current_database() AS db",
                    { type: db.sequelize.constructor.QueryTypes.SELECT },
                );
                assert.equal(row.current_user, target.username);
                assert.equal(row.db, target.database);
            },
        },
        {
            label: "the app role is NOT a superuser",
            fn: async () => {
                const [row] = await db.sequelize.query(
                    "SELECT rolsuper FROM pg_roles WHERE rolname = current_user",
                    { type: db.sequelize.constructor.QueryTypes.SELECT },
                );
                assert.equal(
                    row.rolsuper,
                    false,
                    "the app is connecting as a superuser — §4 says the app role is deliberately not one",
                );
            },
        },
        {
            label: "the project schema exists and the app role owns it",
            fn: async () => {
                const [row] = await db.sequelize.query(
                    `SELECT nspname, pg_get_userbyid(nspowner) AS owner
                       FROM pg_namespace WHERE nspname = :schema`,
                    {
                        replacements: { schema: target.schema },
                        type: db.sequelize.constructor.QueryTypes.SELECT,
                    },
                );
                assert.ok(row, `schema ${target.schema} does not exist — run npm run db:migrate`);
                assert.equal(
                    row.owner,
                    target.username,
                    `schema is owned by ${row.owner}, not the app role — migrations must be applied AS the app role`,
                );
            },
        },
        {
            label: "every model has a real table, owned by the app role",
            fn: async () => {
                const expected = Object.keys(db).filter((key) => /^(mst|txn|log)_/.test(key));
                assert.ok(expected.length > 0, "no models found on db");

                const rows = await db.sequelize.query(
                    `SELECT tablename, tableowner FROM pg_tables WHERE schemaname = :schema`,
                    {
                        replacements: { schema: target.schema },
                        type: db.sequelize.constructor.QueryTypes.SELECT,
                    },
                );
                const byName = new Map(rows.map((r) => [r.tablename, r.tableowner]));

                for (const table of expected) {
                    assert.ok(byName.has(table), `table ${target.schema}.${table} is missing`);
                    assert.equal(
                        byName.get(table),
                        target.username,
                        `${table} is owned by ${byName.get(table)} — the app could not write to it`,
                    );
                }
            },
        },
        {
            label: "model columns and table columns match exactly, both directions",
            fn: async () => {
                for (const [key, model] of Object.entries(db)) {
                    if (!/^(mst|txn|log)_/.test(key)) continue;

                    const modelColumns = Object.values(model.rawAttributes)
                        .map((attribute) => attribute.field)
                        .sort();

                    const rows = await db.sequelize.query(
                        `SELECT column_name FROM information_schema.columns
                          WHERE table_schema = :schema AND table_name = :table`,
                        {
                            replacements: { schema: target.schema, table: key },
                            type: db.sequelize.constructor.QueryTypes.SELECT,
                        },
                    );
                    const tableColumns = rows.map((r) => r.column_name).sort();

                    // ⚠️ An information_schema probe returns ZERO ROWS for a table
                    // that isn't there, which reads exactly like "no columns".
                    assert.ok(tableColumns.length > 0, `${key}: information_schema returned nothing`);

                    assert.deepEqual(
                        modelColumns,
                        tableColumns,
                        `${key}: the model and the table disagree.\n` +
                        `        model: ${modelColumns.join(", ")}\n` +
                        `        table: ${tableColumns.join(", ")}`,
                    );
                }
            },
        },
        {
            label: "the migration ledger records 001_core.sql",
            fn: async () => {
                const rows = await db.sequelize.query(
                    `SELECT filename, checksum FROM ${target.schema}.log_migration ORDER BY filename`,
                    { type: db.sequelize.constructor.QueryTypes.SELECT },
                );
                assert.ok(
                    rows.some((r) => r.filename === "001_core.sql"),
                    `log_migration has no row for 001_core.sql (has: ${rows.map((r) => r.filename).join(", ") || "nothing"})`,
                );
                assert.ok(rows.every((r) => r.checksum?.length === 64), "a ledger row has no sha256");
            },
        },
        {
            label: "the log_message level CHECK constraint really rejects a bad level",
            fn: async () => {
                // This is the guarantee sync() cannot express, so it is the one
                // worth proving rather than assuming.
                const transaction = await db.sequelize.transaction();
                try {
                    await assertThrows(
                        () =>
                            db.log_message.create(
                                {
                                    process_start_on: new Date(),
                                    report_on: new Date(),
                                    report_by: "test/checks/database.check.mjs",
                                    level: "shouty",
                                    message: "should never be stored",
                                },
                                { transaction, validate: false },
                            ),
                        undefined,
                    );
                } finally {
                    await transaction.rollback();
                }
            },
        },
        {
            label: "a valid log row DOES insert, and leaves nothing behind",
            fn: async () => {
                const transaction = await db.sequelize.transaction();
                try {
                    const row = await db.log_message.create(
                        {
                            process_start_on: new Date(),
                            report_on: new Date(),
                            report_by: "test/checks/database.check.mjs",
                            level: "debug",
                            message: "insert path proven inside a rolled-back transaction",
                        },
                        { transaction },
                    );
                    assert.ok(row.uuid, "no uuid was generated");
                    assert.ok(row.rolling_id, "no rolling_id was assigned");
                } finally {
                    await transaction.rollback();
                }
            },
        },
        {
            label: "the snowflake CHECK rejects a guild id that is not digits",
            fn: async () => {
                const transaction = await db.sequelize.transaction();
                try {
                    await assertThrows(() =>
                        db.mst_guild.create(
                            { guild_id: "not-a-snowflake", name: "nope" },
                            { transaction },
                        ),
                    );
                } finally {
                    await transaction.rollback();
                }
            },
        },
    ];
};

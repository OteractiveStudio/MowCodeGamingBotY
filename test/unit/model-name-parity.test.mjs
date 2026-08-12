/**
 * Unit: one name end to end.
 *
 * STANDARDS §4 requires the model file, the `sequelize.define()` name, the
 * `tableName`, and the `db.` accessor to be the SAME literal string, with no name
 * map and no helper (a helper adds a fourth name). This is the test that fails
 * when they drift.
 *
 * No connection is made — Sequelize does not talk to Postgres until authenticate().
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Sequelize } from "sequelize";

import initModels from "../../database/models/index.js";
import { projectRootPath } from "../../lib/utility.js";

const TEST_SCHEMA = "parity_check_schema";

function buildModels() {
    const sequelize = new Sequelize("unused", "unused", "unused", {
        dialect: "postgres",
        logging: false,
    });
    return initModels(sequelize, { project: TEST_SCHEMA, parent: "public" });
}

export default [
    {
        label: "registry key === define() name === tableName, for every model",
        fn: () => {
            const { models } = buildModels();
            const names = Object.keys(models);
            assert.ok(names.length > 0, "the model registry is empty");

            for (const [key, model] of Object.entries(models)) {
                assert.equal(model.name, key, `registry key "${key}" != define() name "${model.name}"`);
                assert.equal(
                    model.getTableName().tableName ?? model.getTableName(),
                    key,
                    `registry key "${key}" != tableName`,
                );
            }
        },
    },
    {
        label: "every model file is named <table>.model.js and is registered",
        fn: () => {
            const { models } = buildModels();
            const modelsDir = path.resolve(projectRootPath(), "database", "models");

            const fileTables = fs
                .readdirSync(modelsDir)
                .filter((name) => name.endsWith(".model.js"))
                .map((name) => name.replace(/\.model\.js$/, ""))
                .sort();

            assert.deepEqual(
                fileTables,
                Object.keys(models).sort(),
                "the model files on disk and the registry disagree",
            );
        },
    },
    {
        label: "every table carries a data-class prefix: mst_ / txn_ / log_",
        fn: () => {
            const { models } = buildModels();
            for (const key of Object.keys(models)) {
                assert.match(
                    key,
                    /^(mst|txn|log)_/,
                    `table "${key}" has no data-class prefix — mst_ what exists, txn_ what happened, log_ append-only`,
                );
            }
        },
    },
    {
        label: "every model is bound to the project schema from config, not public",
        fn: () => {
            const { models } = buildModels();
            for (const [key, model] of Object.entries(models)) {
                const table = model.getTableName();
                assert.equal(
                    typeof table === "object" ? table.schema : undefined,
                    TEST_SCHEMA,
                    `model "${key}" is not schema-qualified — it would land in public`,
                );
            }
        },
    },
    {
        label: "the SQL migration declares every table the models expect",
        fn: () => {
            const { models } = buildModels();
            const sqlPath = path.resolve(
                projectRootPath(),
                "database",
                "migrations",
                "001_core.sql",
            );
            const sql = fs.readFileSync(sqlPath, "utf-8");

            for (const key of Object.keys(models)) {
                assert.ok(
                    sql.includes(`{{schema}}.${key} (`),
                    `001_core.sql has no CREATE TABLE for "${key}" — the SQL is the source of truth, so a model without one is a model of nothing`,
                );
            }
        },
    },
    {
        label: "the migration hardcodes no schema name — only the {{schema}} placeholder",
        fn: () => {
            const sqlPath = path.resolve(
                projectRootPath(),
                "database",
                "migrations",
                "001_core.sql",
            );
            const sql = fs.readFileSync(sqlPath, "utf-8");

            // Strip comment lines before looking: the header explains the rule and
            // is allowed to mention it.
            const statements = sql
                .split("\n")
                .filter((line) => !line.trimStart().startsWith("--"))
                .join("\n");

            assert.ok(
                !/mowcodegamingbot_y/i.test(statements),
                "001_core.sql hardcodes the schema name — it must come from config via {{schema}}",
            );
            assert.ok(statements.includes("{{schema}}"), "the {{schema}} placeholder is missing");
        },
    },
];

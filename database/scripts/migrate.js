#!/usr/bin/env node
/**
 * database/scripts/migrate.js — apply the SQL migrations, in order, once each.
 *
 *   npm run db:migrate            apply everything pending
 *   npm run db:migrate -- --status   show what is applied and what is pending
 *   npm run db:migrate -- --dry-run  print what WOULD run, touch nothing
 *
 * Three things this deliberately does:
 *
 *  1. Connects AS THE APP ROLE from config.json. Applying migrations as a
 *     superuser leaves every table owned by that role and unwritable by the app
 *     (STANDARDS §4) — so the only credentials here are the app's own.
 *  2. Substitutes `{{schema}}` from config, so no schema name is hardcoded in
 *     any SQL file or script.
 *  3. Records a sha256 of each file in the ledger, and shouts if a file that was
 *     already applied has since been edited. An edited migration is a schema
 *     that no longer matches its own source of truth.
 *
 * Exit code is real: 0 applied/up-to-date, 1 anything else.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import pg from "pg";

import { loadConfig } from "../../lib/utility.js";
import {
    resolveDatabaseConfig,
    describeDatabaseTarget,
} from "../connection-config.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(scriptDir, "..", "migrations");

const args = process.argv.slice(2);
const statusOnly = args.includes("--status");
const dryRun = args.includes("--dry-run");

function sha256(text) {
    return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function listMigrationFiles() {
    if (!fs.existsSync(migrationsDir)) {
        throw new Error(`No migrations directory at ${migrationsDir}`);
    }
    return fs
        .readdirSync(migrationsDir)
        .filter((name) => name.toLowerCase().endsWith(".sql"))
        .sort(); // 001_, 002_, ... — filename order IS apply order.
}

/**
 * The ledger table is infrastructure, so the runner owns it rather than a
 * migration (a migration cannot record itself into a table that does not exist).
 * `log_` because it is append-only: one row per successful application.
 */
async function bootstrapLedger(client, schema) {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await client.query(`
        CREATE TABLE IF NOT EXISTS ${schema}.log_migration (
            uuid        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            filename    TEXT NOT NULL UNIQUE,
            checksum    TEXT NOT NULL,
            applied_on  TIMESTAMPTZ NOT NULL DEFAULT now(),
            applied_by  TEXT NOT NULL DEFAULT current_user
        )
    `);
}

async function main() {
    const config = loadConfig();
    const target = resolveDatabaseConfig(config);

    console.log(`[migrate] target: ${describeDatabaseTarget(target)}`);

    const files = listMigrationFiles();
    if (files.length === 0) {
        console.log("[migrate] no .sql files found — nothing to do");
        return 0;
    }

    const client = new pg.Client({
        host: target.host,
        port: target.port,
        user: target.username,
        password: target.password,
        database: target.database,
    });

    await client.connect();

    try {
        const who = await client.query(
            "SELECT current_user, rolsuper FROM pg_roles WHERE rolname = current_user",
        );
        const role = who.rows[0];
        console.log(
            `[migrate] connected as ${role.current_user} (superuser=${role.rolsuper})`,
        );
        if (role.rolsuper) {
            console.warn(
                "[migrate] ⚠️  connected as a SUPERUSER. Tables created now will be owned by it " +
                "and may be unwritable by the app role. This is the §4 trap — check config.json.",
            );
        }

        await bootstrapLedger(client, target.schema);

        const appliedRows = await client.query(
            `SELECT filename, checksum, applied_on FROM ${target.schema}.log_migration`,
        );
        const applied = new Map(
            appliedRows.rows.map((row) => [row.filename, row]),
        );

        let pending = 0;
        let drift = 0;

        for (const filename of files) {
            const raw = fs.readFileSync(
                path.join(migrationsDir, filename),
                "utf-8",
            );
            const checksum = sha256(raw);
            const previous = applied.get(filename);

            if (previous) {
                if (previous.checksum !== checksum) {
                    drift += 1;
                    console.error(
                        `[migrate] ✗ ${filename} — ALREADY APPLIED BUT THE FILE HAS CHANGED since ` +
                        `${previous.applied_on.toISOString()}. The live schema no longer matches its ` +
                        `source of truth. Write a new migration; do not edit an applied one.`,
                    );
                } else {
                    console.log(`[migrate] · ${filename} — already applied`);
                }
                continue;
            }

            pending += 1;

            if (statusOnly || dryRun) {
                console.log(`[migrate] → ${filename} — PENDING`);
                continue;
            }

            const sql = raw.replaceAll("{{schema}}", target.schema);

            // DDL is transactional in Postgres: the file and its ledger row land
            // together, or neither does.
            await client.query("BEGIN");
            try {
                await client.query(sql);
                await client.query(
                    `INSERT INTO ${target.schema}.log_migration (filename, checksum) VALUES ($1, $2)`,
                    [filename, checksum],
                );
                await client.query("COMMIT");
                console.log(`[migrate] ✓ ${filename} — applied`);
            } catch (err) {
                await client.query("ROLLBACK");
                console.error(`[migrate] ✗ ${filename} — FAILED, rolled back`);
                console.error(`           ${err.message}`);
                throw err;
            }
        }

        if (drift > 0) return 1;

        if (statusOnly || dryRun) {
            console.log(
                `[migrate] ${applied.size} applied, ${pending} pending (nothing was changed)`,
            );
        } else if (pending === 0) {
            console.log("[migrate] up to date");
        } else {
            console.log(`[migrate] done — ${pending} migration(s) applied`);
        }

        return 0;
    } finally {
        await client.end();
    }
}

try {
    process.exitCode = await main();
} catch (err) {
    console.error(`[migrate] failed: ${err.message}`);
    process.exitCode = 1;
}

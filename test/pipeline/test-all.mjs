#!/usr/bin/env node
/**
 * test/pipeline/test-all.mjs — ONE command, a real exit code.
 *
 *   npm test                 unit + checks against the real database
 *   npm run test:unit        unit only (no database, no network)
 *
 * Two rules from STANDARDS §5 are load-bearing here:
 *
 *  - **Fail fast on preconditions.** If config.json is missing or the database
 *    will not answer, the suite reports ITS OWN failure and stops. A suite that
 *    cannot reach its dependencies must not report the product as broken.
 *  - **A green log line and a zero exit are not the same thing.** The summary is
 *    computed from counters, and `process.exitCode` is set from those counters.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadConfig, configureLogging } from "../../lib/utility.js";
import { initDB, closeDB } from "../../database/index.js";
import { runSuite } from "../lib/harness.mjs";

const testRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const unitOnly = process.argv.includes("--unit-only");

/** Silence the app's own logging so the suite's output is the suite's, and no log rows are written. */
function quietConfig(config) {
    return {
        ...config,
        logging: {
            ...config.logging,
            fastify: false,
            message: {
                ...(config.logging?.message || {}),
                log_to_console: false,
                log_to_file: false,
                log_to_database: false,
            },
            sequelize: {
                ...(config.logging?.sequelize || {}),
                log_to_console: false,
                log_to_file: false,
            },
        },
    };
}

function discover(directory, suffix) {
    const full = path.join(testRoot, directory);
    if (!fs.existsSync(full)) return [];
    return fs
        .readdirSync(full)
        .filter((name) => name.endsWith(suffix))
        .sort()
        .map((name) => ({ name, href: pathToFileURL(path.join(full, name)).href }));
}

/** A test module exports either an array of cases, or a function of ctx returning one. */
async function casesFrom(href, ctx) {
    const module = await import(href);
    const exported = module.default;
    return typeof exported === "function" ? await exported(ctx) : exported;
}

function fail(message) {
    console.error(`\n✗ PRECONDITION: ${message}\n`);
    process.exitCode = 1;
}

const startedAt = Date.now();
console.log(`MowCodeGamingBoteY — test suite${unitOnly ? " (unit only)" : ""}`);

// ── Preconditions ────────────────────────────────────────────────────────────
let config;
try {
    config = loadConfig();
    configureLogging(quietConfig(config));
} catch (err) {
    fail(`config.json could not be loaded — ${err.message}`);
    process.exit();
}

let db = null;
const ctx = { config, db: null };

if (!unitOnly) {
    try {
        db = await initDB(quietConfig(config));
        ctx.db = db;
    } catch (err) {
        fail(
            `the database is not usable — ${err.message}\n` +
            `  This is the SUITE failing to reach its dependency, not the product failing.\n` +
            `  Check Postgres is up, then: npm run db:migrate`,
        );
        process.exit();
    }
}

// ── Run ──────────────────────────────────────────────────────────────────────
const results = [];

try {
    for (const { name, href } of discover("unit", ".test.mjs")) {
        results.push(await runSuite(`unit · ${name}`, await casesFrom(href, ctx)));
    }

    if (!unitOnly) {
        for (const { name, href } of discover("checks", ".check.mjs")) {
            results.push(await runSuite(`check · ${name}`, await casesFrom(href, ctx)));
        }
    }
} catch (err) {
    // A suite that fails to even load is a suite failure, reported as such.
    console.error(`\n✗ a test module could not be loaded or run: ${err.stack || err.message}`);
    results.push({ title: "loading test modules", passed: 0, failures: [{ label: "load", error: err }] });
} finally {
    if (db) await closeDB(db);
}

// ── Summary ──────────────────────────────────────────────────────────────────
const passed = results.reduce((sum, r) => sum + r.passed, 0);
const failures = results.flatMap((r) => r.failures.map((f) => ({ ...f, suite: r.title })));
const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

console.log(`\n${"═".repeat(70)}`);

if (failures.length > 0) {
    console.log(`FAILED — ${passed} passed, ${failures.length} failed, ${seconds}s\n`);
    for (const failure of failures) {
        console.log(`  ✗ ${failure.suite} → ${failure.label}`);
        console.log(`      ${failure.error.message.split("\n")[0]}`);
    }
    console.log("");
} else {
    console.log(`PASSED — ${passed} checks, ${seconds}s`);
    if (unitOnly) {
        console.log("(unit only — the database and HTTP checks did not run)");
    }
}

process.exitCode = failures.length > 0 ? 1 : 0;

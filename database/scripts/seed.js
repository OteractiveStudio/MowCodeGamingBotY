#!/usr/bin/env node
/**
 * database/scripts/seed.js — load the game's reference data.
 *
 *   npm run db:seed
 *
 * Idempotent: it upserts, so running it again syncs the database to
 * database/seeds/reference_data.js.
 *
 * ⚠️ NOT run automatically at boot. Reference data is content, and a process that
 * quietly rewrites content every time it starts is a process you cannot edit
 * anything in.
 */

import { loadConfig, configureLogging, logInit } from "../../lib/utility.js";
import { initDB, closeDB } from "../index.js";
import { seedReferenceData } from "../seeds/reference_data.js";

const config = loadConfig();

// Keep the suite-style quiet: this is a CLI, its own output is the report.
configureLogging({
    ...config,
    logging: {
        ...config.logging,
        message: { ...(config.logging?.message || {}), log_to_console: false, log_to_database: false },
        sequelize: { ...(config.logging?.sequelize || {}), log_to_console: false },
    },
});
logInit();

let db = null;

try {
    db = await initDB(config);
    const counts = await seedReferenceData(db);

    console.log(
        `[seed] reference data loaded — ${counts.fish} fish · ${counts.items} items · ` +
        `${counts.categories} market categories · ${counts.listings} listings · ` +
        `${counts.words} wordle words`,
    );

    // Read the counts back from the database rather than trusting the loop — a seed that
    // reports what it MEANT to write is not a verification.
    const [back] = await db.sequelize.query(
        `SELECT (SELECT count(*)::int FROM ${db.schema}.mst_fish) AS fish,
                (SELECT count(*)::int FROM ${db.schema}.mst_wordle_word) AS words`,
        { type: db.sequelize.constructor.QueryTypes.SELECT },
    );
    console.log(`[seed] mst_fish now holds ${back.fish} row(s), mst_wordle_word ${back.words}`);

    process.exitCode = 0;
} catch (err) {
    console.error(`[seed] failed: ${err.message}`);
    process.exitCode = 1;
} finally {
    if (db) await closeDB(db);
}

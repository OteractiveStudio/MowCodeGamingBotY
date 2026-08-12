/**
 * Unit: the logging seam.
 *
 * ⚠️ The off state is tested FIRST and on purpose. The legacy had
 * `if not self.is_debug: return` where `is_debug` was a method that was never
 * called — always truthy, so debug logging could never be turned off and
 * `settings.json.debug` did nothing. A flag that is never observed is not a
 * feature, so these assert that turning it off turns it off.
 */

import assert from "node:assert/strict";

import {
    LOG_LEVELS,
    shouldLog,
    getLogOptions,
    runStamp,
    addS,
    aAn,
} from "../../lib/utility.js";

export default [
    {
        label: "min_level=info suppresses debug — the OFF state actually works",
        fn: () => {
            const options = { minLevel: "info" };
            assert.equal(shouldLog("debug", options), false, "debug should be suppressed");
            assert.equal(shouldLog("info", options), true);
            assert.equal(shouldLog("warning", options), true);
            assert.equal(shouldLog("error", options), true);
        },
    },
    {
        label: "min_level=error suppresses everything below it",
        fn: () => {
            const options = { minLevel: "error" };
            assert.equal(shouldLog("debug", options), false);
            assert.equal(shouldLog("info", options), false);
            assert.equal(shouldLog("warning", options), false);
            assert.equal(shouldLog("error", options), true);
        },
    },
    {
        label: "min_level=debug lets everything through",
        fn: () => {
            for (const level of LOG_LEVELS) {
                assert.equal(shouldLog(level, { minLevel: "debug" }), true, `${level} should pass`);
            }
        },
    },
    {
        label: "an unknown or missing min_level falls back to info, not to silence",
        fn: () => {
            assert.equal(shouldLog("info", { minLevel: "chatty" }), true);
            assert.equal(shouldLog("debug", { minLevel: "chatty" }), false);
            assert.equal(shouldLog("info", {}), true);
            assert.equal(shouldLog("info", undefined), true);
        },
    },
    {
        label: "an unknown level is treated as info rather than dropped",
        fn: () => {
            assert.equal(shouldLog("catastrophe", { minLevel: "info" }), true);
        },
    },
    {
        label: "log_to_* switches are read from the config object given, not guessed",
        fn: () => {
            const off = getLogOptions({
                logging: {
                    message: {
                        log_to_file: false,
                        log_to_console: false,
                        log_to_database: false,
                        min_level: "warning",
                    },
                },
            });
            assert.equal(off.logToFile, false);
            assert.equal(off.logToConsole, false);
            assert.equal(off.logToDatabase, false);
            assert.equal(off.minLevel, "warning");

            // Absent keys default to ON — a missing config must not silence logging.
            const bare = getLogOptions({});
            assert.equal(bare.logToFile, true);
            assert.equal(bare.logToConsole, true);
            assert.equal(bare.minLevel, "info");
        },
    },
    {
        label: "runStamp is the legacy YYYYMMDD_HHMMSS shape",
        fn: () => {
            const stamp = runStamp(new Date(2024, 8, 22, 21, 7, 33));
            assert.equal(stamp, "20240922_210733");
            assert.match(runStamp(), /^\d{8}_\d{6}$/);
        },
    },
    {
        label: "addS / aAn carry the legacy formatting helpers",
        fn: () => {
            assert.equal(addS(1, "coin"), "1 coin");
            assert.equal(addS(2, "coin"), "2 coins");
            assert.equal(addS(0, "coin"), "0 coins");
            assert.equal(aAn("rod"), "a rod");
            assert.equal(aAn("apple"), "an apple");
        },
    },
];

/**
 * Unit: the rotating status, the avatar self-check, and restarting.
 *
 * ⚠️ THE FIRST TEST IS THE IMPORTANT ONE and it exists because I broke this while writing it.
 * `main.js` is the composition root — **importing it RUNS it** — and I briefly put the restart
 * flag there with the admin cog importing it back. Loading that one cog started a second bot,
 * connected to the same database and gateway. Inside the bot's own cog loader that would have
 * been a nested bot on every boot.
 *
 * It was caught by a stray "Starting MowCodeGamingBoteY" in the output of an import that should
 * have printed nothing. A grep test is a blunt instrument, but it is the only thing that catches
 * this before a human notices — the failure is invisible in a unit test that happens not to load
 * the offending file.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    DEFAULT_STATUS_LINES,
    PRESENCE_RULES,
    cycleLines,
    statusIntervalSeconds,
    statusLines,
} from "../../app/bot/presence.js";
import {
    RESTART_EXIT_CODE,
    isSupervised,
    isRestartRequested,
    requestRestart,
} from "../../app/bot/restart.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Every .js file under the given directories, recursively. */
function sourceFiles(directories) {
    const found = [];
    const walk = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".js")) found.push(full);
        }
    };
    for (const dir of directories) walk(path.join(projectRoot, dir));
    return found;
}

export default [
    {
        label: "🔑 NOTHING under app/, lib/ or database/ imports main.js — it would BOOT A BOT",
        fn: () => {
            const offenders = [];

            for (const file of sourceFiles(["app", "lib", "database"])) {
                const source = fs.readFileSync(file, "utf8");
                // Any import specifier ending in main.js, however many ../ deep.
                const matches = source.match(/(?:from|import)\s*\(?\s*["'][^"']*\bmain\.js["']/g);
                if (matches) {
                    offenders.push(`${path.relative(projectRoot, file)}: ${matches.join(", ")}`);
                }
            }

            assert.deepEqual(
                offenders,
                [],
                "main.js is the composition root, so importing it STARTS THE BOT. " +
                "Move whatever is needed into a leaf module under app/bot/ instead:\n  " +
                offenders.join("\n  "),
            );
        },
    },
    {
        label: "the restart exit code is a distinct non-zero — 0 would mean 'stay down'",
        fn: () => {
            assert.equal(RESTART_EXIT_CODE, 42);
            assert.notEqual(RESTART_EXIT_CODE, 0, "0 means finished cleanly");
            assert.notEqual(RESTART_EXIT_CODE, 1, "1 means a real failure");
        },
    },
    {
        label: "🔑 supervision is DECLARED by whatever starts us, never guessed",
        fn: () => {
            // A parent pid says nothing about whether it will restart us, so the thing that will
            // is the thing that says so. The run scripts export this.
            assert.equal(isSupervised({ MCGB_SUPERVISED: "1" }), true);
            assert.equal(isSupervised({}), false);
            assert.equal(isSupervised({ MCGB_SUPERVISED: "0" }), false);
            assert.equal(isSupervised({ MCGB_SUPERVISED: "yes" }), false, "only the exact flag counts");
            assert.equal(isSupervised({ MCGB_SUPERVISED: "" }), false);
        },
    },
    {
        label: "the restart flag starts false and latches true",
        fn: () => {
            // Order matters: this runs before anything requests a restart.
            assert.equal(isRestartRequested(), false);
            requestRestart();
            assert.equal(isRestartRequested(), true);
            requestRestart();
            assert.equal(isRestartRequested(), true, "latching, not toggling");
        },
    },

    // ── the status rotation ──────────────────────────────────────────────────
    {
        label: "⚠️ the interval is CLAMPED — his 7 seconds is 12,000 presence updates a day",
        fn: () => {
            // Presence is rate-limited around 5 per 20s, and each update is a gateway write on the
            // connection the bot needs for commands.
            assert.equal(statusIntervalSeconds({}), PRESENCE_RULES.DEFAULT_INTERVAL_SECONDS);
            assert.equal(statusIntervalSeconds({ bot: { status_interval_seconds: 7 } }),
                PRESENCE_RULES.MIN_INTERVAL_SECONDS, "7s is clamped up to the floor");
            assert.equal(statusIntervalSeconds({ bot: { status_interval_seconds: 300 } }), 300);
            assert.ok(PRESENCE_RULES.MIN_INTERVAL_SECONDS >= 15);
        },
    },
    {
        label: "rotation can be switched off entirely, and nonsense falls back to the default",
        fn: () => {
            assert.equal(statusIntervalSeconds({ bot: { status_interval_seconds: null } }), null);
            assert.equal(statusIntervalSeconds({ bot: { status_interval_seconds: false } }), null);

            for (const bad of ["soon", NaN, 0, -5]) {
                assert.equal(
                    statusIntervalSeconds({ bot: { status_interval_seconds: bad } }),
                    PRESENCE_RULES.DEFAULT_INTERVAL_SECONDS,
                    `${JSON.stringify(bad)} should fall back`,
                );
            }
        },
    },
    {
        label: "🔑 cycleLines() cycles forever in order — his itertools.cycle",
        fn: () => {
            const next = cycleLines(["a", "b", "c"]);
            assert.deepEqual([next(), next(), next(), next(), next()], ["a", "b", "c", "a", "b"]);
        },
    },
    {
        label: "a one-line list still cycles rather than dividing by zero or running out",
        fn: () => {
            const next = cycleLines(["only"]);
            assert.deepEqual([next(), next(), next()], ["only", "only", "only"]);
        },
    },
    {
        label: "his status list is kept, and config can replace it",
        fn: () => {
            assert.ok(DEFAULT_STATUS_LINES.length >= 8, "his had 14 with duplicates");
            assert.deepEqual(statusLines({}), DEFAULT_STATUS_LINES);
            assert.deepEqual(statusLines({ bot: { status_lines: ["mine"] } }), ["mine"]);

            // Empty and junk entries are dropped rather than shown as blank presences.
            assert.deepEqual(statusLines({ bot: { status_lines: ["ok", "", "  ", null, 42] } }), ["ok"]);
            assert.deepEqual(statusLines({ bot: { status_lines: [] } }), DEFAULT_STATUS_LINES);
        },
    },
    {
        label: "every default status line is short enough for Discord's presence limit",
        fn: () => {
            for (const line of DEFAULT_STATUS_LINES) {
                assert.ok(line.length <= 128, `"${line}" is ${line.length} characters`);
            }
        },
    },
    {
        label: "⭐ the status list no longer advertises things that do not exist",
        fn: () => {
            // His said "Invite link is HERE👇", pointing at a message that is long gone, and
            // "<Prefix>Help", which is not how help works any more.
            const all = DEFAULT_STATUS_LINES.join(" ");
            assert.ok(!/Invite link/i.test(all), "the invite line pointed at nothing");
            assert.ok(!/<Prefix>/.test(all), "the prefix placeholder was never substituted");
            assert.match(all, /\/help/, "it should point at something that works");
        },
    },
];

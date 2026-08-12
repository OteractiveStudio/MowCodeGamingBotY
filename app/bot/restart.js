/**
 * app/bot/restart.js — restarting, done by asking to be restarted.
 *
 * ⭐ His `restart` command, from `MCGB_Main.py:178`. It swapped the avatar to `restart.png`,
 * cancelled the status loop, set the presence to "❗❗ Restarting... ❗❗", counted down from five
 * in an edited message, disconnected voice, closed the client, recorded a "starting message" and
 * then:
 *
 *     os.system("python MCGB_Launcher.py")
 *     exit(0)
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ⚠️ THAT LAST PART IS THE PROBLEM, AND IT IS WHY THIS FILE EXISTS
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * `os.system()` **blocks until the child exits**, so the old process sat there — holding its
 * memory, its file handles, and whatever the launcher then spawned — waiting for its own
 * replacement to finish. Restart twice and there are two dead parents in the tree; the `exit(0)`
 * after it only runs once the child is *already gone*. `main.js`'s header has flagged this since
 * the beginning: *"a shell spawn per restart and orphaned children"*.
 *
 * ⭐ **SO THE PROCESS DOES NOT RESTART ITSELF. IT ASKS.** It exits with a distinct code and
 * whatever started it decides. That is the honest shape, and it makes the supervisor explicit
 * instead of hidden inside the application:
 *
 *     node main.js            → exit 42 → the shell loop in run_windows.bat starts it again
 *     systemd / pm2 / docker  → exit 42 → restarted by policy
 *     bare `node main.js`     → exit 42 → STAYS DOWN, and /admin restart says so up front
 *
 * ⚠️ That last case is why `isSupervised()` exists. Offering a restart button that silently kills
 * the bot would be worse than not offering one, so the run scripts export `MCGB_SUPERVISED=1` and
 * the command refuses without it. An honest "nothing is watching me" beats a dead bot.
 */

import fs from "node:fs";
import path from "node:path";

import { log, projectRootPath } from "../../lib/utility.js";

/**
 * ⚠️ 42 rather than 0, because 0 means "finished cleanly, stay down". A supervisor has to be able
 * to tell "restart me" apart from "I am done", and every other non-zero code in this process
 * means a real failure.
 */
export const RESTART_EXIT_CODE = 42;

const NOTICE_FILE = () => path.resolve(projectRootPath(), "logs", "restart-notice.json");

/**
 * Whether a restart has been asked for. Read by `main.js` when it shuts down.
 *
 * ⚠️ **THIS FLAG LIVES HERE, IN A LEAF MODULE, AND THAT IS NOT A STYLE CHOICE.** It was briefly in
 * `main.js` with the admin cog importing it — and `main.js` is the composition root, so **importing
 * it RUNS it**: loading the admin cog started a second bot, connected to the same database and
 * gateway. Inside the running bot's own cog loader, that would have been a nested bot per boot.
 * Caught immediately because a stray "Starting MowCodeGamingBoteY" appeared in the output of an
 * import that should have printed nothing.
 *
 * The rule it enforces: **dependencies point AT the leaves.** `main.js` may import this; nothing
 * may import `main.js`.
 */
let restartRequested = false;

export function requestRestart() {
    restartRequested = true;
}

export function isRestartRequested() {
    return restartRequested;
}

/**
 * Is something going to start us again?
 *
 * ⚠️ An env var set by the run scripts, not a guess. There is no portable way to ask "am I
 * supervised" — a parent pid tells you nothing about whether it will restart you — so the thing
 * that WILL restart us is the thing that says so.
 */
export function isSupervised(env = process.env) {
    return env.MCGB_SUPERVISED === "1";
}

/**
 * Remember where to say "I'm back!".
 *
 * ⚠️ A FILE, not a table, and deliberately. This is operational state belonging to one process
 * across one restart — it is not game data, nobody queries it, and it must survive the database
 * being the very thing that is broken. It lives in `logs/` beside `bot.pid`, which is the same
 * kind of state for the same reason.
 */
export function writeRestartNotice(notice) {
    try {
        fs.mkdirSync(path.dirname(NOTICE_FILE()), { recursive: true });
        fs.writeFileSync(
            NOTICE_FILE(),
            JSON.stringify({ ...notice, at: new Date().toISOString() }, null, 2),
            "utf8",
        );
        return true;
    } catch (err) {
        void log(`could not record the restart notice: ${err.message}`, "warning", import.meta.url);
        return false;
    }
}

/**
 * Read the notice and delete it, in that order.
 *
 * ⚠️ **CLEARED EVEN IF THE ANNOUNCEMENT LATER FAILS.** A notice that survives its own delivery
 * would make the bot say "I'm back!" on every boot forever — the announcement is worth one
 * attempt, not a permanent obligation. His `set_starting_msg(True, …)` had exactly that shape,
 * with a boolean that had to be turned off again by whoever read it.
 */
export function takeRestartNotice() {
    let notice = null;
    try {
        notice = JSON.parse(fs.readFileSync(NOTICE_FILE(), "utf8"));
    } catch {
        return null;
    }
    try {
        fs.unlinkSync(NOTICE_FILE());
    } catch {
        /* If it cannot be removed the worst case is one repeated greeting. */
    }

    // Stale notices are dropped: a file left by a crash from days ago should not greet anyone.
    const age = Date.now() - new Date(notice?.at ?? 0).getTime();
    if (!Number.isFinite(age) || age > 10 * 60 * 1000) return null;

    return notice;
}

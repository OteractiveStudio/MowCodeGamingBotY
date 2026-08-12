/**
 * main.js — the composition root. The only file that knows about every part.
 *
 * Boot order is deliberate:
 *   config → logging → database → bot
 *
 * Logging comes up before anything that could fail interestingly, and the database
 * comes up before the bot, so the bot never answers a command with a store that is
 * not there.
 *
 * ⭐ NO HTTP SURFACE. Ote, 2026-08-12: *"we dont need a http now right?, let's
 * forcus on discord js should we?"* and *"the fstidy mention in the innitial carry
 * on should be a seperate project from MowCodeGamingBoteY right?"* — so the earlier
 * "Fastify beside it, minimal" decision is superseded. A dashboard or API, when it
 * is wanted, becomes its own sibling project reading this same schema. **This
 * process is a Discord bot and nothing else.**
 *
 * ⚠️ The legacy's restart mechanism was `os.system("python MCGB_Main.py")` from
 * inside the running process, with the launcher doing the same — a shell spawn per
 * restart and orphaned children. There is no self-restart here on purpose: the
 * process exits with a real code and a supervisor decides. Choosing that
 * supervisor is still open.
 */

import fs from "node:fs";
import path from "node:path";

import {
    loadConfig,
    configureLogging,
    logInit,
    queryLogInit,
    log,
    setDB,
    getLogPath,
    projectRootPath,
} from "./lib/utility.js";
import { initDB, closeDB } from "./database/index.js";
import { startBot, stopBot } from "./app/bot/index.js";
import { RESTART_EXIT_CODE, isRestartRequested } from "./app/bot/restart.js";

/**
 * Where the run scripts look to tell OUR bot apart from any other Node process on the machine.
 *
 * ⚠️ This exists because six orphaned bots once answered the same server at once, and "is any
 * node running main.js" is too broad a test on a box with other Node projects — a warning that
 * fires for someone else's process is one you learn to ignore.
 */
const PID_FILE = path.resolve(projectRootPath(), "logs", "bot.pid");

function writePidFile() {
    try {
        fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
        fs.writeFileSync(PID_FILE, String(process.pid), "utf-8");
    } catch {
        // Not being able to record the pid must never stop the bot from running.
    }
}

function clearPidFile() {
    try {
        // Only remove it if it is still OURS — a newer run may have replaced it.
        if (fs.existsSync(PID_FILE) && fs.readFileSync(PID_FILE, "utf-8").trim() === String(process.pid)) {
            fs.unlinkSync(PID_FILE);
        }
    } catch {
        /* nothing useful to do */
    }
}

async function boot() {
    const config = loadConfig();
    configureLogging(config);

    const messageLogPath = logInit();
    console.log(
        messageLogPath
            ? `Message log for this run: ${messageLogPath}`
            : "Message log to file is OFF (logging.message.log_to_file=false)",
    );

    await log(`Starting ${config.app?.name ?? "the bot"}`, import.meta.url);

    // ── Database ─────────────────────────────────────────────────────────────
    const databaseEnabled = config.database?.enabled !== false;
    let db = null;

    if (databaseEnabled) {
        const queryLogPath = queryLogInit();
        if (queryLogPath) {
            console.log(`Query log for this run: ${queryLogPath}`);
        }

        db = await initDB(config);
        // Hand the logger its table, which also flushes everything logged before now.
        setDB(db);
    } else {
        await log(
            "Database is DISABLED (database.enabled=false) — anything that reads a player or a guild will fail",
            "warning",
            import.meta.url,
        );
    }

    // ── Bot ──────────────────────────────────────────────────────────────────
    const botEnabled = config.discord?.enabled !== false;
    let bot = null;

    if (botEnabled) {
        bot = await startBot({ config, db });
    } else {
        await log(
            "Discord bot is DISABLED (discord.enabled=false) — this process now does nothing",
            "warning",
            import.meta.url,
        );
    }

    writePidFile();

    return { config, db, bot };
}

let running = null;

try {
    running = await boot();
} catch (err) {
    // A precondition failure is a configuration problem, not a crash. Say what is
    // wrong in one readable block; the stack goes to the log file, not the face of
    // whoever is trying to start the bot.
    //
    // Console logging is turned OFF for this one write on purpose — otherwise the
    // stack prints above the block we are about to print, and the reader sees the
    // same failure twice, the ugly way first.
    try {
        const config = loadConfig();
        configureLogging({
            ...config,
            logging: {
                ...config.logging,
                message: { ...(config.logging?.message || {}), log_to_console: false },
            },
        });
        await log(`startup failed: ${err.stack || err.message}`, "error", import.meta.url);
    } catch {
        // Config itself may be what failed. The block below is then the only report.
    }

    console.error("\n──────────────────────────────────────────────────────────");
    console.error(" STARTUP FAILED");
    console.error("──────────────────────────────────────────────────────────");
    console.error(` ${err.message}`);
    const logPath = getLogPath();
    if (logPath) console.error(`\n Full detail: ${logPath}`);
    console.error("");

    process.exit(1);
}

// ── Shutdown ─────────────────────────────────────────────────────────────────
// Close in reverse order, and only once however many signals arrive.
let shuttingDown = false;

async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    await log(`${signal} received — shutting down`, import.meta.url);

    try {
        if (running.bot) await stopBot(running.bot.client);
        if (running.db) await closeDB(running.db);
    } catch (err) {
        console.error(`Error during shutdown: ${err.message}`);
        process.exitCode = 1;
    }

    clearPidFile();

    const logPath = getLogPath();
    if (logPath) console.log(`Log for this run: ${logPath}`);

    // ⚠️ Set AFTER the clean shutdown above, so a restart still closes the database and the
    // gateway properly. An exit code is a request to whatever started us; if nothing is watching,
    // the process simply stops — which is why /admin restart refuses when unsupervised.
    if (isRestartRequested() && process.exitCode !== 1) {
        console.log(`Exiting ${RESTART_EXIT_CODE} to ask for a restart.`);
        process.exitCode = RESTART_EXIT_CODE;
    }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => void shutdown(signal));
}

process.on("unhandledRejection", async (reason) => {
    // Silence is the legacy defect this exists to avoid.
    await log(`unhandled rejection: ${reason?.stack || reason}`, "error", import.meta.url);
});

/**
 * lib/utility.js — config loading and the logging seam.
 *
 * Descended from two places on purpose:
 *
 *  - The Fastify template's `Backend/lib/utility.js` — same `loadConfig()` +
 *    `log(message, level, import.meta.url)` shape, so the muscle memory carries.
 *  - The legacy bot's `debug_msg/YYYYMMDD_HHMMSS.txt` run-scoped log files,
 *    which is why the filename stamp below is the legacy format and not an ISO
 *    string: one file per run, sortable, greppable.
 *
 * ⚠️ What is deliberately DIFFERENT from the legacy:
 *   `MCGB_BasicClass` had `if not self.is_debug: return`, where `is_debug` was a
 *   *method* that was never called. A bound method is always truthy, so debug
 *   logging could never be turned off and `settings.json.debug` did nothing.
 *   Here the switches are read from config on every call and are covered by a
 *   test that asserts the OFF state — a flag that is never observed is not a
 *   feature.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const utilityFilePath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(utilityFilePath), "..");

/** Ordered lowest → highest. `min_level` filters against this order. */
export const LOG_LEVELS = ["debug", "info", "warning", "error"];

let cachedConfig = null;
let activeConfig = null;
let logFilePath = null;
let processStartOn = null;
let db = null;
const pendingLogRows = [];

// ── Config ───────────────────────────────────────────────────────────────────

function resolveConfigPath() {
    return path.resolve(projectRoot, "config.json");
}

/**
 * Read config.json. Throws rather than returning a half-filled object — a
 * config helper that returns something usable-looking on failure is how a
 * process ends up connected to the wrong database (STANDARDS §4).
 */
export function loadConfig() {
    if (cachedConfig) return cachedConfig;

    const configPath = resolveConfigPath();

    if (!fs.existsSync(configPath)) {
        throw new Error(
            `config.json not found at ${configPath}. Copy config.example.json to config.json and fill it in.`,
        );
    }

    const raw = fs.readFileSync(configPath, "utf-8");

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw new Error(`Invalid JSON in config.json: ${err.message}`);
    }

    cachedConfig = parsed;
    return cachedConfig;
}

/**
 * Point the logger at a config object. Called once by main.js (the composition
 * root) and by the test suite, so logging never has to guess where its config
 * came from. Without it, the first log call falls back to loadConfig().
 */
export function configureLogging(configObject) {
    activeConfig = configObject;
}

function currentConfig() {
    if (activeConfig) return activeConfig;
    activeConfig = loadConfig();
    return activeConfig;
}

// ── Log options ──────────────────────────────────────────────────────────────

/** Resolve the message-log switches from a config object. Pure. */
export function getLogOptions(config = currentConfig()) {
    const messageConfig = config?.logging?.message || {};

    return {
        logToFile: messageConfig.log_to_file !== false,
        logToConsole: messageConfig.log_to_console !== false,
        logToDatabase: messageConfig.log_to_database !== false,
        minLevel: normalizeLevel(messageConfig.min_level, "info"),
        logDirectory: messageConfig.log_directory || "./logs",
        logFilePrefix: messageConfig.log_file_prefix || "message_",
        logFilePostfix: messageConfig.log_file_postfix || "",
    };
}

export function getQueryLogOptions(config = currentConfig()) {
    const sequelizeConfig = config?.logging?.sequelize || {};

    return {
        logToFile: sequelizeConfig.log_to_file !== false,
        logToConsole: sequelizeConfig.log_to_console !== false,
        benchmark: sequelizeConfig.benchmark !== false,
        logDirectory: sequelizeConfig.log_directory || "./logs",
        logFilePrefix: sequelizeConfig.log_file_prefix || "queries_",
        logFilePostfix: sequelizeConfig.log_file_postfix || "",
    };
}

function normalizeLevel(level, fallback = "info") {
    if (typeof level !== "string") return fallback;
    const lowered = level.toLowerCase();
    return LOG_LEVELS.includes(lowered) ? lowered : fallback;
}

/**
 * Is this level loud enough to emit? Pure, exported, and tested directly —
 * including the off state.
 */
export function shouldLog(level, options) {
    const resolved = normalizeLevel(level);
    const minimum = normalizeLevel(options?.minLevel, "info");
    return LOG_LEVELS.indexOf(resolved) >= LOG_LEVELS.indexOf(minimum);
}

// ── Run-scoped log file ──────────────────────────────────────────────────────

/** `YYYYMMDD_HHMMSS`, the legacy `debug_msg/` stamp. Local time, like his. */
export function runStamp(now = new Date()) {
    const pad = (n) => String(n).padStart(2, "0");
    return (
        `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
        `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    );
}

/**
 * Open this run's log file. Returns its path, or null when file logging is off
 * — the caller prints the path so a run always says where its log went.
 */
export function logInit() {
    const options = getLogOptions();
    const now = new Date();
    processStartOn = now;

    if (!options.logToFile) {
        logFilePath = null;
        return null;
    }

    const logsDir = path.resolve(projectRoot, options.logDirectory);
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }

    logFilePath = path.resolve(
        logsDir,
        `${options.logFilePrefix}${runStamp(now)}${options.logFilePostfix}.log`,
    );
    fs.writeFileSync(logFilePath, "");

    return logFilePath;
}

export function getLogPath() {
    return logFilePath;
}

export function getProcessStartOn() {
    return processStartOn;
}

// ── log() ────────────────────────────────────────────────────────────────────

function relativeSource(importMetaUrl) {
    if (!importMetaUrl) return "unknown";
    try {
        const sourceFilePath = fileURLToPath(importMetaUrl);
        return path.relative(projectRoot, sourceFilePath).replace(/\\/g, "/");
    } catch {
        return String(importMetaUrl);
    }
}

/**
 * log("something happened", import.meta.url)
 * log("something broke", "error", import.meta.url)
 *
 * The second argument is a level if it names one, otherwise it is treated as
 * the module url — same forgiving signature as the Fastify template's logger.
 */
export async function log(message, level = "info", importMetaUrl) {
    if (!processStartOn) processStartOn = new Date();

    let resolvedLevel = level;
    let resolvedUrl = importMetaUrl;

    if (
        resolvedUrl === undefined &&
        typeof resolvedLevel === "string" &&
        !LOG_LEVELS.includes(resolvedLevel.toLowerCase())
    ) {
        resolvedUrl = resolvedLevel;
        resolvedLevel = "info";
    }
    resolvedLevel = normalizeLevel(resolvedLevel);

    const options = getLogOptions();
    if (!shouldLog(resolvedLevel, options)) return;

    const source = relativeSource(resolvedUrl);
    const reportOn = new Date();
    const text = String(message);
    const line = `[${reportOn.toISOString()}] [${resolvedLevel.toUpperCase()}] [${source}]: ${text}\n`;

    if (options.logToConsole) {
        console.log(line.trimEnd());
    }

    if (options.logToFile && logFilePath) {
        try {
            await fs.promises.appendFile(logFilePath, line);
        } catch (err) {
            console.error("Error writing to log file:", err);
        }
    }

    if (options.logToDatabase) {
        const row = {
            process_start_on: processStartOn,
            report_on: reportOn,
            report_by: source,
            level: resolvedLevel,
            message: text,
        };

        if (db?.log_message) {
            try {
                await db.log_message.create(row);
            } catch (err) {
                console.error("Error writing log to database:", err.message);
            }
        } else {
            // Logs emitted before the database is up are held, not dropped.
            pendingLogRows.push(row);
        }
    }
}

log.debug = (message, importMetaUrl) => log(message, "debug", importMetaUrl);
log.info = (message, importMetaUrl) => log(message, "info", importMetaUrl);
log.warning = (message, importMetaUrl) => log(message, "warning", importMetaUrl);
log.error = (message, importMetaUrl) => log(message, "error", importMetaUrl);

/** Hand the logger its database and flush anything buffered before it existed. */
export function setDB(dbFromPlugin) {
    db = dbFromPlugin;

    const options = getLogOptions();

    if (!options.logToDatabase) {
        pendingLogRows.length = 0;
        return;
    }

    if (db?.log_message && pendingLogRows.length > 0) {
        const rows = pendingLogRows.splice(0, pendingLogRows.length);
        Promise.all(rows.map((row) => db.log_message.create(row))).catch((err) => {
            console.error("Error flushing buffered logs to database:", err.message);
        });
    }
}

export function getPendingLogCount() {
    return pendingLogRows.length;
}

// ── Query logging (Sequelize) ────────────────────────────────────────────────

let queryLogFilePath = null;

export function queryLogInit() {
    const options = getQueryLogOptions();

    if (!options.logToFile) {
        queryLogFilePath = null;
        return null;
    }

    const logsDir = path.resolve(projectRoot, options.logDirectory);
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }

    queryLogFilePath = path.resolve(
        logsDir,
        `${options.logFilePrefix}${runStamp()}${options.logFilePostfix}.log`,
    );
    fs.writeFileSync(queryLogFilePath, "");

    return queryLogFilePath;
}

export function logQuery(query, durationMs) {
    const options = getQueryLogOptions();
    const text = typeof query === "string" ? query : JSON.stringify(query);
    const duration = Number.isFinite(durationMs) ? ` (${durationMs}ms)` : "";
    const line = `[${new Date().toISOString()}] Query${duration}: ${text}\n`;

    if (options.logToConsole) {
        console.log(line.trimEnd());
    }

    if (options.logToFile && queryLogFilePath) {
        fs.promises.appendFile(queryLogFilePath, line).catch((err) => {
            console.error("Error writing query log to file:", err.message);
        });
    }
}

// ── Small formatting helpers ─────────────────────────────────────────────────
// The legacy `basic` class carried these (add_s, a_an, get_time). They are
// display helpers, so they live here and not in the data layer.

/** `1 coin` / `2 coins` — the legacy `add_s`. */
export function addS(count, word) {
    return `${count} ${word}${Number(count) === 1 ? "" : "s"}`;
}

/** `a rod` / `an apple` — the legacy `a_an`. */
export function aAn(word) {
    return `${/^[aeiou]/i.test(String(word)) ? "an" : "a"} ${word}`;
}

export function projectRootPath() {
    return projectRoot;
}

/**
 * app/bot/presence.js — the rotating status, and the avatar self-check.
 *
 * Both are his, from `MCGB_Main.py`.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ⭐ THE ROTATING STATUS
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 *     @tasks.loop(seconds=7)
 *     async def change_status():
 *         await client.change_presence(activity = discord.Game(next(statut_out)))
 *
 * A `cycle()` over 14 lines, one every **7 seconds**.
 *
 * ⚠️ **THE INTERVAL IS CHANGED, AND THIS IS THE ONE THING HERE THAT IS NOT FAITHFUL.** Seven
 * seconds is **12,342 presence updates a day**. Presence is rate-limited per session (about 5 per
 * 20 seconds), so his was not far off the ceiling for something purely decorative, and a presence
 * update is a gateway write on a connection the bot needs for actual commands. It is 60 seconds
 * here, configurable via `bot.status_interval_seconds`, and a floor stops anyone setting it back
 * into rate-limit territory by accident.
 *
 * ⭐ His list is kept nearly verbatim — it is the bot's voice — with the dead references dropped
 * ("Invite link is HERE👇" pointed at a message that no longer exists) and the prefix line
 * rewritten, because `<Prefix>Help` is not how you reach help any more.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ⭐ THE AVATAR SELF-CHECK
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * His downloaded the live avatar, compared the bytes to `data/files/avatar_pic/profile.png`, and
 * re-uploaded if they differed — then retried in a loop on failure. A neat idea: the bot notices
 * if someone changed its face and puts it back.
 *
 * ⚠️ **BUT HIS RETRY LOOP IS THE ONE THING NOT TO COPY.** Discord rate-limits avatar changes
 * HARD — roughly **two per hour**, and exceeding it can return a long cooldown. A loop that
 * retries a rejected avatar edit will burn that budget and then keep failing. So this attempts it
 * **once per boot**, logs the outcome either way, and never retries.
 *
 * ⚠️ It is also **OFF unless a file is configured** (`bot.avatar_file`), because uploading an
 * avatar is a visible, rate-limited, account-level change and it should not happen because
 * someone cloned a repo and started it.
 *
 * ⚠️ A byte comparison is not possible without re-encoding — Discord re-encodes what you upload,
 * so the bytes never match and his check would have re-uploaded on **every boot**. Discord's own
 * avatar **hash** is what identifies the image, so this stores the hash of the last successful
 * upload in `logs/avatar-state.json` and compares that instead.
 */

import fs from "node:fs";
import path from "node:path";

import { ActivityType } from "discord.js";

import { log, projectRootPath } from "../../lib/utility.js";

/** ⭐ His list, tidied. Order preserved; duplicates were his cycle padding and are kept. */
export const DEFAULT_STATUS_LINES = [
    "/help for everything",
    "Support written translations 🌐",
    "Let's try a mini game 🎮",
    "Guess the number 🔀🔢?",
    "Blackjack 🃏? OX 🗳️?",
    "Wordle 📜? Dice 🎲?",
    "/help for everything",
    "Fishing 🎣 for coins 🪙",
    "I'm here 4 U 🤗",
    "Discover more using /help",
];

export const PRESENCE_RULES = {
    DEFAULT_INTERVAL_SECONDS: 60,
    /** ⚠️ Presence is rate-limited ~5 per 20s. Below this is asking for trouble. */
    MIN_INTERVAL_SECONDS: 15,
};

const AVATAR_STATE_FILE = () => path.resolve(projectRootPath(), "logs", "avatar-state.json");

/** Resolve the interval, clamped. Returns null when rotation is switched off. */
export function statusIntervalSeconds(config) {
    const configured = config?.bot?.status_interval_seconds;
    if (configured === null || configured === false) return null;
    const seconds = Number(configured ?? PRESENCE_RULES.DEFAULT_INTERVAL_SECONDS);
    if (!Number.isFinite(seconds) || seconds <= 0) return PRESENCE_RULES.DEFAULT_INTERVAL_SECONDS;
    return Math.max(PRESENCE_RULES.MIN_INTERVAL_SECONDS, Math.round(seconds));
}

export function statusLines(config) {
    const configured = config?.bot?.status_lines;
    if (Array.isArray(configured) && configured.length > 0) {
        return configured.filter((line) => typeof line === "string" && line.trim().length > 0);
    }
    return DEFAULT_STATUS_LINES;
}

/**
 * His `cycle()`, as a generator. Pure and testable: given a list, it yields forever in order.
 *
 * ⚠️ Returns a function rather than an index, so nothing outside has to track position — his
 * `statut_out` was a module-level iterator, which is the same shape but not inspectable.
 */
export function cycleLines(lines) {
    let index = 0;
    return () => {
        const line = lines[index % lines.length];
        index += 1;
        return line;
    };
}

let rotation = null;

/** Start rotating. Idempotent — calling twice does not create two timers. */
export async function startStatusRotation(client, config) {
    stopStatusRotation();

    const seconds = statusIntervalSeconds(config);
    if (seconds === null) {
        await log("status rotation is OFF (bot.status_interval_seconds is null)", import.meta.url);
        return null;
    }

    const next = cycleLines(statusLines(config));

    const tick = () => {
        try {
            client.user?.setPresence({
                activities: [{ name: next(), type: ActivityType.Playing }],
                status: "online",
            });
        } catch (err) {
            // A failed presence update is cosmetic. Logged, never thrown — this runs on a timer
            // with nobody to catch it.
            void log(`presence update failed: ${err.message}`, "warning", import.meta.url);
        }
    };

    tick(); // Set one immediately, so a restart shows something before the first interval.
    rotation = setInterval(tick, seconds * 1000);
    // ⚠️ unref() so a lingering timer cannot hold the process open during shutdown.
    rotation.unref?.();

    await log(`status rotation every ${seconds}s over ${statusLines(config).length} line(s)`, import.meta.url);
    return rotation;
}

export function stopStatusRotation() {
    if (rotation) {
        clearInterval(rotation);
        rotation = null;
    }
}

/** Set one fixed presence and stop rotating — used by the restart countdown. */
export async function setFixedPresence(client, text) {
    stopStatusRotation();
    try {
        client.user?.setPresence({
            activities: [{ name: text, type: ActivityType.Playing }],
            status: "idle",
        });
    } catch (err) {
        await log(`could not set a fixed presence: ${err.message}`, "warning", import.meta.url);
    }
}

// ── the avatar self-check ────────────────────────────────────────────────────

function readAvatarState() {
    try {
        return JSON.parse(fs.readFileSync(AVATAR_STATE_FILE(), "utf8"));
    } catch {
        return {};
    }
}

function writeAvatarState(state) {
    try {
        fs.mkdirSync(path.dirname(AVATAR_STATE_FILE()), { recursive: true });
        fs.writeFileSync(AVATAR_STATE_FILE(), JSON.stringify(state, null, 2), "utf8");
    } catch (err) {
        void log(`could not record the avatar state: ${err.message}`, "warning", import.meta.url);
    }
}

/**
 * Put the configured avatar back if it has changed. ONCE per boot, never retried.
 *
 * @returns {Promise<"disabled"|"missing"|"unchanged"|"restored"|"failed">}
 */
export async function checkAvatar(client, config) {
    const configured = config?.bot?.avatar_file;
    if (!configured) return "disabled"; // Off by default — see the header.

    const file = path.isAbsolute(configured)
        ? configured
        : path.resolve(projectRootPath(), configured);

    if (!fs.existsSync(file)) {
        await log(`avatar check: ${configured} does not exist, skipping`, "warning", import.meta.url);
        return "missing";
    }

    const liveHash = client.user?.avatar ?? null;
    const state = readAvatarState();

    // ⚠️ Compared by Discord's HASH, not by bytes. Discord re-encodes uploads, so his byte
    // comparison could never match and would have re-uploaded on every single boot.
    if (liveHash && state.uploadedHash && state.uploadedHash === liveHash && state.sourceFile === file) {
        return "unchanged";
    }

    try {
        await client.user.setAvatar(fs.readFileSync(file));
        writeAvatarState({
            uploadedHash: client.user?.avatar ?? null,
            sourceFile: file,
            at: new Date().toISOString(),
        });
        await log(`avatar check: restored from ${configured}`, "warning", import.meta.url);
        return "restored";
    } catch (err) {
        // ⚠️ NO RETRY. Avatar changes are limited to roughly two an hour; retrying a rejection
        // burns the budget and keeps failing. His looped here.
        await log(
            `avatar check: could not set the avatar (NOT retrying — Discord limits this to ~2/hour): ${err.message}`,
            "warning",
            import.meta.url,
        );
        return "failed";
    }
}

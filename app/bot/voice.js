/**
 * app/bot/voice.js — one voice session per guild, with an event-driven speech queue.
 *
 * ⭐ This is the part of his `tts_cog` that most needed rewriting rather than translating. His
 * queue was:
 *
 *     while True:
 *         if len(queue) > 0:
 *             while True:
 *                 if voice_client == None: running = False; return
 *                 elif voice_client.is_playing(): await asyncio.sleep(0.3); continue
 *                 del queue[0]; play_tts(...); break
 *
 * — two nested infinite loops polling five times a second, per guild, forever. `@discordjs/voice`
 * emits a state change when a track ends, so the queue here **advances on an event** and costs
 * nothing between utterances.
 *
 * ⚠️ NO OPUS LIBRARY AND NO TEMP FILES. `ffmpeg` is asked to output **ogg/opus** directly, so
 * `@discordjs/voice` can pass the packets through untouched — no `@discordjs/opus` native build,
 * and no PCM re-encode in JavaScript. The mp3 goes in on stdin and Opus comes out on stdout, which
 * also means his `tts_temp/{server_id}_tts.mp3` — one shared path per guild, overwritten while
 * being read — has no equivalent here to collide over.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { Readable } from "node:stream";

import {
    AudioPlayerStatus,
    NoSubscriberBehavior,
    StreamType,
    VoiceConnectionStatus,
    createAudioPlayer,
    createAudioResource,
    entersState,
    getVoiceConnection,
    joinVoiceChannel,
} from "@discordjs/voice";

import { log } from "../../lib/utility.js";
import { TTS_RULES, chunkText, fetchSpeech } from "../data/tts.js";

/** guildId → session */
const sessions = new Map();

/**
 * Prefer the bundled binary so this works on a machine with no ffmpeg on PATH.
 *
 * ⚠️ `createRequire` because `ffmpeg-static` is CommonJS and exports a path string — there is no
 * ESM named export to import. A bare `require()` here would be a ReferenceError in a module file.
 * Resolved once at load rather than per utterance.
 */
const requireCjs = createRequire(import.meta.url);

const FFMPEG = (() => {
    try {
        return requireCjs("ffmpeg-static") || "ffmpeg";
    } catch {
        return "ffmpeg";
    }
})();

function ffmpegPath() {
    return FFMPEG;
}

/**
 * mp3 bytes → an ogg/opus stream Discord can take as-is.
 *
 * ⚠️ stderr is consumed and discarded rather than left unpiped. An unread stderr pipe fills its
 * buffer and **the child blocks forever** — a hang that looks exactly like a silent bot.
 */
function toOpusStream(mp3) {
    const ffmpeg = spawn(
        ffmpegPath(),
        [
            "-hide_banner", "-loglevel", "error",
            "-i", "pipe:0",
            "-vn",
            "-c:a", "libopus",
            "-b:a", "48k",
            "-ar", "48000",
            "-ac", "2",
            "-f", "ogg",
            "pipe:1",
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
    );

    ffmpeg.stderr.resume();
    ffmpeg.on("error", (err) => {
        void log(`tts: ffmpeg could not start (${ffmpegPath()}): ${err.message}`, "error", import.meta.url);
    });

    Readable.from(mp3).pipe(ffmpeg.stdin).on("error", () => {
        // ffmpeg exiting early closes stdin; that is not worth an error line.
    });

    return ffmpeg.stdout;
}

function createSession(guildId, channelId, textChannelId, connection) {
    const player = createAudioPlayer({
        // ⚠️ Keep playing with nobody listening rather than pausing: a paused player never reaches
        // Idle, so the queue would stall and never drain.
        behaviors: { noSubscriber: NoSubscriberBehavior.Play },
    });

    const session = {
        guildId: String(guildId),
        voiceChannelId: String(channelId),
        textChannelId: String(textChannelId),
        connection,
        player,
        queue: [],
        speaking: false,
        spoken: 0,
        dropped: 0,
    };

    connection.subscribe(player);

    // ⭐ The event his polling loop was standing in for.
    player.on(AudioPlayerStatus.Idle, () => {
        session.speaking = false;
        void drain(session);
    });

    player.on("error", (err) => {
        session.speaking = false;
        void log(`tts: player error in ${guildId}: ${err.message}`, "warning", import.meta.url);
        void drain(session);
    });

    connection.on(VoiceConnectionStatus.Disconnected, () => {
        // Dragged out, kicked, or the channel deleted. Drop the session rather than leaving a
        // queue draining into nothing — his checked for this INSIDE the loop only.
        void leaveVoice(guildId, "disconnected");
    });

    sessions.set(String(guildId), session);
    return session;
}

/** Play the next chunk, if any. Re-entrant-safe via the `speaking` flag. */
async function drain(session) {
    if (session.speaking) return;

    const next = session.queue.shift();
    if (!next) return;

    session.speaking = true;

    try {
        const mp3 = await fetchSpeech(next.text, next.lang);
        const resource = createAudioResource(toOpusStream(mp3), { inputType: StreamType.OggOpus });
        session.player.play(resource);
        session.spoken += 1;
    } catch (err) {
        // One failed utterance must not stop the queue — skip it and carry on.
        session.speaking = false;
        await log(`tts: could not speak a chunk in ${session.guildId}: ${err.message}`, "warning", import.meta.url);
        void drain(session);
    }
}

export function getSession(guildId) {
    return sessions.get(String(guildId)) ?? null;
}

export function activeSessions() {
    return [...sessions.values()];
}

/**
 * Join a voice channel and bind a text channel to it.
 *
 * @returns {Promise<{session: object, rejoined: boolean}>}
 */
export async function joinVoice({ guild, voiceChannelId, textChannelId }) {
    const existing = sessions.get(String(guild.id));
    if (existing) {
        existing.textChannelId = String(textChannelId);
        return { session: existing, rejoined: true };
    }

    const connection = joinVoiceChannel({
        channelId: String(voiceChannelId),
        guildId: String(guild.id),
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: false,
    });

    try {
        // ⚠️ Awaited with a timeout. Without this, a connection that never becomes Ready leaves the
        // command reporting success and the bot silently mute.
        await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    } catch (err) {
        connection.destroy();
        throw new Error(`could not connect to the voice channel: ${err.message}`);
    }

    const session = createSession(guild.id, voiceChannelId, textChannelId, connection);
    await log(`tts: joined voice ${voiceChannelId} in guild ${guild.id}`, import.meta.url);
    return { session, rejoined: false };
}

/**
 * Queue something to say. Returns what happened, rather than throwing on a full queue.
 *
 * ⚠️ **THE QUEUE IS CAPPED** — his was not, in a feature that reads out whatever anyone types.
 * Over the cap, new utterances are DROPPED rather than the oldest evicted: dropping the newest
 * keeps the room hearing a coherent conversation instead of fragments of several.
 */
export async function say(guildId, text, lang = "en") {
    const session = sessions.get(String(guildId));
    if (!session) return { spoken: false, reason: "NOT_CONNECTED" };

    const chunks = chunkText(text);
    if (chunks.length === 0) return { spoken: false, reason: "NOTHING_TO_SAY" };

    if (session.queue.length + chunks.length > TTS_RULES.MAX_QUEUE) {
        session.dropped += 1;
        return { spoken: false, reason: "QUEUE_FULL", queued: session.queue.length };
    }

    for (const chunk of chunks) session.queue.push({ text: chunk, lang });
    void drain(session);

    return { spoken: true, chunks: chunks.length, queued: session.queue.length };
}

/** Empty the queue and stop the current utterance. */
export function stopSpeaking(guildId) {
    const session = sessions.get(String(guildId));
    if (!session) return 0;

    const dropped = session.queue.length;
    session.queue.length = 0;
    session.player.stop(true);
    session.speaking = false;
    return dropped;
}

/** Leave, and tear everything down. Safe to call when not connected — his `del` raised KeyError. */
export async function leaveVoice(guildId, reason = "asked") {
    const key = String(guildId);
    const session = sessions.get(key);

    // Destroy any connection even without a session, in case one was left behind by a restart.
    const connection = session?.connection ?? getVoiceConnection(key);

    if (session) {
        session.queue.length = 0;
        try {
            session.player.stop(true);
        } catch {
            /* already stopped */
        }
        sessions.delete(key);
    }

    if (connection) {
        try {
            connection.destroy();
        } catch {
            // Already destroyed — this is the path a Disconnected event takes.
        }
    }

    if (session) {
        await log(
            `tts: left voice in guild ${key} (${reason}) after ${session.spoken} utterance(s), ` +
            `${session.dropped} dropped`,
            import.meta.url,
        );
    }

    return Boolean(session);
}

/** Called on shutdown, so a restart does not leave the bot sitting mute in a channel. */
export async function leaveAllVoice() {
    const ids = [...sessions.keys()];
    for (const id of ids) await leaveVoice(id, "shutting down");
    return ids.length;
}

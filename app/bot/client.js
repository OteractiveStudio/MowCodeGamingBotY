/**
 * app/bot/client.js — construct the discord.js client. Nothing else.
 *
 * ⚠️ INTENTS, and why this list is short:
 *
 * The legacy bot's whole natural-language layer lived in `on_message` — several
 * cogs each had one, and `fishing_cog.on_message` even ran a network translation
 * call on EVERY message just to test whether it started with "fish".
 *
 * Since 2022 **Message Content is a privileged intent**. Without it approved in
 * the developer portal, `message.content` arrives EMPTY — the handler runs and
 * silently sees nothing, which is the worst possible failure shape.
 *
 * So this client asks for the minimum, and the command surface is slash commands: no privileged
 * intent needed for the core of it, no approval, no empty-string mystery. MessageContent IS now
 * requested (typed guesses, wordle, the prefix redirect) but only via config, and login falls back
 * without it.
 *
 * ⚠️ `GuildVoiceStates` is also in the list and is NOT privileged — see the comment on it below.
 * Its absence is invisible at login and breaks voice with a message that names the wrong cause.
 */

import { Client, GatewayIntentBits, Options } from "discord.js";

/**
 * ⚠️ MESSAGE CONTENT IS A PRIVILEGED INTENT, and asking for it without enabling it in the
 * developer portal makes **login itself fail** with `DisallowedIntents` — the bot does not start
 * at all. So it is opt-in via `discord.message_content_intent`, and `app/bot/index.js` retries
 * without it if the portal toggle is off, rather than leaving a dead bot.
 *
 * Verification is only required above 100 servers; below that the toggle is simply a switch.
 *
 * `GuildMessages` comes with it: the intent grants the CONTENT, but the message events themselves
 * need their own intent, and one without the other is a listener that never fires.
 */
export function createClient(config, { withMessageContent = null } = {}) {
    const wantsMessageContent =
        withMessageContent ?? config?.discord?.message_content_intent === true;

    const intents = [
        GatewayIntentBits.Guilds,

        // 🔑 REQUIRED FOR VOICE, AND ITS ABSENCE LOOKS LIKE SOMETHING ELSE ENTIRELY.
        //
        // ⚠️ This was missing when `/tts` first shipped, and the symptom was
        // *"Could not join. could not connect to the voice channel: The operation was aborted"* —
        // which reads like a network problem, a permissions problem, or a broken ffmpeg. It is
        // none of those.
        //
        // `joinVoiceChannel()` sends the gateway a request and then WAITS for the
        // `VOICE_STATE_UPDATE` and `VOICE_SERVER_UPDATE` events carrying the session id and the
        // voice endpoint. Without this intent those events never arrive, so the connection sits in
        // Signalling forever and the only thing that ever fires is our own
        // `entersState(..., Ready, 15_000)` timeout — an AbortError, hence "the operation was
        // aborted". Nothing in the message names the real cause.
        //
        // It also populates the voice-state cache, which is what `interaction.member.voice.channel`
        // reads — so without it `/tts join` cannot even find which channel you are sitting in.
        //
        // ⭐ It is NOT a privileged intent: no portal toggle, no verification, nothing to approve.
        // Which is exactly why it is easy to forget — unlike MessageContent, leaving it out does
        // not stop the bot logging in. It just quietly breaks voice.
        GatewayIntentBits.GuildVoiceStates,
    ];

    if (wantsMessageContent) {
        intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
    }

    return new Client({
        intents,

        // Cache only what a command actually reads. The legacy bot kept game
        // state in module-level globals, so two guilds playing at once corrupted
        // each other; the fix is keyed state in the store, which also means the
        // client has no reason to hold large caches in memory.
        //
        // ⚠️ VoiceStateManager is deliberately NOT capped here. `/tts` reads it to find your
        // channel and to check whether anyone is still listening, and a zero-size cache would
        // reintroduce the same failure this intent exists to fix.
        makeCache: Options.cacheWithLimits({
            ...Options.DefaultMakeCacheSettings,
            MessageManager: 0,
            PresenceManager: 0,
        }),
    });
}

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
 * So this client asks for `Guilds` only, and the command surface is slash
 * commands: no privileged intent, no approval, no empty-string mystery. If the
 * prefix/on_message surface comes back, MessageContent gets added HERE and
 * nowhere else, and the decision gets recorded in the carry-on.
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

    const intents = [GatewayIntentBits.Guilds];
    if (wantsMessageContent) {
        intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
    }

    return new Client({
        intents,

        // Cache only what a command actually reads. The legacy bot kept game
        // state in module-level globals, so two guilds playing at once corrupted
        // each other; the fix is keyed state in the store, which also means the
        // client has no reason to hold large caches in memory.
        makeCache: Options.cacheWithLimits({
            ...Options.DefaultMakeCacheSettings,
            MessageManager: 0,
            PresenceManager: 0,
        }),
    });
}

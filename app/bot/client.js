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

export function createClient() {
    return new Client({
        intents: [GatewayIntentBits.Guilds],

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

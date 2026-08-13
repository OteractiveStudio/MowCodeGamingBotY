/**
 * Unit: the gateway intents the client asks for.
 *
 * ⚠️ THIS FILE EXISTS BECAUSE OF A LIVE FAILURE. `/tts` shipped without
 * `GuildVoiceStates`, and Ote's first `/tts join` answered:
 *
 *     Could not join. could not connect to the voice channel: The operation was aborted
 *
 * — which reads like a network fault, a permissions fault, or a broken ffmpeg. It was none of
 * those. `joinVoiceChannel()` waits for `VOICE_STATE_UPDATE` and `VOICE_SERVER_UPDATE`; without
 * that intent they never arrive, the connection stays in Signalling, and the only thing that ever
 * fires is our own 15-second `entersState` timeout.
 *
 * 🔑 The reason it slipped through: **GuildVoiceStates is NOT privileged**, so unlike
 * MessageContent its absence does not stop the bot logging in. Everything looks healthy and voice
 * is simply dead. An intent list is exactly the kind of thing that needs asserting rather than
 * eyeballing.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GatewayIntentBits } from "discord.js";

import { createClient } from "../../app/bot/client.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Build a client, read its intents, and always destroy it. */
function intentsFor(config, options) {
    const client = createClient(config, options);
    try {
        return client.options.intents;
    } finally {
        // Not awaited: nothing was ever connected, so there is nothing to close gracefully.
        void client.destroy();
    }
}

export default [
    {
        label: "🔑 GuildVoiceStates is ALWAYS requested — /tts cannot connect without it",
        fn: () => {
            // Unconditional, not tied to a config flag: it is unprivileged, it costs nothing, and
            // making it optional is how it went missing in the first place.
            for (const config of [{}, { discord: {} }, { discord: { message_content_intent: false } }]) {
                const intents = intentsFor(config);
                assert.ok(
                    intents.has(GatewayIntentBits.GuildVoiceStates),
                    "without GuildVoiceStates, joinVoiceChannel() times out with " +
                    '"The operation was aborted" and names the wrong cause',
                );
            }
        },
    },
    {
        label: "Guilds is always requested — nothing works without it",
        fn: () => {
            assert.ok(intentsFor({}).has(GatewayIntentBits.Guilds));
        },
    },
    {
        label: "⚠️ MessageContent is OPT-IN, because asking without the portal toggle kills login",
        fn: () => {
            // DisallowedIntents is a login failure, not a degraded feature — hence the config flag
            // and the fallback in app/bot/index.js.
            const off = intentsFor({ discord: { message_content_intent: false } });
            assert.equal(off.has(GatewayIntentBits.MessageContent), false);
            assert.equal(off.has(GatewayIntentBits.GuildMessages), false);

            const on = intentsFor({ discord: { message_content_intent: true } });
            assert.ok(on.has(GatewayIntentBits.MessageContent));
            assert.ok(on.has(GatewayIntentBits.GuildMessages),
                "the content intent grants CONTENT; the events need their own intent");
        },
    },
    {
        label: "the explicit override wins over config, for the login fallback",
        fn: () => {
            const forcedOff = intentsFor({ discord: { message_content_intent: true } }, {
                withMessageContent: false,
            });
            assert.equal(forcedOff.has(GatewayIntentBits.MessageContent), false,
                "index.js rebuilds without it after DisallowedIntents");

            // Voice survives the fallback — it is unrelated to the privileged intent.
            assert.ok(forcedOff.has(GatewayIntentBits.GuildVoiceStates));
        },
    },
    {
        label: "⚠️ the voice-state cache is NOT zeroed — /tts reads it to find your channel",
        fn: () => {
            // MessageManager and PresenceManager are deliberately capped at 0. VoiceStateManager
            // must NOT be, or `interaction.member.voice.channel` is always null and the same
            // failure returns by a different route.
            //
            // ⚠️ Asserted against the SOURCE, because `makeCache` is an opaque factory function —
            // there is nothing on the built client to inspect. An earlier version of this test
            // "passed" by asserting `typeof makeCache === "function"`, which is true no matter what
            // the limits are: a check that cannot fail.
            const source = fs.readFileSync(
                path.join(projectRoot, "app", "bot", "client.js"),
                "utf8",
            );

            const limits = source.slice(source.indexOf("cacheWithLimits"));
            assert.ok(limits.length > 0, "cacheWithLimits should be how the caches are configured");

            const zeroed = [...limits.matchAll(/(\w+Manager):\s*0/g)].map((m) => m[1]);
            assert.ok(zeroed.includes("MessageManager"), "MessageManager should still be capped");
            assert.ok(
                !zeroed.includes("VoiceStateManager"),
                "VoiceStateManager must not be zeroed — /tts join could not find your channel",
            );
            assert.ok(
                !zeroed.includes("GuildManager") && !zeroed.includes("ChannelManager"),
                "zeroing guilds or channels would break command routing",
            );
        },
    },
    {
        label: "no privileged intent is requested by accident",
        fn: () => {
            // GuildPresences and GuildMembers are both privileged and neither is needed. Asking for
            // either would be a login failure waiting for the next deploy.
            const intents = intentsFor({ discord: { message_content_intent: true } });
            assert.equal(intents.has(GatewayIntentBits.GuildPresences), false);
            assert.equal(intents.has(GatewayIntentBits.GuildMembers), false);
        },
    },
];

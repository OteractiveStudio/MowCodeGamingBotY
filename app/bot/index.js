/**
 * app/bot/index.js — build the bot from its parts and log it in.
 *
 * Order matters: cogs are loaded and validated BEFORE the client connects, so a
 * malformed cog or a duplicate command name fails on the ground instead of after
 * the bot is live in twelve servers.
 */

import { createClient } from "./client.js";
import { loadCogs, attachCogEvents } from "./loader.js";
import { attachCommandDispatch } from "./dispatch.js";
import { warnIfCommandsDrifted } from "./registry.js";
import { log } from "../../lib/utility.js";

export async function startBot({ config, db }) {
    const token = config?.discord?.token;

    if (!token) {
        // Fail fast on a precondition, and say exactly what is missing and where
        // it goes. Never invent a fallback for a credential.
        throw new Error(
            "config.json `discord.token` is empty. Create the application at " +
            "https://discord.com/developers/applications, copy the BOT token into " +
            "config.json (gitignored), and set discord.application_id too. " +
            "Set `discord.enabled: false` to run the HTTP surface without the bot.",
        );
    }

    const { cogs, commands } = await loadCogs();
    await log(
        `loaded ${cogs.length} cog(s): ${cogs.map((c) => c.name).join(", ")} — ` +
        `${commands.size} command(s): ${[...commands.keys()].map((n) => "/" + n).join(", ")}`,
        import.meta.url,
    );

    const wantsMessageContent = config.discord?.message_content_intent === true;
    let client = createClient(config, { withMessageContent: wantsMessageContent });

    /**
     * The cog's whole world, injected. Replaces the legacy `b = basic("x")` that
     * every cog constructed for itself at import time.
     */
    const ctx = { client, db, config, log, cogs, commands, messageContent: wantsMessageContent };

    /** Everything that has to be re-done if the client has to be rebuilt. */
    const wire = async () => {
        ctx.client = client;
        for (const cog of cogs) {
            if (typeof cog.setup === "function") await cog.setup(ctx);
        }
        const eventCount = attachCogEvents(client, cogs, ctx);
        attachCommandDispatch(client, commands, ctx);
        await log(`wired ${eventCount} event binding(s)`, import.meta.url);
    };

    await wire();

    try {
        await client.login(token);
    } catch (err) {
        // ⚠️ Asking for Message Content without the portal toggle makes LOGIN fail outright, so
        // the whole bot would be down over one optional feature. Retry without it and say exactly
        // which switch to flip — a degraded bot that explains itself beats a dead one.
        const disallowed =
            wantsMessageContent &&
            /disallowed intent/i.test(`${err.message} ${err.code ?? ""}`);

        if (!disallowed) throw err;

        await log(
            "⚠️ Discord refused the MESSAGE CONTENT intent, so typing a guess in chat will not work.\n" +
            "   Enable it at: Developer Portal → your application → Bot → Privileged Gateway Intents\n" +
            "   → Message Content Intent → ON. (No verification needed below 100 servers.)\n" +
            "   Starting WITHOUT it — the Guess button still works.",
            "warning",
            import.meta.url,
        );

        await client.destroy().catch(() => {});
        client = createClient(config, { withMessageContent: false });
        ctx.messageContent = false;
        await wire();
        await client.login(token);
    }

    // Editing an execute() needs no re-registration; touching a SlashCommandBuilder
    // does, and forgetting is silent. One API call turns that into a log line.
    // It cannot throw and cannot block: see warnIfCommandsDrifted.
    if (config.discord?.check_command_drift !== false) {
        await warnIfCommandsDrifted({ config, commands });
    }

    return { client, cogs, commands, ctx };
}

export async function stopBot(client) {
    if (client) {
        await client.destroy();
    }
}

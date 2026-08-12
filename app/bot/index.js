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

    const client = createClient();

    /**
     * The cog's whole world, injected. Replaces the legacy `b = basic("x")` that
     * every cog constructed for itself at import time.
     */
    const ctx = { client, db, config, log, cogs, commands };

    for (const cog of cogs) {
        if (typeof cog.setup === "function") {
            await cog.setup(ctx);
            await log.debug(`cog "${cog.name}" setup() ran`, import.meta.url);
        }
    }

    const eventCount = attachCogEvents(client, cogs, ctx);
    attachCommandDispatch(client, commands, ctx);
    await log(`wired ${eventCount} event binding(s)`, import.meta.url);

    await client.login(token);

    return { client, cogs, commands, ctx };
}

export async function stopBot(client) {
    if (client) {
        await client.destroy();
    }
}

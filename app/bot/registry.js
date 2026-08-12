/**
 * app/bot/registry.js — publish the slash command list to Discord.
 *
 * Slash commands have to be REGISTERED with Discord before they appear; the code
 * existing is not enough. This is the one place that talks to that endpoint.
 *
 *   npm run bot:register        publish (guild-scoped if config.discord.dev_guild_id is set)
 *
 * ⚠️ Guild-scoped registration is instant; GLOBAL registration can take up to an
 * hour to propagate. Set `discord.dev_guild_id` while developing so you are not
 * debugging a cache.
 *
 * ❌ UNVERIFIED: this has never run against the real Discord API — there is no
 * bot token in config.json yet. The shape follows discord.js's documented REST
 * usage, but treat the first real run as the test.
 */

import { REST, Routes } from "discord.js";

import { loadConfig, log } from "../../lib/utility.js";
import { loadCogs } from "./loader.js";

export function collectCommandPayload(commands) {
    return [...commands.values()].map(({ command }) => command.data.toJSON());
}

export async function publishCommands(config = loadConfig()) {
    const discord = config?.discord || {};

    const missing = ["token", "application_id"].filter((key) => !discord[key]);
    if (missing.length > 0) {
        throw new Error(
            `Cannot register commands: config.json \`discord\` is missing ${missing.join(", ")}. ` +
            `The token comes from the Discord developer portal and lives ONLY in config.json (gitignored).`,
        );
    }

    const { commands } = await loadCogs();
    const payload = collectCommandPayload(commands);

    if (payload.length === 0) {
        throw new Error("No commands found in app/cogs/ — nothing to register.");
    }

    const rest = new REST({ version: "10" }).setToken(discord.token);

    const route = discord.dev_guild_id
        ? Routes.applicationGuildCommands(discord.application_id, discord.dev_guild_id)
        : Routes.applicationCommands(discord.application_id);

    const scope = discord.dev_guild_id
        ? `guild ${discord.dev_guild_id} (instant)`
        : "GLOBAL (can take up to an hour to appear)";

    await log(
        `registering ${payload.length} command(s) to ${scope}: ${payload.map((c) => "/" + c.name).join(", ")}`,
        import.meta.url,
    );

    const result = await rest.put(route, { body: payload });

    await log(`registered ${result.length} command(s)`, import.meta.url);
    return result;
}

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

// ── Drift detection ──────────────────────────────────────────────────────────
//
// The command's SHAPE lives on Discord; its BEHAVIOUR lives in the code. Editing an
// `execute()` needs no re-registration, but touching a SlashCommandBuilder does — and
// forgetting is silent in both directions: a new option simply never appears, or a
// deleted command still shows up and finds no handler.
//
// ⚠️ THE HARD PART IS NOT THE COMPARISON, IT IS AVOIDING FALSE ALARMS. Discord returns
// fields we never sent (`id`, `application_id`, `version`, `nsfw`, normalised
// `contexts`) and omits defaults we did send (`required: false`). A naive deep-equal
// would report drift on every boot, and a check that always complains is a check
// nobody reads. So both sides are reduced to the fields that actually change what a
// user sees, and nothing else is compared.

/** Reduce an option (or subcommand — they nest) to the fields worth comparing. */
function normaliseOption(option) {
    return {
        type: option.type,
        name: option.name,
        description: option.description ?? "",
        required: option.required ?? false,
        autocomplete: option.autocomplete ?? false,
        min_value: option.min_value ?? null,
        max_value: option.max_value ?? null,
        choices: (option.choices ?? []).map((choice) => ({
            name: choice.name,
            value: choice.value,
        })),
        options: (option.options ?? []).map(normaliseOption),
    };
}

/**
 * Reduce a command to its comparable shape.
 *
 * ⚠️ Deliberately NOT compared: `contexts`, `integration_types`,
 * `default_member_permissions`, `nsfw`. Discord normalises those (an unset `contexts`
 * comes back populated), so including them produces drift reports that are the
 * instrument lying rather than a real difference.
 */
export function normaliseCommand(command) {
    return {
        name: command.name,
        description: command.description ?? "",
        options: (command.options ?? []).map(normaliseOption),
    };
}

/** Name the FIRST real difference, so a warning is actionable rather than "differs". */
export function describeDifference(local, remote) {
    if (local.description !== remote.description) return "description differs";

    if (local.options.length !== remote.options.length) {
        return `option count differs (code has ${local.options.length}, Discord has ${remote.options.length})`;
    }

    for (let index = 0; index < local.options.length; index += 1) {
        const a = local.options[index];
        const b = remote.options[index];

        if (a.name !== b.name) return `option ${index + 1} is "${a.name}" in code, "${b.name}" on Discord`;
        if (a.type !== b.type) return `option "${a.name}" has a different type`;
        if (a.description !== b.description) return `option "${a.name}" description differs`;
        if (a.required !== b.required) return `option "${a.name}" required differs`;
        if (a.autocomplete !== b.autocomplete) return `option "${a.name}" autocomplete differs`;
        if (a.min_value !== b.min_value || a.max_value !== b.max_value) {
            return `option "${a.name}" min/max differs`;
        }
        if (JSON.stringify(a.choices) !== JSON.stringify(b.choices)) {
            return `option "${a.name}" choices differ`;
        }
        if (JSON.stringify(a.options) !== JSON.stringify(b.options)) {
            const nested = describeDifference(a, b);
            return `under "${a.name}": ${nested}`;
        }
    }

    return "shape differs";
}

/**
 * Compare what the cogs declare against what Discord has published.
 *
 * @returns {{inSync:boolean, missing:string[], extra:string[], changed:Array<{name:string, reason:string}>}}
 *   missing = in the code, not on Discord (the option you added is invisible)
 *   extra   = on Discord, not in the code (a user can run something with no handler)
 */
export function diffCommands(localPayload, remotePayload) {
    const local = new Map(localPayload.map((c) => [c.name, normaliseCommand(c)]));
    const remote = new Map(remotePayload.map((c) => [c.name, normaliseCommand(c)]));

    const missing = [...local.keys()].filter((name) => !remote.has(name)).sort();
    const extra = [...remote.keys()].filter((name) => !local.has(name)).sort();

    const changed = [];
    for (const [name, localCommand] of local) {
        const remoteCommand = remote.get(name);
        if (!remoteCommand) continue;
        if (JSON.stringify(localCommand) !== JSON.stringify(remoteCommand)) {
            changed.push({ name, reason: describeDifference(localCommand, remoteCommand) });
        }
    }

    return {
        inSync: missing.length === 0 && extra.length === 0 && changed.length === 0,
        missing,
        extra,
        changed,
    };
}

/** What Discord currently has published, in the scope this config registers to. */
export async function fetchRegisteredCommands(config = loadConfig()) {
    const discord = config?.discord || {};
    const rest = new REST({ version: "10" }).setToken(discord.token);

    const route = discord.dev_guild_id
        ? Routes.applicationGuildCommands(discord.application_id, discord.dev_guild_id)
        : Routes.applicationCommands(discord.application_id);

    return rest.get(route);
}

/**
 * Boot-time check: say loudly when the published list no longer matches the code.
 *
 * ⚠️ Never throws and never blocks startup. A network hiccup while checking must not
 * stop a bot that is otherwise fine — the whole point is to turn a silent mismatch
 * into a log line, not to add a new way to fail.
 */
export async function warnIfCommandsDrifted({ config, commands }) {
    const discord = config?.discord || {};
    if (!discord.token || !discord.application_id) return null;

    try {
        const localPayload = collectCommandPayload(commands);
        const remotePayload = await fetchRegisteredCommands(config);
        const diff = diffCommands(localPayload, remotePayload);

        const scope = discord.dev_guild_id ? `guild ${discord.dev_guild_id}` : "global";

        if (diff.inSync) {
            await log.debug(
                `command list matches what is published to ${scope} (${localPayload.length} command(s))`,
                import.meta.url,
            );
            return diff;
        }

        const lines = ["⚠️ PUBLISHED COMMAND LIST IS STALE — run `npm run bot:register`"];
        if (diff.missing.length > 0) {
            lines.push(
                `   in the code but NOT on Discord (users cannot see these): ${diff.missing.map((n) => "/" + n).join(", ")}`,
            );
        }
        if (diff.extra.length > 0) {
            lines.push(
                `   on Discord but NOT in the code (running these finds no handler): ${diff.extra.map((n) => "/" + n).join(", ")}`,
            );
        }
        for (const { name, reason } of diff.changed) {
            lines.push(`   /${name} changed shape — ${reason}`);
        }

        await log(lines.join("\n"), "warning", import.meta.url);
        return diff;
    } catch (err) {
        await log(
            `could not check the published command list (harmless, the bot is unaffected): ${err.message}`,
            "warning",
            import.meta.url,
        );
        return null;
    }
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

/**
 * app/bot/loader.js — the cog loader.
 *
 * ⭐ THIS IS THE LEGACY `cogs/` DIRECTORY, KEPT ON PURPOSE.
 *
 * The old bot's best structural idea was a cog per concern — `fishing_cog`,
 * `inventory_cog`, `market_cog` — each owning its commands AND its listeners,
 * loaded by name, with `cog list` showing all vs loaded. discord.js has no
 * built-in equivalent: the common pattern splits `commands/` from `events/` by
 * KIND, which would scatter one feature across two trees. This keeps the feature
 * whole, which is both his instinct and STANDARDS §3's one-directory-per-concern.
 *
 * A cog is `app/cogs/<name>/index.js` with a default export:
 *
 *     export default {
 *       name: "economy",                     // must match the directory name
 *       description: "money, balance, give",
 *       commands: [ { data: SlashCommandBuilder, execute(interaction, ctx) } ],
 *       events:   [ { name: Events.GuildCreate, once: false, handle(args, ctx) } ],
 *       async setup(ctx) {},                 // optional, once at load
 *     }
 *
 * 🔑 `ctx` is `{ client, db, config, log }`, INJECTED. The legacy cog did
 * `b = basic("fishing_cog")` at import time — every module built its own data
 * layer and reached for the filesystem the moment it was imported. Injection is
 * why a cog here can be tested without a Discord connection or a database.
 *
 * ⚠️ WHAT THIS DOES NOT DO: runtime `cog reload`. The legacy had it and it was
 * genuinely good, but ESM caches modules by URL with no un-import, so a real
 * reload needs cache-busting import URLs and careful listener teardown — easy to
 * get subtly wrong, and `npm run dev` (node --watch) already restarts the process
 * on save. Left out deliberately rather than half-built.
 */

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

import { log, projectRootPath } from "../../lib/utility.js";

const cogsDir = path.resolve(projectRootPath(), "app", "cogs");

/** Read the cog directory. Returns names only — no importing. */
export function listCogNames(directory = cogsDir) {
    if (!fs.existsSync(directory)) return [];

    return fs
        .readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => fs.existsSync(path.join(directory, name, "index.js")))
        .sort();
}

/**
 * Validate a cog's shape. Returns an array of problems — empty means good.
 * Exported so a unit test can check every cog in the tree without a client.
 */
export function validateCog(cog, expectedName) {
    const problems = [];

    if (!cog || typeof cog !== "object") {
        problems.push(`${expectedName}: default export is not an object`);
        return problems;
    }

    if (cog.name !== expectedName) {
        problems.push(
            `${expectedName}: cog.name is "${cog.name}" but the directory is "${expectedName}" — one name end to end`,
        );
    }

    if (cog.commands !== undefined && !Array.isArray(cog.commands)) {
        problems.push(`${expectedName}: commands must be an array`);
    }
    if (cog.events !== undefined && !Array.isArray(cog.events)) {
        problems.push(`${expectedName}: events must be an array`);
    }

    for (const command of cog.commands || []) {
        const name = command?.data?.name;
        if (!name) {
            problems.push(`${expectedName}: a command has no data.name`);
        }
        if (typeof command?.execute !== "function") {
            problems.push(`${expectedName}: command "${name}" has no execute()`);
        }
        // Optional, but if it is there it has to be callable.
        if (command?.autocomplete !== undefined && typeof command.autocomplete !== "function") {
            problems.push(`${expectedName}: command "${name}" has an autocomplete that is not a function`);
        }
    }

    for (const event of cog.events || []) {
        if (!event?.name) {
            problems.push(`${expectedName}: an event has no name`);
        }
        if (typeof event?.handle !== "function") {
            problems.push(`${expectedName}: event "${event?.name}" has no handle()`);
        }
    }

    return problems;
}

/**
 * Import every cog and build the command map.
 *
 * ⚠️ Refuses to start on a duplicate command name. The legacy had
 * `get_server_prefix` defined TWICE in one class with different behaviour — the
 * second silently won — and shipped `ox`/`Ox`/`oX`/`xo`/`XO` as five separate
 * commands. Two definitions is one bug plus one dead branch, so this is a hard
 * failure at load, not a surprise at runtime.
 */
export async function loadCogs(directory = cogsDir) {
    const names = listCogNames(directory);
    const cogs = [];
    const commands = new Map();
    const problems = [];

    for (const name of names) {
        const entryPoint = pathToFileURL(
            path.join(directory, name, "index.js"),
        ).href;

        let module;
        try {
            module = await import(entryPoint);
        } catch (err) {
            problems.push(`${name}: failed to import — ${err.message}`);
            continue;
        }

        const cog = module.default;
        const cogProblems = validateCog(cog, name);
        if (cogProblems.length > 0) {
            problems.push(...cogProblems);
            continue;
        }

        for (const command of cog.commands || []) {
            const commandName = command.data.name;
            if (commands.has(commandName)) {
                problems.push(
                    `duplicate command "/${commandName}": declared by both ` +
                    `"${commands.get(commandName).cogName}" and "${name}"`,
                );
                continue;
            }
            commands.set(commandName, { cogName: name, command });
        }

        cogs.push(cog);
    }

    if (problems.length > 0) {
        throw new Error(
            `Cog loading failed:\n  - ${problems.join("\n  - ")}`,
        );
    }

    return { cogs, commands };
}

/**
 * Wire every cog's listeners onto the client — one client listener per event
 * name, fanning out to each cog that wants it.
 *
 * ⚠️ Every handler is wrapped so a throw is LOGGED, not swallowed. The legacy
 * wrapped whole handlers in bare `except: return`, which turned every error into
 * silence — and one such silence left `auto_fishing_list` holding a lock with no
 * `finally`, so a crash mid-loop left a player permanently "already fishing".
 */
export function attachCogEvents(client, cogs, ctx) {
    const byEvent = new Map();

    for (const cog of cogs) {
        for (const event of cog.events || []) {
            const key = `${event.name}::${event.once ? "once" : "on"}`;
            if (!byEvent.has(key)) {
                byEvent.set(key, { name: event.name, once: !!event.once, handlers: [] });
            }
            byEvent.get(key).handlers.push({ cogName: cog.name, handle: event.handle });
        }
    }

    for (const { name, once, handlers } of byEvent.values()) {
        const dispatch = async (...args) => {
            for (const { cogName, handle } of handlers) {
                try {
                    await handle(...args, ctx);
                } catch (err) {
                    await log(
                        `cog "${cogName}" threw handling ${name}: ${err.stack || err.message}`,
                        "error",
                        import.meta.url,
                    );
                }
            }
        };

        if (once) client.once(name, dispatch);
        else client.on(name, dispatch);
    }

    return byEvent.size;
}

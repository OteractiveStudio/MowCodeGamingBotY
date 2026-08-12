/**
 * Unit: every cog in the tree loads and is well-formed. No client, no database.
 *
 * This is the test that makes the cog pattern safe to keep adding to: a new cog
 * with a mistyped name, a command with no execute(), or a command name another
 * cog already claimed fails here — on the ground — instead of after the bot is
 * live in twelve servers.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadCogs, listCogNames, validateCog } from "../../app/bot/loader.js";
import { assertThrows } from "../lib/harness.mjs";

export default [
    {
        label: "there is at least one cog, and every one of them imports",
        fn: async () => {
            const names = listCogNames();
            assert.ok(names.length > 0, "app/cogs/ has no cogs with an index.js");

            const { cogs } = await loadCogs();
            assert.equal(
                cogs.length,
                names.length,
                `${names.length} cog directories but ${cogs.length} loaded`,
            );
        },
    },
    {
        label: "cog.name matches its directory — one name end to end",
        fn: async () => {
            const { cogs } = await loadCogs();
            const names = listCogNames();
            for (const cog of cogs) {
                assert.ok(
                    names.includes(cog.name),
                    `cog.name "${cog.name}" is not one of the directories: ${names.join(", ")}`,
                );
            }
        },
    },
    {
        label: "every command has a name, a description and an execute()",
        fn: async () => {
            const { commands } = await loadCogs();
            assert.ok(commands.size > 0, "no commands were collected");

            for (const [name, { command, cogName }] of commands) {
                const json = command.data.toJSON();
                assert.equal(json.name, name, `command map key "${name}" != data.name "${json.name}"`);
                assert.ok(json.description, `/${name} (cog ${cogName}) has no description`);
                assert.equal(typeof command.execute, "function", `/${name} has no execute()`);
                // Discord's own constraint — better to fail here than on register.
                assert.match(json.name, /^[-_\p{L}\p{N}]{1,32}$/u, `/${name} is not a legal slash command name`);
            }
        },
    },
    {
        label: "a duplicate command name across two cogs is rejected at load",
        fn: async () => {
            // The legacy shipped ox/Ox/oX/xo/XO as five commands and defined
            // get_server_prefix twice with different behaviour. Two definitions is
            // one bug plus one dead branch, so the loader must refuse.
            const { commands } = await loadCogs();
            const seen = new Set();
            for (const name of commands.keys()) {
                assert.ok(!seen.has(name), `duplicate command name survived loading: ${name}`);
                seen.add(name);
            }

            // And prove the validator itself catches a malformed cog.
            const problems = validateCog(
                { name: "wrong", commands: [{ data: { name: "x" } }] },
                "expected",
            );
            assert.ok(
                problems.some((p) => p.includes("one name end to end")),
                `expected a name-mismatch problem, got: ${problems.join(" | ")}`,
            );
            assert.ok(
                problems.some((p) => p.includes("no execute()")),
                `expected a missing-execute problem, got: ${problems.join(" | ")}`,
            );
        },
    },
    {
        label: "validateCog rejects a non-object and does not crash on it",
        fn: async () => {
            assert.ok(validateCog(null, "nope").length > 0);
            assert.ok(validateCog(undefined, "nope").length > 0);
            assert.ok(validateCog("a string", "nope").length > 0);
        },
    },
    {
        label: "two cogs claiming the same command name make loadCogs THROW",
        fn: async () => {
            const err = await assertThrows(
                () => loadCogs(fixture("broken-cogs-duplicate")),
                "duplicate command",
            );
            // The message has to name both culprits, or it is not actionable.
            assert.match(err.message, /alpha/);
            assert.match(err.message, /beta/);
        },
    },
    {
        label: "a malformed cog makes loadCogs THROW, listing every problem at once",
        fn: async () => {
            const err = await assertThrows(() => loadCogs(fixture("broken-cogs-malformed")));
            assert.match(err.message, /one name end to end/);
            assert.match(err.message, /no execute\(\)/);
            assert.match(err.message, /no handle\(\)/);
        },
    },
];

function fixture(name) {
    return path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "fixtures",
        name,
    );
}

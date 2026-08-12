/**
 * Unit: the /admin gate cannot be bypassed on any subcommand.
 *
 * ⚠️ THIS IS THE TEST THAT EXISTS BECAUSE HIS VERSION FAILED IT. Every admin feature in the
 * legacy re-read `is_admin` and re-tested it inside each branch — and `file_explorer_cog`
 * **forgot to test it at all**, so anyone in any of the twelve servers could list a directory on
 * the bot host and download files out of it.
 *
 * So the property under test is not "isBotAdmin works" — `permissions.test.mjs` covers that.
 * It is **"no path through the admin cog reaches the database without passing the gate"**, which
 * is proved by handing it a `db` that throws on ANY property access. A new subcommand that
 * forgets the gate fails here, loudly, with the reason attached.
 */

import assert from "node:assert/strict";

import adminCog from "../../app/cogs/admin/index.js";

const ADMIN_ID = "403536649222356992";
const OUTSIDER_ID = "111111111111111111";

/**
 * A db that cannot be touched. Any property read throws, so reaching the database at all — even
 * to read `db.schema` for a query string — fails the test rather than silently working.
 */
function forbiddenDb(label) {
    return new Proxy(
        {},
        {
            get(_target, property) {
                throw new Error(`${label}: the database was touched (db.${String(property)}) before the admin gate`);
            },
        },
    );
}

/** Records what the cog replied, without needing Discord. */
function fakeInteraction({ subcommand, userId, options = {} }) {
    const captured = { replies: [], updates: [], announcements: [] };

    return {
        captured,
        user: { id: userId, username: "tester" },
        guildId: "859279060999995392",
        channelId: "channel",
        replied: false,
        deferred: true, // dispatch defers chat-input commands before calling them
        options: {
            getSubcommand: () => subcommand,
            getUser: (name) => options[name] ?? null,
            getInteger: (name) => options[name] ?? null,
            getString: (name) => options[name] ?? null,
            getBoolean: (name) => options[name] ?? null,
            getFocused: () => "",
        },
        async editReply(payload) {
            captured.replies.push(payload);
            return { id: "message" };
        },
        async reply(payload) {
            captured.replies.push(payload);
            return { id: "message" };
        },
        async update(payload) {
            captured.updates.push(payload);
            return { id: "message" };
        },
        async followUp(payload) {
            captured.replies.push(payload);
            return { id: "message" };
        },
        channel: {
            async send(payload) {
                captured.announcements.push(payload);
                return { id: "announcement" };
            },
        },
    };
}

function fakeCtx({ admins, label }) {
    const logged = [];
    return {
        logged,
        config: { bot: { admin_ids: admins } },
        db: forbiddenDb(label),
        async log(message, level) {
            logged.push({ message, level });
        },
    };
}

const SUBCOMMANDS = ["money", "player", "reset", "fish", "feedback", "stats", "cogs"];

const command = adminCog.commands[0];

export default [
    {
        label: "the cog declares exactly one command, and EVERY subcommand is in the gate list below",
        fn: () => {
            assert.equal(adminCog.commands.length, 1);
            const json = command.data.toJSON();
            assert.equal(json.name, "admin");
            assert.deepEqual(
                json.options.map((o) => o.name).sort(),
                [...SUBCOMMANDS].sort(),
                "a new subcommand must be added to this test's SUBCOMMANDS list",
            );
        },
    },
    {
        label: "🔑 NO SUBCOMMAND reaches the database for a non-admin — the gate is not per-branch",
        fn: async () => {
            for (const subcommand of SUBCOMMANDS) {
                const interaction = fakeInteraction({
                    subcommand,
                    userId: OUTSIDER_ID,
                    // Plausible arguments, so a missing gate would get far enough to touch the db.
                    options: {
                        player: { id: "222222222222222222", username: "victim" },
                        amount: 1_000_000,
                        fish: "Salmon",
                        field: "price",
                        value: 999,
                    },
                });
                const ctx = fakeCtx({ admins: [ADMIN_ID], label: `/admin ${subcommand}` });

                // Throws if the gate is missing, because ctx.db throws on any access.
                await command.execute(interaction, ctx);

                assert.equal(interaction.captured.replies.length, 1, `${subcommand}: expected one refusal`);
                const reply = interaction.captured.replies[0];
                assert.match(reply.content, /owner command/i, `${subcommand}: should say it is an owner command`);

                // And the attempt is logged at warning — his refused silently.
                assert.equal(ctx.logged.length, 1, `${subcommand}: the attempt should be logged`);
                assert.equal(ctx.logged[0].level, "warning");
                assert.match(ctx.logged[0].message, new RegExp(subcommand));
                assert.match(ctx.logged[0].message, new RegExp(OUTSIDER_ID));
            }
        },
    },
    {
        label: "🔑 the command declares defer: 'ephemeral' — the ONLY way its replies stay private",
        fn: () => {
            // ⚠️ This is the mechanism, and it is not interchangeable with passing
            // `flags: Ephemeral` to respond(). dispatch.js defers before the handler runs, and
            // editReply() cannot change ephemerality afterwards — so a flags argument is silently
            // dropped and the reply comes out PUBLIC. An admin inspection leaking player data into
            // a channel is the failure this guards.
            assert.equal(command.defer, "ephemeral");
        },
    },
    {
        label: "🔑 an EMPTY admin list refuses everyone — it must never default open",
        fn: async () => {
            for (const admins of [[], null, undefined]) {
                const interaction = fakeInteraction({ subcommand: "stats", userId: ADMIN_ID });
                const ctx = fakeCtx({ admins, label: "empty admin list" });

                await command.execute(interaction, ctx);

                assert.equal(interaction.captured.replies.length, 1);
                assert.match(interaction.captured.replies[0].content, /owner command/i);
            }
        },
    },
    {
        label: "the refusal names who CAN run it, or says nobody is configured",
        fn: async () => {
            const withAdmins = fakeInteraction({ subcommand: "stats", userId: OUTSIDER_ID });
            await command.execute(withAdmins, fakeCtx({ admins: [ADMIN_ID], label: "a" }));
            assert.match(withAdmins.captured.replies[0].content, new RegExp(ADMIN_ID), "should mention the admin");

            const withNone = fakeInteraction({ subcommand: "stats", userId: OUTSIDER_ID });
            await command.execute(withNone, fakeCtx({ admins: [], label: "b" }));
            assert.match(withNone.captured.replies[0].content, /admin_ids/, "should say where to configure it");
        },
    },
    {
        label: "🔑 the CONFIRM BUTTON re-checks admin — a customId is client-supplied data",
        fn: async () => {
            // Anyone who can see the message can send its customId back, so the button's
            // existence proves nothing about who clicked it.
            const interaction = {
                ...fakeInteraction({ subcommand: "reset", userId: OUTSIDER_ID }),
                customId: `admin:reset-confirm:${ADMIN_ID}`,
            };
            const ctx = fakeCtx({ admins: [ADMIN_ID], label: "reset-confirm" });

            await adminCog.handleComponent(interaction, ctx);

            assert.equal(interaction.captured.replies.length, 1);
            assert.match(interaction.captured.replies[0].content, /not yours/i);
            assert.equal(interaction.captured.updates.length, 0, "nothing should have been updated");
        },
    },
    {
        label: "an unrecognised admin component is refused rather than falling through",
        fn: async () => {
            const interaction = {
                ...fakeInteraction({ subcommand: "reset", userId: ADMIN_ID }),
                customId: "admin:something-invented",
            };
            const ctx = fakeCtx({ admins: [ADMIN_ID], label: "unknown component" });

            await adminCog.handleComponent(interaction, ctx);

            assert.equal(interaction.captured.replies.length, 1);
            assert.match(interaction.captured.replies[0].content, /don't recognise|isn't one I recognise/i);
        },
    },
    {
        label: "cancelling a reset touches nothing at all",
        fn: async () => {
            const interaction = {
                ...fakeInteraction({ subcommand: "reset", userId: ADMIN_ID }),
                customId: "admin:reset-cancel",
            };
            // An admin this time, so the db proxy proves the CANCEL path also never queries.
            const ctx = fakeCtx({ admins: [ADMIN_ID], label: "reset-cancel" });

            await adminCog.handleComponent(interaction, ctx);

            assert.equal(interaction.captured.updates.length, 1);
            assert.match(interaction.captured.updates[0].content, /cancelled/i);
            assert.deepEqual(interaction.captured.updates[0].components, []);
        },
    },
    {
        label: "🔑 a malformed target id on the confirm button is refused before any query",
        fn: async () => {
            for (const bad of ["", "not-an-id", "12; DROP TABLE mst_player", "1".repeat(40)]) {
                const interaction = {
                    ...fakeInteraction({ subcommand: "reset", userId: ADMIN_ID }),
                    customId: `admin:reset-confirm:${bad}`,
                };
                const ctx = fakeCtx({ admins: [ADMIN_ID], label: `bad id ${bad}` });

                // The db proxy throws on any access, so this passing proves the id is validated
                // BEFORE the lookup rather than being handed to a query.
                await adminCog.handleComponent(interaction, ctx);

                assert.equal(interaction.captured.replies.length, 1, `"${bad}" should be refused`);
                assert.match(interaction.captured.replies[0].content, /cannot read/i);
            }
        },
    },
    {
        label: "money adjustment of ZERO is refused before touching the database",
        fn: async () => {
            const interaction = fakeInteraction({
                subcommand: "money",
                userId: ADMIN_ID,
                options: { player: { id: "222222222222222222", username: "x" }, amount: 0 },
            });
            const ctx = fakeCtx({ admins: [ADMIN_ID], label: "zero adjust" });

            await command.execute(interaction, ctx);

            assert.equal(interaction.captured.replies.length, 1);
            assert.match(interaction.captured.replies[0].content, /Zero changes nothing/i);
        },
    },
    {
        label: "the fish field is restricted to his two — price and tier",
        fn: async () => {
            const json = command.data.toJSON();
            const fish = json.options.find((o) => o.name === "fish");
            const field = fish.options.find((o) => o.name === "field");
            assert.deepEqual(
                field.choices.map((c) => c.value).sort(),
                ["price", "tier"],
                "his data_editor only allowed price and tier",
            );
        },
    },
    {
        label: "an out-of-range tier is refused with the reason, not a raw constraint error",
        fn: async () => {
            for (const value of [-1, 10, 11, 99]) {
                const interaction = fakeInteraction({
                    subcommand: "fish",
                    userId: ADMIN_ID,
                    options: { fish: "Salmon", field: "tier", value },
                });
                const ctx = fakeCtx({ admins: [ADMIN_ID], label: `tier ${value}` });

                await command.execute(interaction, ctx);

                assert.equal(interaction.captured.replies.length, 1, `tier ${value} should be refused`);
                assert.match(interaction.captured.replies[0].content, /0-9/);
                // The explanation has to be there — the weight is 10 - tier.
                assert.match(interaction.captured.replies[0].content, /10 - tier|10 – tier/);
            }
        },
    },
];

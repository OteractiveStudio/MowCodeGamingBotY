/**
 * Check: the data layer's atomic upserts behave, against the real database.
 *
 * 🔑 This is the check that proves the point of the whole rewrite. The legacy
 * equivalent was read-whole-file → mutate → write-whole-file with no lock, so two
 * overlapping commands silently lost one of the writes. Here provisioning is one
 * statement, and the last case runs 25 of them CONCURRENTLY to show that the
 * result is one row and one winner — the scenario `+fishing auto` used to corrupt.
 *
 * ⚠️ Uses reserved synthetic ids in the 9000… range and deletes them before AND
 * after. Cleaning up only at the end is how a killed run poisons the next one and
 * gets the product blamed.
 */

import assert from "node:assert/strict";

import { ensurePlayer, getPlayer } from "../../app/data/player.js";
import { ensureGuild, markGuildLeft, getGuild } from "../../app/data/guild.js";

// Digits only, so they satisfy the snowflake CHECK, but far outside real
// Discord id space.
const TEST_PLAYER_ID = "900000000000000001";
const TEST_GUILD_ID = "900000000000000002";
const TEST_RACE_ID = "900000000000000003";

async function cleanup(db) {
    await db.mst_player.destroy({ where: { discord_id: [TEST_PLAYER_ID, TEST_RACE_ID] } });
    await db.mst_guild.destroy({ where: { guild_id: TEST_GUILD_ID } });
}

export default (ctx) => {
    const { db } = ctx;

    return [
        {
            label: "clean slate — remove anything a previous (possibly killed) run left",
            fn: async () => {
                await cleanup(db);
                assert.equal(await getPlayer(db, TEST_PLAYER_ID), null);
                assert.equal(await getGuild(db, TEST_GUILD_ID), null);
            },
        },
        {
            label: "ensurePlayer creates on first sight and reports created=true",
            fn: async () => {
                const { row, created } = await ensurePlayer(db, {
                    id: TEST_PLAYER_ID,
                    username: "test_player",
                    globalName: "Test Player",
                    bot: false,
                });
                assert.equal(created, true, "first ensurePlayer did not report a create");
                assert.equal(row.discord_id, TEST_PLAYER_ID);
                assert.equal(row.username, "test_player");
                assert.equal(row.global_name, "Test Player");
                assert.equal(row.is_bot, false);
            },
        },
        {
            label: "ensurePlayer is idempotent: second call updates, first_seen_at is never rewritten",
            fn: async () => {
                const before = await getPlayer(db, TEST_PLAYER_ID);

                const { row, created } = await ensurePlayer(db, {
                    id: TEST_PLAYER_ID,
                    username: "test_player_renamed",
                    globalName: "Renamed",
                    bot: false,
                });

                assert.equal(created, false, "second ensurePlayer wrongly reported a create");
                assert.equal(row.username, "test_player_renamed", "the update did not apply");
                assert.equal(
                    new Date(row.first_seen_at).getTime(),
                    new Date(before.first_seen_at).getTime(),
                    "first_seen_at was overwritten — it must be written once and never again",
                );
                assert.ok(
                    new Date(row.last_seen_at).getTime() >= new Date(before.last_seen_at).getTime(),
                    "last_seen_at did not move forward",
                );
            },
        },
        {
            label: "25 concurrent ensurePlayer calls produce exactly one row",
            fn: async () => {
                // The legacy failure mode, reproduced deliberately: overlapping
                // writes for the same player. With whole-file read-modify-write
                // this loses data; with ON CONFLICT it cannot.
                const attempts = Array.from({ length: 25 }, (unused, index) =>
                    ensurePlayer(db, {
                        id: TEST_RACE_ID,
                        username: `racer_${index}`,
                        globalName: null,
                        bot: false,
                    }),
                );

                const results = await Promise.all(attempts);

                const createdCount = results.filter((r) => r.created).length;
                assert.equal(
                    createdCount,
                    1,
                    `expected exactly one INSERT to win, got ${createdCount}`,
                );

                const rows = await db.mst_player.count({ where: { discord_id: TEST_RACE_ID } });
                assert.equal(rows, 1, `expected 1 row, found ${rows}`);
            },
        },
        {
            label: "ensureGuild creates, markGuildLeft marks without deleting, ensureGuild revives",
            fn: async () => {
                const first = await ensureGuild(
                    db,
                    { id: TEST_GUILD_ID, name: "Test Guild" },
                    { prefix: "+", lang: "en" },
                );
                assert.equal(first.created, true);
                assert.equal(first.row.left_at, null);
                assert.equal(first.row.prefix, "+");

                const marked = await markGuildLeft(db, TEST_GUILD_ID);
                assert.equal(marked, 1, "markGuildLeft did not mark exactly one row");

                const afterLeaving = await getGuild(db, TEST_GUILD_ID);
                assert.ok(afterLeaving, "the row was DELETED — settings must survive a kick");
                assert.ok(afterLeaving.left_at, "left_at was not set");

                const revived = await ensureGuild(
                    db,
                    { id: TEST_GUILD_ID, name: "Test Guild Renamed" },
                    { prefix: "+", lang: "en" },
                );
                assert.equal(revived.created, false, "the revive wrongly inserted a new row");
                assert.equal(revived.row.left_at, null, "left_at was not cleared on re-invite");
                assert.equal(revived.row.name, "Test Guild Renamed");
            },
        },
        {
            label: "markGuildLeft on an already-left guild marks nothing (no double count)",
            fn: async () => {
                await markGuildLeft(db, TEST_GUILD_ID);
                const second = await markGuildLeft(db, TEST_GUILD_ID);
                assert.equal(second, 0, "a second markGuildLeft should be a no-op");
            },
        },
        {
            label: "getGuild returns null for an unknown guild — one behaviour, not two",
            fn: async () => {
                // The legacy defined get_server_prefix twice: one raised KeyError,
                // the other returned None, and the second silently won.
                assert.equal(await getGuild(db, "900000000000009999"), null);
                assert.equal(await getPlayer(db, "900000000000009999"), null);
            },
        },
        {
            label: "teardown — the test rows are gone",
            fn: async () => {
                await cleanup(db);
                assert.equal(await getPlayer(db, TEST_PLAYER_ID), null);
                assert.equal(await getPlayer(db, TEST_RACE_ID), null);
                assert.equal(await getGuild(db, TEST_GUILD_ID), null);
            },
        },
    ];
};

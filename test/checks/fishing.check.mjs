/**
 * Check: fishing against the real database.
 *
 * 🔑 The case that matters: a 30-cast `fishing auto` is ONE transaction. The legacy
 * did the same thing with 120+ sequential whole-file rewrites, which is the pattern
 * measured elsewhere in this suite losing 98% of its writes under concurrency.
 *
 * ⚠️ Reserved synthetic ids in the 9200… range, cleaned up before and after.
 */

import assert from "node:assert/strict";

import { ensurePlayer } from "../../app/data/player.js";
import { getState, explainBalance, toInt } from "../../app/data/economy.js";
import { cast, castAll, getFishPool, AUTO_CAST_LIMIT } from "../../app/data/fishing.js";
import { assertThrows } from "../lib/harness.mjs";

const FISHER = "920000000000000001";
const EMPTY_HANDED = "920000000000000002";
const RACER = "920000000000000003";
const IDS = [FISHER, EMPTY_HANDED, RACER];

const user = (id, name) => ({ id, username: name, globalName: null, bot: false });

async function cleanup(db) {
    await db.mst_player.destroy({ where: { discord_id: IDS } });
}

/** Deterministic, so a failure is reproducible rather than "sometimes". */
function lcg(seed = 7) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

export default (ctx) => {
    const { db } = ctx;

    return [
        {
            label: "clean slate — remove anything a previous run left behind",
            fn: async () => {
                await cleanup(db);
                for (const id of IDS) {
                    assert.equal(await getState(db, id), null);
                }
            },
        },
        {
            label: "the fish pool is seeded and every tier is drawable",
            fn: async () => {
                const pool = await getFishPool(db);
                assert.equal(pool.length, 9, "expected the 9 seeded fish — run npm run db:seed");
                for (const fish of pool) {
                    assert.ok(fish.tier >= 0 && fish.tier <= 9, `${fish.fish_key} has tier ${fish.tier}`);
                }
                assert.ok(pool.some((f) => f.fish_key === "AmogusTheFish"), "the tier-9 fish is missing");
            },
        },
        {
            label: "one cast consumes exactly one rod and credits exactly the fish price",
            fn: async () => {
                await ensurePlayer(db, user(FISHER, "fisher"));
                const before = await getState(db, FISHER);

                const result = await cast(db, {
                    discordId: FISHER,
                    casts: 1,
                    random: lcg(1),
                });

                assert.equal(result.casts, 1);
                assert.equal(result.caught.length, 1);

                const after = await getState(db, FISHER);
                assert.equal(after.fishing_rod, before.fishing_rod - 1, "rod count is wrong");
                assert.equal(after.fishing_count, before.fishing_count + 1, "catch counter did not move");
                assert.equal(
                    toInt(after.money),
                    toInt(before.money) + result.caught[0].price,
                    "the credited amount is not the fish price",
                );
            },
        },
        {
            label: "a catch grants exp equal to its price — the legacy coupling, through fishing",
            fn: async () => {
                await cleanup(db);
                await ensurePlayer(db, user(FISHER, "fisher"));

                // Force the most valuable fish: roll at the very top of the range.
                const result = await cast(db, { discordId: FISHER, casts: 1, random: () => 0.999999 });
                const fish = result.caught[0];

                const state = await getState(db, FISHER);
                // exp gained equals the price, then the cascade may have spent it on levels.
                if (result.levelsGained === 0) {
                    assert.equal(state.exp, fish.price, "exp did not match the price");
                } else {
                    assert.ok(state.level > 1, "levels were reported but the level did not move");
                }
            },
        },
        {
            label: "each catch writes its own ledger row, naming the fish",
            fn: async () => {
                const ledger = await explainBalance(db, FISHER, 100);
                const catches = ledger.entries.filter((e) => e.reason === "fishing_catch");
                assert.ok(catches.length >= 1, "no fishing_catch rows were written");
                for (const entry of catches) {
                    assert.ok(entry.ref, "a catch row has no ref — which fish paid?");
                }
                assert.equal(ledger.matchesLiveBalance, true, "the ledger and the balance disagree");
            },
        },
        {
            label: "🔑 a 30-cast auto run is ONE transaction — 30 rods, 30 rows, one balance",
            fn: async () => {
                await cleanup(db);
                // Provision with exactly the auto cap so the run is full-length.
                await ensurePlayer(db, user(FISHER, "fisher"), {
                    defaults: { fishing_rod: AUTO_CAST_LIMIT },
                });
                const before = await getState(db, FISHER);
                assert.equal(before.fishing_rod, 30);

                const result = await castAll(db, { discordId: FISHER, random: lcg(99) });

                assert.equal(result.casts, 30, "auto did not use all 30 rods");
                assert.equal(result.rodsLeft, 0);

                const after = await getState(db, FISHER);
                assert.equal(after.fishing_rod, 0, "rods were not all consumed");
                assert.equal(after.fishing_count, before.fishing_count + 30);
                assert.equal(
                    toInt(after.money),
                    toInt(before.money) + result.totalEarned,
                    "the batch total does not match the balance change",
                );

                // One ledger row per cast, and the chain still reconciles across the batch.
                const ledger = await explainBalance(db, FISHER, 1000);
                const catches = ledger.entries.filter((e) => e.reason === "fishing_catch");
                assert.equal(catches.length, 30, `expected 30 catch rows, found ${catches.length}`);
                assert.equal(
                    ledger.chainIsConsistent,
                    true,
                    `the ledger chain broke: ${JSON.stringify(ledger.breaks.slice(0, 3))}`,
                );
                assert.equal(ledger.matchesLiveBalance, true);
            },
        },
        {
            label: "auto respects the 30-rod cap even when the player has more",
            fn: async () => {
                await cleanup(db);
                await ensurePlayer(db, user(FISHER, "fisher"), { defaults: { fishing_rod: 100 } });

                const result = await castAll(db, { discordId: FISHER, random: lcg(5) });

                assert.equal(result.casts, 30, "the cap was not applied");
                const after = await getState(db, FISHER);
                assert.equal(after.fishing_rod, 70, "more rods were burned than the cap allows");
            },
        },
        {
            label: "casting with no rods is an ordinary outcome, not an exception",
            fn: async () => {
                await ensurePlayer(db, user(EMPTY_HANDED, "broke"), { defaults: { fishing_rod: 0 } });

                const result = await cast(db, { discordId: EMPTY_HANDED, casts: 1 });

                assert.equal(result.outOfRods, true);
                assert.equal(result.casts, 0);
                assert.equal(result.caught.length, 0);

                // And nothing was written — no ledger row, no counter movement.
                const ledger = await explainBalance(db, EMPTY_HANDED, 100);
                assert.equal(
                    ledger.entries.filter((e) => e.reason === "fishing_catch").length,
                    0,
                    "a rodless cast still wrote a catch row",
                );
                const state = await getState(db, EMPTY_HANDED);
                assert.equal(state.fishing_count, 0);
                assert.equal(state.fishing_rod, 0, "rods went negative");
            },
        },
        {
            label: "asking for more casts than there are rods burns only what exists",
            fn: async () => {
                await cleanup(db);
                await ensurePlayer(db, user(FISHER, "fisher"), { defaults: { fishing_rod: 3 } });

                const result = await cast(db, { discordId: FISHER, casts: 25, random: lcg(3) });

                assert.equal(result.casts, 3, "cast more times than there were rods");
                assert.equal(result.rodsLeft, 0);
                const state = await getState(db, FISHER);
                assert.equal(state.fishing_rod, 0);
            },
        },
        {
            label: "two players fishing at once do not touch each other's rods or coins",
            fn: async () => {
                await cleanup(db);
                await ensurePlayer(db, user(FISHER, "fisher"), { defaults: { fishing_rod: 10 } });
                await ensurePlayer(db, user(RACER, "racer"), { defaults: { fishing_rod: 10 } });

                // Different players lock different rows, so these genuinely overlap.
                const [a, b] = await Promise.all([
                    cast(db, { discordId: FISHER, casts: 10, random: lcg(11) }),
                    cast(db, { discordId: RACER, casts: 10, random: lcg(22) }),
                ]);

                assert.equal(a.casts, 10);
                assert.equal(b.casts, 10);

                const stateA = await getState(db, FISHER);
                const stateB = await getState(db, RACER);
                assert.equal(stateA.fishing_rod, 0);
                assert.equal(stateB.fishing_rod, 0);
                assert.equal(stateA.fishing_count, 10);
                assert.equal(stateB.fishing_count, 10);
                assert.equal(toInt(stateA.money), 200 + a.totalEarned);
                assert.equal(toInt(stateB.money), 200 + b.totalEarned);
            },
        },
        {
            label: "concurrent casts by the SAME player lose no rods and no coins",
            fn: async () => {
                await cleanup(db);
                await ensurePlayer(db, user(RACER, "racer"), { defaults: { fishing_rod: 20 } });

                // 20 single casts fired at once at one player: every one must be
                // serialised by the row lock, or rods and coins go missing.
                const results = await Promise.all(
                    Array.from({ length: 20 }, (unused, i) =>
                        cast(db, { discordId: RACER, casts: 1, random: lcg(100 + i) }),
                    ),
                );

                const earned = results.reduce((sum, r) => sum + r.totalEarned, 0);
                const state = await getState(db, RACER);

                assert.equal(state.fishing_rod, 0, `expected 0 rods left, found ${state.fishing_rod}`);
                assert.equal(state.fishing_count, 20, "catch counter lost updates");
                assert.equal(
                    toInt(state.money),
                    200 + earned,
                    `coins were lost: expected ${200 + earned}, found ${state.money}`,
                );

                const ledger = await explainBalance(db, RACER, 1000);
                assert.equal(ledger.chainIsConsistent, true, "the ledger chain broke under concurrency");
                assert.equal(ledger.matchesLiveBalance, true);
            },
        },
        {
            label: "fishing for an unprovisioned player fails loudly",
            fn: async () => {
                await assertThrows(
                    () => cast(db, { discordId: "920000000000009999", casts: 1 }),
                    "ensurePlayer",
                );
            },
        },
        {
            label: "a zero or negative cast count is refused",
            fn: async () => {
                await assertThrows(() => cast(db, { discordId: FISHER, casts: 0 }), "positive integer");
                await assertThrows(() => cast(db, { discordId: FISHER, casts: -3 }), "positive integer");
            },
        },
        {
            label: "teardown — the test players and their ledgers are gone",
            fn: async () => {
                await cleanup(db);
                for (const id of IDS) {
                    assert.equal(await getState(db, id), null);
                    const ledger = await explainBalance(db, id);
                    assert.equal(ledger.total, 0);
                }
            },
        },
    ];
};

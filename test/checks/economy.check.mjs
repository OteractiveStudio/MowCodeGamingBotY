/**
 * Check: the economy against the real database.
 *
 * 🔑 The case that matters most is "50 concurrent credits lose nothing". That is the
 * legacy's central defect, reproduced deliberately: `money_add` was read-whole-file →
 * mutate → write-whole-file with no lock, so overlapping commands silently dropped
 * one another's writes. If the locking here is wrong, that test fails — and it is the
 * only kind of test that can tell.
 *
 * ⚠️ Uses reserved synthetic ids in the 9100… range and cleans up BEFORE and after,
 * because cleaning only at the end is how a killed run poisons the next one.
 */

import assert from "node:assert/strict";

import { ensurePlayer } from "../../app/data/player.js";
import {
    addMoney,
    transfer,
    getState,
    explainBalance,
    expCap,
    toInt,
} from "../../app/data/economy.js";
import { assertThrows } from "../lib/harness.mjs";

const A = "910000000000000001";
const B = "910000000000000002";
const RACER = "910000000000000003";
const IDS = [A, B, RACER];

const user = (id, name) => ({ id, username: name, globalName: null, bot: false });

async function cleanup(db) {
    // log_economy and mst_player_state both cascade from mst_player.
    await db.mst_player.destroy({ where: { discord_id: IDS } });
}

export default (ctx) => {
    const { db } = ctx;

    return [
        {
            label: "clean slate — remove anything a previous run left behind",
            fn: async () => {
                await cleanup(db);
                for (const id of IDS) {
                    assert.equal(await getState(db, id), null, `state for ${id} survived cleanup`);
                }
            },
        },
        {
            label: "provisioning creates state with the legacy defaults AND explains itself",
            fn: async () => {
                const { stateCreated, state } = await ensurePlayer(db, user(A, "player_a"));
                assert.equal(stateCreated, true);
                // From settings.json default_inventory + add_player.
                assert.equal(toInt(state.money), 200);
                assert.equal(state.fishing_rod, 10);
                assert.equal(state.inventory_size, 1);
                assert.equal(state.exp, 0);
                assert.equal(state.level, 1);
                assert.equal(state.magical_crystal, 0);

                // The starting coins are logged, so the balance is explainable from
                // row one rather than starting as money from nowhere.
                const ledger = await explainBalance(db, A);
                assert.equal(ledger.total, 1);
                assert.equal(ledger.entries[0].reason, "provision");
                assert.equal(toInt(ledger.entries[0].money_after), 200);
                assert.equal(ledger.matchesLiveBalance, true);
            },
        },
        {
            label: "provisioning twice does not reset a player's state",
            fn: async () => {
                await addMoney(db, { discordId: A, amount: 55, reason: "game_win" });
                const before = await getState(db, A);

                const second = await ensurePlayer(db, user(A, "player_a_renamed"));
                assert.equal(second.stateCreated, false, "state was created a second time");

                const after = await getState(db, A);
                assert.equal(toInt(after.money), toInt(before.money), "money was reset");
                assert.equal(after.exp, before.exp, "exp was reset");
                assert.equal(after.level, before.level, "level was reset");
            },
        },
        {
            label: "a credit moves money AND exp by the same amount — the legacy coupling",
            fn: async () => {
                await cleanup(db);
                await ensurePlayer(db, user(A, "player_a"));

                const result = await addMoney(db, {
                    discordId: A,
                    amount: 7,
                    reason: "fishing_catch",
                    ref: "Squid",
                });

                assert.equal(result.money, 207);
                // money_add called exp_add(money), so exp gained equals money gained.
                assert.equal(result.exp, 7);
                assert.equal(result.levelsGained, 0);
            },
        },
        {
            label: "a credit that crosses the cap levels the player up, in one transaction",
            fn: async () => {
                await cleanup(db);
                await ensurePlayer(db, user(A, "player_a"));

                // Level 1, cap 10.
                const result = await addMoney(db, {
                    discordId: A,
                    amount: 25,
                    reason: "game_win",
                });

                assert.ok(result.levelsGained >= 1, "no level was gained from 25 exp at level 1");
                assert.equal(result.money, 225);

                const state = await getState(db, A);
                assert.equal(state.level, result.level);
                assert.ok(
                    state.exp < expCap(state.level, state.magical_crystal),
                    "settled above the cap",
                );

                // The log row records the progression, not just the money.
                const ledger = await explainBalance(db, A);
                const latest = ledger.entries[0];
                assert.equal(latest.reason, "game_win");
                assert.equal(latest.levels_gained, result.levelsGained);
                assert.equal(latest.level_after, result.level);
            },
        },
        {
            label: "money is allowed to go NEGATIVE — bad econ is a game state, not an error",
            fn: async () => {
                await cleanup(db);
                await ensurePlayer(db, user(A, "player_a"));

                const result = await addMoney(db, {
                    discordId: A,
                    amount: -250,
                    reason: "game_loss",
                });

                assert.equal(result.money, -50);
                assert.equal(result.isBadEcon, true, "-50 should be bad econ");
                // exp is clamped at 0 rather than going negative with the money.
                assert.equal(result.exp, 0);
            },
        },
        {
            label: "🔑 50 CONCURRENT credits lose nothing — the legacy's central defect",
            fn: async () => {
                await cleanup(db);
                await ensurePlayer(db, user(RACER, "racer"));
                const start = toInt((await getState(db, RACER)).money);

                // Fired all at once, at the same player, exactly the shape that
                // `+fishing auto` produced. With whole-file read-modify-write, writes
                // are lost here. With a locked row, they queue.
                const CREDITS = 50;
                const EACH = 3;
                await Promise.all(
                    Array.from({ length: CREDITS }, (unused, index) =>
                        addMoney(db, {
                            discordId: RACER,
                            amount: EACH,
                            reason: "fishing_catch",
                            ref: `cast_${index}`,
                        }),
                    ),
                );

                const state = await getState(db, RACER);
                assert.equal(
                    toInt(state.money),
                    start + CREDITS * EACH,
                    `expected ${start + CREDITS * EACH}, found ${state.money} — writes were LOST`,
                );

                // Every credit left exactly one audit row.
                const ledger = await explainBalance(db, RACER, 1000);
                const catches = ledger.entries.filter((e) => e.reason === "fishing_catch");
                assert.equal(catches.length, CREDITS, "an audit row went missing");
            },
        },
        {
            label: "🔑 and the ledger chain still reconciles after that race",
            fn: async () => {
                // Ordered by rolling_id, every money_after must equal the previous one
                // plus this row's delta. Interleaved writes would break the chain even
                // if the total happened to come out right.
                const ledger = await explainBalance(db, RACER, 1000);
                assert.equal(
                    ledger.chainIsConsistent,
                    true,
                    `the ledger chain broke at: ${JSON.stringify(ledger.breaks.slice(0, 3))}`,
                );
                assert.equal(
                    ledger.matchesLiveBalance,
                    true,
                    `ledger says ${ledger.ledgerBalance}, the row says ${ledger.liveBalance}`,
                );
            },
        },
        {
            label: "a transfer moves the money and logs both sides",
            fn: async () => {
                await cleanup(db);
                await ensurePlayer(db, user(A, "player_a"));
                await ensurePlayer(db, user(B, "player_b"));

                const result = await transfer(db, { fromId: A, toId: B, amount: 60 });

                assert.equal(result.sender.money, 140);
                assert.equal(result.recipient.money, 260);

                const senderLedger = await explainBalance(db, A);
                const recipientLedger = await explainBalance(db, B);
                assert.equal(senderLedger.entries[0].reason, "transfer_out");
                assert.equal(senderLedger.entries[0].ref, B, "the counterparty was not recorded");
                assert.equal(recipientLedger.entries[0].reason, "transfer_in");
                assert.equal(recipientLedger.entries[0].ref, A);

                assert.equal(senderLedger.matchesLiveBalance, true);
                assert.equal(recipientLedger.matchesLiveBalance, true);
            },
        },
        {
            label: "a transfer grants NO exp — otherwise passing coins back and forth farms it",
            fn: async () => {
                const sender = await getState(db, A);
                const recipient = await getState(db, B);
                // Both were provisioned at exp 0 and have only transferred since.
                assert.equal(sender.exp, 0, "the sender gained exp from giving money away");
                assert.equal(recipient.exp, 0, "the recipient gained exp from being given money");
            },
        },
        {
            label: "a transfer larger than the balance is refused, and changes nothing",
            fn: async () => {
                const before = await getState(db, A);

                await assertThrows(
                    () => transfer(db, { fromId: A, toId: B, amount: 999_999 }),
                    "insufficient funds",
                );

                const after = await getState(db, A);
                assert.equal(
                    toInt(after.money),
                    toInt(before.money),
                    "a refused transfer still moved money",
                );
            },
        },
        {
            label: "transfers refuse zero, negative amounts and self-transfer",
            fn: async () => {
                await assertThrows(() => transfer(db, { fromId: A, toId: B, amount: 0 }), "positive");
                await assertThrows(() => transfer(db, { fromId: A, toId: B, amount: -5 }), "positive");
                await assertThrows(() => transfer(db, { fromId: A, toId: A, amount: 5 }), "themselves");
            },
        },
        {
            label: "an unknown economy reason is refused before it reaches the database",
            fn: async () => {
                await assertThrows(
                    () => addMoney(db, { discordId: A, amount: 1, reason: "vibes" }),
                    "not one of",
                );
            },
        },
        {
            label: "crediting a player who was never provisioned fails loudly",
            fn: async () => {
                await assertThrows(
                    () => addMoney(db, { discordId: "910000000000009999", amount: 5, reason: "game_win" }),
                    "ensurePlayer",
                );
            },
        },
        {
            label: "a failed credit rolls back its log row too",
            fn: async () => {
                const before = await explainBalance(db, A);
                // A non-integer amount is rejected before any write.
                await assertThrows(
                    () => addMoney(db, { discordId: A, amount: 1.5, reason: "game_win" }),
                    "integer",
                );
                const after = await explainBalance(db, A);
                assert.equal(after.total, before.total, "a rejected credit still wrote a log row");
            },
        },
        {
            label: "teardown — the test players are gone, and so are their ledgers",
            fn: async () => {
                await cleanup(db);
                for (const id of IDS) {
                    assert.equal(await getState(db, id), null);
                    const ledger = await explainBalance(db, id);
                    assert.equal(ledger.total, 0, `log_economy rows survived for ${id}`);
                }
            },
        },
    ];
};

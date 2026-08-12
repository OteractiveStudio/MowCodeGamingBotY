/**
 * Check: the market against the real database.
 *
 * The limits asserted here are the LEGACY's numbers, taken from `market_cog`. If one
 * needs to change it is a balance decision, so each case names where it came from.
 *
 * ⚠️ Reserved synthetic ids in the 9300… range, cleaned up before and after.
 */

import assert from "node:assert/strict";

import { ensurePlayer } from "../../app/data/player.js";
import { getState, explainBalance, toInt } from "../../app/data/economy.js";
import {
    buy,
    getMarket,
    getInventory,
    maxInventorySize,
    PurchaseError,
    PURCHASE_LIMIT,
    CARRY_CAP,
} from "../../app/data/inventory.js";

const BUYER = "930000000000000001";
const RICH = "930000000000000002";
const IDS = [BUYER, RICH];

const user = (id, name) => ({ id, username: name, globalName: null, bot: false });

async function cleanup(db) {
    await db.mst_player.destroy({ where: { discord_id: IDS } });
}

/** Assert a PurchaseError with a specific code, and that nothing changed. */
async function refuses(db, discordId, purchase, code) {
    const before = await getState(db, discordId);
    let error = null;
    try {
        await buy(db, { discordId, ...purchase });
    } catch (err) {
        error = err;
    }

    assert.ok(error, `expected a refusal (${code}) but the purchase went through`);
    assert.ok(
        error instanceof PurchaseError,
        `expected a PurchaseError, got ${error.name}: ${error.message}`,
    );
    assert.equal(error.code, code, `expected code ${code}, got ${error.code}: ${error.message}`);

    const after = await getState(db, discordId);
    assert.equal(toInt(after.money), toInt(before.money), "a refused purchase still took money");
    assert.equal(after.fishing_rod, before.fishing_rod, "a refused purchase still gave rods");
    assert.equal(
        after.inventory_size,
        before.inventory_size,
        "a refused purchase still gave slots",
    );
    return error;
}

export default (ctx) => {
    const { db } = ctx;

    return [
        {
            label: "clean slate",
            fn: async () => {
                await cleanup(db);
                for (const id of IDS) assert.equal(await getState(db, id), null);
            },
        },
        {
            label: "the market is seeded, and fishingrod really is listed in two categories",
            fn: async () => {
                const categories = await getMarket(db);
                assert.equal(categories.length, 3, "expected 3 categories — run npm run db:seed");

                const listedIn = categories.filter((c) =>
                    c.items.some((i) => i.item_key === "fishingrod"),
                );
                assert.equal(
                    listedIn.length,
                    2,
                    "fishingrod should appear in two categories, as in the legacy data",
                );
                // Same price in both, which is why one item row and two listings is right.
                const prices = listedIn.map(
                    (c) => c.items.find((i) => i.item_key === "fishingrod").price,
                );
                assert.equal(prices[0], prices[1]);
                assert.equal(prices[0], 5);
            },
        },
        {
            label: "buying a rod costs coins, adds a rod, and does NOT become an item",
            fn: async () => {
                await ensurePlayer(db, user(BUYER, "buyer"));
                const before = await getState(db, BUYER);

                const result = await buy(db, { discordId: BUYER, itemKey: "fishingrod", quantity: 3 });

                assert.equal(result.totalPrice, 15, "3 rods at 5 each");
                assert.equal(result.effect.kind, "rods");

                const after = await getState(db, BUYER);
                assert.equal(after.fishing_rod, before.fishing_rod + 3);
                assert.equal(toInt(after.money), toInt(before.money) - 15);

                // The legacy incremented the rod counter rather than storing an item.
                const items = await getInventory(db, BUYER);
                assert.equal(
                    items.find((i) => i.item_key === "fishingrod"),
                    undefined,
                    "a rod was stored as a carried item",
                );
            },
        },
        {
            label: "spending grants NO exp — the legacy market bypassed money_add entirely",
            fn: async () => {
                const state = await getState(db, BUYER);
                assert.equal(state.exp, 0, "buying granted exp");
                assert.equal(state.level, 1, "buying moved a level");
            },
        },
        {
            label: "a purchase writes both a ledger row and a txn_purchase row",
            fn: async () => {
                const ledger = await explainBalance(db, BUYER, 50);
                const purchases = ledger.entries.filter((e) => e.reason === "market_purchase");
                assert.ok(purchases.length >= 1, "no market_purchase ledger row");
                assert.equal(purchases[0].ref, "fishingrod");
                assert.ok(toInt(purchases[0].money_delta) < 0, "a purchase should be negative");
                assert.equal(ledger.matchesLiveBalance, true, "ledger and balance disagree");

                const receipts = await db.txn_purchase.findAll({ where: { discord_id: BUYER } });
                assert.ok(receipts.length >= 1, "no txn_purchase row");
                const receipt = receipts[0];
                assert.equal(
                    toInt(receipt.total_price),
                    toInt(receipt.unit_price) * receipt.quantity,
                    "the receipt total does not match its own parts",
                );
            },
        },
        {
            label: "the rod carry cap is 15, and it holds",
            fn: async () => {
                await cleanup(db);
                await ensurePlayer(db, user(BUYER, "buyer"), { defaults: { fishing_rod: 14 } });

                // 14 + 1 = 15 is fine.
                await buy(db, { discordId: BUYER, itemKey: "fishingrod", quantity: 1 });
                assert.equal((await getState(db, BUYER)).fishing_rod, CARRY_CAP.fishingrod);

                // 15 + 1 is not.
                const error = await refuses(
                    db,
                    BUYER,
                    { itemKey: "fishingrod", quantity: 1 },
                    "CARRY_CAP",
                );
                assert.equal(error.detail.cap, 15);
                assert.equal(error.detail.room, 0);
            },
        },
        {
            label: "the per-purchase ceiling refuses 16 rods before the carry cap does",
            fn: async () => {
                await cleanup(db);
                await ensurePlayer(db, user(BUYER, "buyer"), { defaults: { money: 100000, fishing_rod: 0 } });
                const error = await refuses(
                    db,
                    BUYER,
                    { itemKey: "fishingrod", quantity: 16 },
                    "PURCHASE_LIMIT",
                );
                assert.equal(error.detail.limit, PURCHASE_LIMIT.fishingrod);
            },
        },
        {
            label: "a new item type needs a free slot — level 1 has exactly one",
            fn: async () => {
                await cleanup(db);
                await ensurePlayer(db, user(RICH, "rich"), { defaults: { money: 100000 } });

                const state = await getState(db, RICH);
                assert.equal(state.inventory_size, 1, "a new player should have 1 slot");

                // First item type fits.
                await buy(db, { discordId: RICH, itemKey: "item1", quantity: 1 });
                const items = await getInventory(db, RICH);
                assert.equal(items.length, 1);
                assert.equal(items[0].quantity, 1);

                // A SECOND item type does not — the legacy's len(item)+1 > inventory_size.
                const error = await refuses(db, RICH, { itemKey: "cat", quantity: 1 }, "INVENTORY_FULL");
                assert.equal(error.detail.slots, 1);
                assert.equal(error.detail.used, 1);
            },
        },
        {
            label: "more of an item you ALREADY hold is fine with full slots",
            fn: async () => {
                // The legacy allowed topping up a held item even when slots were full.
                await buy(db, { discordId: RICH, itemKey: "item1", quantity: 4 });
                const items = await getInventory(db, RICH);
                assert.equal(items.length, 1, "topping up should not add a slot");
                assert.equal(items[0].quantity, 5, "quantities should accumulate");
            },
        },
        {
            label: "the per-item carry cap is 10",
            fn: async () => {
                assert.equal(CARRY_CAP.default, 10);
                // Holding 5, asking for 6 → 11 > 10.
                const error = await refuses(db, RICH, { itemKey: "item1", quantity: 6 }, "CARRY_CAP");
                assert.equal(error.detail.cap, 10);
                assert.equal(error.detail.current, 5);
                assert.equal(error.detail.room, 5);

                // Exactly 10 is allowed.
                await buy(db, { discordId: RICH, itemKey: "item1", quantity: 5 });
                const items = await getInventory(db, RICH);
                assert.equal(items[0].quantity, 10);
            },
        },
        {
            label: "a bag raises the slot ceiling, bounded by 1.2*(crystals*100 + level)",
            fn: async () => {
                await cleanup(db);
                // Level 30, no crystals → ceiling int(1.2 * 30) = 36.
                await ensurePlayer(db, user(RICH, "rich"), { defaults: { money: 100000 } });
                await db.mst_player_state.update({ level: 30 }, { where: { discord_id: RICH } });

                const state = await getState(db, RICH);
                assert.equal(maxInventorySize(state), 36);

                const result = await buy(db, { discordId: RICH, itemKey: "bag", quantity: 5 });
                assert.equal(result.effect.kind, "inventory_size");
                assert.equal(result.effect.to, 6, "1 + 5 bags");
                assert.equal((await getState(db, RICH)).inventory_size, 6);
            },
        },
        {
            label: "no more than 5 bags at a time, and never past the ceiling",
            fn: async () => {
                const error = await refuses(db, RICH, { itemKey: "bag", quantity: 6 }, "PURCHASE_LIMIT");
                assert.equal(error.detail.limit, PURCHASE_LIMIT.bag);

                // Drop the level so the ceiling is below the current size.
                await db.mst_player_state.update({ level: 1 }, { where: { discord_id: RICH } });
                const state = await getState(db, RICH);
                assert.equal(maxInventorySize(state), 1, "level 1 ceiling should be 1");
                assert.ok(state.inventory_size > 1, "this test needs a size above the ceiling");

                const ceilingError = await refuses(
                    db,
                    RICH,
                    { itemKey: "bag", quantity: 1 },
                    "MAX_INVENTORY_SIZE",
                );
                assert.equal(ceilingError.detail.ceiling, 1);
                assert.equal(ceilingError.detail.room, 0);
            },
        },
        {
            label: "you cannot buy what you cannot afford, and nothing changes when you try",
            fn: async () => {
                await cleanup(db);
                await ensurePlayer(db, user(BUYER, "buyer"));
                // 200 coins provisioned; a dog is 800.
                const error = await refuses(db, BUYER, { itemKey: "dog", quantity: 1 }, "INSUFFICIENT_FUNDS");
                assert.equal(error.detail.needed, 800);
                assert.equal(error.detail.available, 200);

                // And no ledger row was written for the attempt.
                const ledger = await explainBalance(db, BUYER, 50);
                assert.equal(
                    ledger.entries.filter((e) => e.reason === "market_purchase").length,
                    0,
                    "a refused purchase wrote a ledger row",
                );
            },
        },
        {
            label: "an item that does not exist is refused as NOT_FOR_SALE",
            fn: async () => {
                await refuses(db, BUYER, { itemKey: "submarine", quantity: 1 }, "NOT_FOR_SALE");
            },
        },
        {
            label: "item keys are case-insensitive — normalised once, not five times",
            fn: async () => {
                // The legacy's answer to case was duplicate command definitions.
                const result = await buy(db, { discordId: BUYER, itemKey: "FishingRod", quantity: 1 });
                assert.equal(result.itemKey, "fishingrod");
            },
        },
        {
            label: "concurrent purchases cannot both spend the same coins",
            fn: async () => {
                await cleanup(db);
                // Exactly enough for ONE dog at 800.
                await ensurePlayer(db, user(RICH, "rich"), { defaults: { money: 800 } });
                await db.mst_player_state.update(
                    { inventory_size: 10 },
                    { where: { discord_id: RICH } },
                );

                const attempts = await Promise.allSettled([
                    buy(db, { discordId: RICH, itemKey: "dog", quantity: 1 }),
                    buy(db, { discordId: RICH, itemKey: "cat", quantity: 1 }),
                ]);

                const succeeded = attempts.filter((a) => a.status === "fulfilled");
                const state = await getState(db, RICH);

                // Both would have passed the funds check in the legacy, because the
                // check and the write were not in the same transaction.
                assert.ok(
                    toInt(state.money) >= 0,
                    `overspent: balance is ${state.money}`,
                );
                const spent = 800 - toInt(state.money);
                const expected = succeeded.reduce((sum, a) => sum + a.value.totalPrice, 0);
                assert.equal(spent, expected, "money spent does not match the purchases that succeeded");
            },
        },
        {
            label: "teardown",
            fn: async () => {
                await cleanup(db);
                for (const id of IDS) {
                    assert.equal(await getState(db, id), null);
                    assert.equal((await getInventory(db, id)).length, 0);
                }
            },
        },
    ];
};

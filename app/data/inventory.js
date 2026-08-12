/**
 * app/data/inventory.js — the market, and what a player is carrying.
 *
 * From the legacy `market_cog` buy flow and `MCGB_BasicClass.inventory_add` /
 * `fishingrod_add` / `get_max_inv_size`. All the limits below are HIS numbers, cited
 * where they came from, because they are game balance rather than implementation.
 *
 * ⚠️ Buying grants NO exp, and that is faithful: the legacy market wrote
 * `player_inv['money'] -= price * amount` **directly**, bypassing `money_add` and
 * therefore bypassing `exp_add`. Only earning granted exp, never spending.
 *
 * 🔑 The whole purchase is ONE transaction against a locked state row: the funds
 * check, the money deduction, the ledger row, the `txn_purchase` record and the item
 * effect either all happen or none do. The legacy did the check, then mutated a dict
 * in memory, then rewrote the entire players file — so two purchases racing could both
 * pass the funds check and both succeed.
 */

import { QueryTypes } from "sequelize";

import { cascadeProgress, toInt } from "./economy.js";

/**
 * Per-purchase ceilings, from `market_cog`:
 *   bag        → "You can't buy more than 5 bags at a time."
 *   fishingrod → "You can't buy more than 15 fishing rods at a time."
 *   everything else → "You can't buy more than 10 {item}s at a time."
 */
export const PURCHASE_LIMIT = { bag: 5, fishingrod: 15, default: 10 };

/**
 * How many a player may HOLD, also from `market_cog`:
 *   fishingrod → 15 ("You can't carry a fishing rod more than 15 at a time.")
 *   any item   → 10
 *
 * ⚠️ NOTE THE LEGACY CONTRADICTING ITSELF: `market_cog` caps rods at 15, but
 * `fishing_cog`'s auto mode is written to burn up to 30 (`if rod_left > 30`). Both
 * numbers are his, in different files, and they cannot both be reachable through the
 * market alone. Kept as-is rather than silently reconciled — which of the two is
 * wrong is a balance decision, not a bug to quietly fix.
 */
export const CARRY_CAP = { fishingrod: 15, default: 10 };

/** Items that are not carried but change the player's state instead. */
export const SPECIAL_ITEMS = { fishingrod: "rods", bag: "inventory_size" };

/**
 * The legacy `get_max_inv_size`:
 *
 *     max_inv_size = 1.2 * int((magical_crystal*100 + level) / 1)
 *     return int(max_inv_size)
 *
 * So at level 1 with no crystals the ceiling is `int(1.2) = 1`, which is exactly the
 * `inventory_size` a new player is provisioned with. The size itself is stored; this
 * is only the ceiling `bag` purchases may raise it to.
 */
export function maxInventorySize({ level, magical_crystal }) {
    return Math.floor(1.2 * (magical_crystal * 100 + level));
}

export function purchaseLimitFor(itemKey) {
    return PURCHASE_LIMIT[itemKey] ?? PURCHASE_LIMIT.default;
}

export function carryCapFor(itemKey) {
    return CARRY_CAP[itemKey] ?? CARRY_CAP.default;
}

/**
 * A refusal the caller is expected to show the player, as opposed to a bug.
 * Carries a `code` so the cog can phrase each one without matching on message text.
 */
export class PurchaseError extends Error {
    constructor(code, message, detail = {}) {
        super(message);
        this.name = "PurchaseError";
        this.code = code;
        this.detail = detail;
    }
}

/** The market, grouped by category, for display. */
export async function getMarket(db) {
    const rows = await db.sequelize.query(
        `SELECT c.category_key, c.display_name AS category_name, c.emoji AS category_emoji,
                c.sort_order, i.item_key, i.display_name AS item_name, i.emoji AS item_emoji,
                i.detail, l.price
           FROM ${db.schema}.mst_market_listing l
           JOIN ${db.schema}.mst_market_category c ON c.category_key = l.category_key
           JOIN ${db.schema}.mst_item i ON i.item_key = l.item_key
          WHERE l.is_available AND c.is_active
          ORDER BY c.sort_order ASC, l.price ASC, i.item_key ASC`,
        { type: QueryTypes.SELECT },
    );

    const byCategory = new Map();
    for (const row of rows) {
        if (!byCategory.has(row.category_key)) {
            byCategory.set(row.category_key, {
                category_key: row.category_key,
                display_name: row.category_name,
                emoji: row.category_emoji,
                items: [],
            });
        }
        byCategory.get(row.category_key).items.push({
            item_key: row.item_key,
            display_name: row.item_name,
            emoji: row.item_emoji,
            detail: row.detail,
            price: toInt(row.price, `price of ${row.item_key}`),
        });
    }

    return [...byCategory.values()];
}

/** What a player is carrying, joined to the catalogue. */
export async function getInventory(db, discordId) {
    return db.sequelize.query(
        `SELECT pi.item_key, pi.quantity, pi.acquired_at,
                i.display_name, i.emoji, i.detail
           FROM ${db.schema}.mst_player_item pi
           JOIN ${db.schema}.mst_item i ON i.item_key = pi.item_key
          WHERE pi.discord_id = :id
          ORDER BY i.display_name ASC`,
        { replacements: { id: String(discordId) }, type: QueryTypes.SELECT },
    );
}

/**
 * The cheapest available listing for an item, and where it is sold. `fishingrod` is
 * listed in two categories at the same price, so "cheapest, then first category" is
 * deterministic without needing the caller to name a category.
 */
async function findListing(db, itemKey, categoryKey, transaction) {
    const rows = await db.sequelize.query(
        `SELECT l.category_key, l.item_key, l.price, i.display_name
           FROM ${db.schema}.mst_market_listing l
           JOIN ${db.schema}.mst_item i ON i.item_key = l.item_key
           JOIN ${db.schema}.mst_market_category c ON c.category_key = l.category_key
          WHERE l.item_key = :item AND l.is_available AND c.is_active
            AND (:category IS NULL OR l.category_key = :category)
          ORDER BY l.price ASC, c.sort_order ASC
          LIMIT 1`,
        {
            replacements: { item: String(itemKey), category: categoryKey ?? null },
            type: QueryTypes.SELECT,
            transaction,
        },
    );
    return rows[0] ?? null;
}

/**
 * Buy `quantity` of an item, atomically.
 *
 * Order of checks follows the legacy's: affordability first, then the per-item rules.
 *
 * @throws {PurchaseError} for anything the player should be told about
 */
export async function buy(db, { discordId, itemKey, categoryKey = null, quantity = 1, guildId = null }) {
    if (!Number.isInteger(quantity) || quantity < 1) {
        throw new PurchaseError(
            "BAD_QUANTITY",
            `quantity must be a positive integer, got ${JSON.stringify(quantity)}`,
        );
    }

    const key = String(itemKey).toLowerCase();

    return db.sequelize.transaction(async (transaction) => {
        const stateRows = await db.sequelize.query(
            `SELECT money, exp, level, magical_crystal, fishing_rod, inventory_size
               FROM ${db.schema}.mst_player_state
              WHERE discord_id = :id FOR UPDATE`,
            { replacements: { id: String(discordId) }, type: QueryTypes.SELECT, transaction },
        );
        const state = stateRows[0];
        if (!state) {
            throw new Error(
                `no state row for player ${discordId} — provision them with ensurePlayer() first`,
            );
        }

        const listing = await findListing(db, key, categoryKey, transaction);
        if (!listing) {
            throw new PurchaseError("NOT_FOR_SALE", `"${key}" is not for sale`, { itemKey: key });
        }

        const unitPrice = toInt(listing.price, "listing price");
        const totalPrice = unitPrice * quantity;
        const money = toInt(state.money, "money");

        // 1. Affordability — the legacy checked this before anything else.
        if (money < totalPrice) {
            throw new PurchaseError(
                "INSUFFICIENT_FUNDS",
                `not enough coins: ${totalPrice} needed, ${money} available`,
                { needed: totalPrice, available: money, unitPrice, quantity },
            );
        }

        // 2. Per-purchase ceiling.
        const perPurchase = purchaseLimitFor(key);
        if (quantity > perPurchase) {
            throw new PurchaseError(
                "PURCHASE_LIMIT",
                `you cannot buy more than ${perPurchase} ${listing.display_name} at a time`,
                { limit: perPurchase, itemKey: key },
            );
        }

        // 3. The item's own effect and its holding limit.
        let effect;

        if (key === "bag") {
            // Raises inventory_size, bounded by the level/crystal ceiling.
            const ceiling = maxInventorySize(state);
            if (state.inventory_size + quantity > ceiling) {
                throw new PurchaseError(
                    "MAX_INVENTORY_SIZE",
                    `you can have up to ${ceiling} inventory slots at your level`,
                    {
                        ceiling,
                        current: state.inventory_size,
                        room: Math.max(0, ceiling - state.inventory_size),
                    },
                );
            }
            await db.sequelize.query(
                `UPDATE ${db.schema}.mst_player_state
                    SET inventory_size = inventory_size + :n, updated_at = now()
                  WHERE discord_id = :id`,
                { replacements: { id: String(discordId), n: quantity }, transaction },
            );
            effect = { kind: "inventory_size", from: state.inventory_size, to: state.inventory_size + quantity };
        } else if (key === "fishingrod") {
            const cap = carryCapFor(key);
            if (state.fishing_rod + quantity > cap) {
                throw new PurchaseError(
                    "CARRY_CAP",
                    `you cannot carry more than ${cap} fishing rods`,
                    { cap, current: state.fishing_rod, room: Math.max(0, cap - state.fishing_rod) },
                );
            }
            await db.sequelize.query(
                `UPDATE ${db.schema}.mst_player_state
                    SET fishing_rod = fishing_rod + :n, updated_at = now()
                  WHERE discord_id = :id`,
                { replacements: { id: String(discordId), n: quantity }, transaction },
            );
            effect = { kind: "rods", from: state.fishing_rod, to: state.fishing_rod + quantity };
        } else {
            const heldRows = await db.sequelize.query(
                `SELECT
                    (SELECT quantity FROM ${db.schema}.mst_player_item
                      WHERE discord_id = :id AND item_key = :item) AS held,
                    (SELECT count(*)::int FROM ${db.schema}.mst_player_item
                      WHERE discord_id = :id) AS distinct_items`,
                {
                    replacements: { id: String(discordId), item: key },
                    type: QueryTypes.SELECT,
                    transaction,
                },
            );
            const held = heldRows[0].held ?? 0;
            const distinctItems = heldRows[0].distinct_items;

            const cap = carryCapFor(key);
            if (held + quantity > cap) {
                throw new PurchaseError(
                    "CARRY_CAP",
                    `you cannot carry more than ${cap} ${listing.display_name}`,
                    { cap, current: held, room: Math.max(0, cap - held) },
                );
            }

            // A NEW item type needs a free slot. The legacy check was
            // `len(item) + 1 > inventory_size`.
            if (held === 0 && distinctItems + 1 > state.inventory_size) {
                throw new PurchaseError(
                    "INVENTORY_FULL",
                    "your item slots are full — you cannot buy an item you do not already hold",
                    { slots: state.inventory_size, used: distinctItems },
                );
            }

            await db.sequelize.query(
                `INSERT INTO ${db.schema}.mst_player_item (discord_id, item_key, quantity, acquired_at, updated_at)
                 VALUES (:id, :item, :n, now(), now())
                 ON CONFLICT (discord_id, item_key) DO UPDATE
                    SET quantity = ${db.schema}.mst_player_item.quantity + EXCLUDED.quantity,
                        updated_at = now()`,
                { replacements: { id: String(discordId), item: key, n: quantity }, transaction },
            );
            effect = { kind: "item", itemKey: key, from: held, to: held + quantity };
        }

        // 4. Pay. Spending grants no exp, so the cascade is applied with a zero delta —
        // it still runs, because the legacy's level-0 quirk means even zero can move a
        // level, and that behaviour must not depend on which command called it.
        const progressed = cascadeProgress({
            exp: state.exp,
            level: state.level,
            magical_crystal: state.magical_crystal,
            expDelta: 0,
        });
        const moneyAfter = money - totalPrice;

        await db.sequelize.query(
            `UPDATE ${db.schema}.mst_player_state
                SET money = :money, exp = :exp, level = :level,
                    magical_crystal = :crystal, updated_at = now()
              WHERE discord_id = :id`,
            {
                replacements: {
                    id: String(discordId),
                    money: moneyAfter,
                    exp: progressed.exp,
                    level: progressed.level,
                    crystal: progressed.magical_crystal,
                },
                transaction,
            },
        );

        await db.log_economy.create(
            {
                discord_id: String(discordId),
                reason: "market_purchase",
                money_delta: -totalPrice,
                money_after: moneyAfter,
                exp_delta: 0,
                exp_after: progressed.exp,
                level_after: progressed.level,
                crystal_after: progressed.magical_crystal,
                levels_gained: progressed.levelsGained,
                crystals_gained: progressed.crystalsGained,
                ref: key,
                guild_id: guildId ? String(guildId) : null,
                actor_id: null,
            },
            { transaction },
        );

        await db.txn_purchase.create(
            {
                discord_id: String(discordId),
                item_key: key,
                category_key: listing.category_key,
                quantity,
                unit_price: unitPrice,
                total_price: totalPrice,
                guild_id: guildId ? String(guildId) : null,
            },
            { transaction },
        );

        return {
            itemKey: key,
            displayName: listing.display_name,
            categoryKey: listing.category_key,
            quantity,
            unitPrice,
            totalPrice,
            money: moneyAfter,
            effect,
        };
    });
}

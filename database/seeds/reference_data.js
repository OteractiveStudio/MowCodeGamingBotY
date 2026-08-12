/**
 * database/seeds/reference_data.js — the game's reference data.
 *
 * ⚠️ TRANSCRIBED, ON PURPOSE, from the legacy bot's data files:
 *   fish   ← BN_bot/data/fish/fish.json      (9 entries)
 *   market ← BN_bot/data/files/market.json   (3 categories, 8 distinct items)
 *
 * It is baked in rather than read from the legacy tree because **this repository
 * must stand alone.** The legacy lives in a different tree that is not a dependency
 * and will not be published with this one.
 *
 * ⚠️ Keys were NORMALISED to lowercase — the legacy categories were `Quick_menu`,
 * `Pet`, `Tool`. Presentation lives in `display_name`, so nothing user-facing was
 * lost, and the SQL can constrain a key's shape. The legacy's answer to case was to
 * define the same command five times (`ox`, `Ox`, `oX`, `xo`, `XO`); normalising
 * once is the alternative.
 *
 * `display_name` values are humanised from the keys — the legacy had no such field.
 */

import { WORDLE_WORDS } from "./wordle_words.js";

/** Draw weight is `10 - tier`, so a LOWER tier is MORE common. */
export const FISH = [
    { fish_key: "Nothing", display_name: "Nothing", file_name: "Nothing.png", fish_type: "not_creature", price: 0, tier: 0 },
    { fish_key: "Trash", display_name: "Trash", file_name: "Trash.png", fish_type: "not_creature", price: 1, tier: 1 },
    { fish_key: "Squid", display_name: "Squid", file_name: "Squid.jpg", fish_type: "creature", price: 8, tier: 2 },
    { fish_key: "Dolly", display_name: "Dolly", file_name: "Dolly.jpg", fish_type: "creature", price: 10, tier: 2 },
    { fish_key: "Salmon", display_name: "Salmon", file_name: "Salmon.jpg", fish_type: "creature", price: 10, tier: 2 },
    { fish_key: "BonnSturgeon", display_name: "Bonn Sturgeon", file_name: "BonnSturgeon.jpg", fish_type: "creature", price: 15, tier: 2 },
    { fish_key: "SpottedMackerel", display_name: "Spotted Mackerel", file_name: "SpottedMackerel.jpg", fish_type: "creature", price: 20, tier: 3 },
    { fish_key: "BluefinTuna", display_name: "Bluefin Tuna", file_name: "BluefinTuna.jpg", fish_type: "creature", price: 25, tier: 3 },
    // Tier 9 — weight 1, the rarest thing in the sea, and the reason the tier CHECK
    // stops at 9 rather than being left open.
    { fish_key: "AmogusTheFish", display_name: "Amogus The Fish", file_name: "AmogusTheFish.png", fish_type: "creature", price: 100, tier: 9 },
];

export const ITEMS = [
    { item_key: "fishingrod", display_name: "Fishing rod", emoji: "🎣", detail: "You use this item to catch a fish once." },
    { item_key: "item1", display_name: "Item 1", emoji: "🍎", detail: "This item is used to test the market operation." },
    { item_key: "cat", display_name: "Cat", emoji: "🐱", detail: "Cat can make noise and prevent you from being stolen." },
    { item_key: "dog", display_name: "Dog", emoji: "🐶", detail: "Dog can protect you from being robbed or stolen." },
    { item_key: "knife", display_name: "Knife", emoji: "🔪", detail: "You can use this item to rob someone." },
    { item_key: "gun", display_name: "Gun", emoji: "🔫", detail: "You can use this item to rob someone." },
    { item_key: "passkey", display_name: "Passkey", emoji: "🔑", detail: "You can use this item to steal someone's money." },
    { item_key: "bag", display_name: "Bag", emoji: "🎒", detail: "When you buy this item, you can carry more item types." },
];

export const MARKET_CATEGORIES = [
    { category_key: "quick_menu", display_name: "Quick menu", emoji: "⚡", sort_order: 1 },
    { category_key: "pet", display_name: "Pet", emoji: "1️⃣", sort_order: 2 },
    { category_key: "tool", display_name: "Tool", emoji: "2️⃣", sort_order: 3 },
];

/**
 * ⚠️ Note `fishingrod` appearing TWICE, at the same price — exactly as the legacy
 * market.json had it. This is the duplication that made two tables necessary
 * instead of a category column on the item.
 */
export const MARKET_LISTINGS = [
    { category_key: "quick_menu", item_key: "fishingrod", price: 5 },
    { category_key: "quick_menu", item_key: "item1", price: 1 },
    { category_key: "pet", item_key: "cat", price: 500 },
    { category_key: "pet", item_key: "dog", price: 800 },
    { category_key: "tool", item_key: "fishingrod", price: 5 },
    { category_key: "tool", item_key: "passkey", price: 600 },
    { category_key: "tool", item_key: "knife", price: 1000 },
    { category_key: "tool", item_key: "gun", price: 3000 },
    { category_key: "tool", item_key: "bag", price: 3000 },
];

/**
 * Upsert all of it. Idempotent by design: re-running syncs the database to this
 * file, which is the same instinct as the legacy's `add_fish`/`del_fish` reconciling
 * fish.json against the actual picture files in both directions.
 *
 * Rows are never deleted here — retiring something sets `is_active` false, so catch
 * and purchase history stays readable.
 */
export async function seedReferenceData(db) {
    const counts = { fish: 0, items: 0, categories: 0, listings: 0, words: 0 };

    await db.sequelize.transaction(async (transaction) => {
        for (const fish of FISH) {
            await db.mst_fish.upsert(fish, { transaction });
            counts.fish += 1;
        }
        for (const item of ITEMS) {
            await db.mst_item.upsert(item, { transaction });
            counts.items += 1;
        }
        // Categories before listings — the listing's foreign key needs them.
        for (const category of MARKET_CATEGORIES) {
            await db.mst_market_category.upsert(category, { transaction });
            counts.categories += 1;
        }
        for (const listing of MARKET_LISTINGS) {
            await db.mst_market_listing.upsert(listing, { transaction });
            counts.listings += 1;
        }

        // ⭐ The wordle dictionary. Unlike everything above it is NOT transcribed from the
        // legacy — his words.txt is zero bytes and the real source was two third-party HTTP
        // APIs. See wordle_words.js. Bulk-inserted rather than upserted one at a time: 2,000
        // individual upserts is 2,000 round trips for data that never changes.
        await db.mst_wordle_word.bulkCreate(WORDLE_WORDS, {
            transaction,
            updateOnDuplicate: ["length", "is_answer", "is_active", "updated_at"],
        });
        counts.words = WORDLE_WORDS.length;
    });

    return counts;
}

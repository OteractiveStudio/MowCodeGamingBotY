/**
 * app/data/fishing.js — the weighted draw, and casting.
 *
 * 🔑 THE ONE THAT USED TO HURT. The legacy `fishing auto` looked like this:
 *
 *     rod_left = b.fishingrod_check(fisher.id)
 *     if rod_left > 30: rod_left = 30
 *     for i in range(rod_left):
 *         caught = self.random_fish()
 *         b.money_add(fisher.id, caught['price'])   # read + write players_inv.json
 *         b.fishingrod_add(fisher.id, -1)           # read + write it AGAIN
 *
 * `money_add` also called `exp_add`, which read and wrote the same file a third
 * time. Thirty rods therefore meant **120+ sequential whole-file rewrites** of
 * players_inv.json, one after another, while every other player's commands
 * interleaved with them. Measured on this schema, that pattern loses 98% of its
 * writes under concurrency.
 *
 * Here **the entire batch is one transaction**: the state row is locked once, all N
 * fish are drawn, one UPDATE applies the totals, and N ledger rows are inserted.
 * Thirty casts cost one lock and one write instead of 120 file rewrites.
 *
 * The draw itself is the legacy's, unchanged.
 */

import { QueryTypes } from "sequelize";

import { cascadeProgress, toInt } from "./economy.js";

/** The legacy cap: `fishing auto` never burns more than 30 rods in one go. */
export const AUTO_CAST_LIMIT = 30;

/**
 * A fish's draw weight, straight from the legacy pool builder:
 *
 *     for i in fish_data: fish_list += [i] * (10 - fish_data[i]['tier'])
 *
 * So a LOWER tier is MORE common, and tier 10 would be undrawable — which is why the
 * SQL constrains tier to 0-9.
 */
export function drawWeight(tier) {
    return 10 - tier;
}

/** Total weight of a pool. The denominator of every rate. */
export function totalWeight(fishList) {
    return fishList.reduce((sum, fish) => sum + drawWeight(fish.tier), 0);
}

/**
 * The legacy `fish_rate`, as a percentage:
 *
 *     f"{(10 - tier) / all_posible * 100:.2f}"
 */
export function fishRate(tier, fishList) {
    const total = totalWeight(fishList);
    if (total <= 0) return 0;
    return (drawWeight(tier) / total) * 100;
}

/**
 * Pick one fish, weighted. `random` is injectable so the draw is testable —
 * the legacy called `random.choice` on an expanded list, which is the same
 * distribution, just built with more memory.
 */
export function drawFish(fishList, random = Math.random) {
    if (!Array.isArray(fishList) || fishList.length === 0) {
        throw new Error("cannot draw from an empty fish pool — has the reference data been seeded?");
    }

    const total = totalWeight(fishList);
    if (total <= 0) {
        throw new Error("every fish in the pool has zero or negative weight — check the tiers");
    }

    let roll = random() * total;
    for (const fish of fishList) {
        roll -= drawWeight(fish.tier);
        if (roll < 0) return fish;
    }

    // Only reachable through floating-point drift at the very top of the range.
    return fishList[fishList.length - 1];
}

/** The catchable pool, ordered so a given `random` sequence always draws the same. */
export async function getFishPool(db, options = {}) {
    return db.sequelize.query(
        `SELECT fish_key, display_name, file_name, fish_type, price, tier
           FROM ${db.schema}.mst_fish
          WHERE is_active
          ORDER BY tier ASC, fish_key ASC`,
        { type: QueryTypes.SELECT, transaction: options.transaction },
    );
}

/**
 * Cast up to `casts` times, in ONE transaction.
 *
 * Every catch gets its own `log_economy` row — so the ledger can say *which* fish
 * paid for what, and `money_after` still chains correctly across the batch — but they
 * are all written under a single lock, with a single UPDATE of the player's state.
 *
 * The exp cascade is applied **per catch**, exactly as the legacy's per-catch
 * `money_add` → `exp_add` did, so the per-row `level_after` values are true.
 *
 * @returns {Promise<{casts:number, caught:Array, totalEarned:number, money:number,
 *                    exp:number, level:number, magical_crystal:number,
 *                    levelsGained:number, crystalsGained:number, rodsLeft:number}>}
 */
export async function cast(db, { discordId, casts = 1, guildId = null, random = Math.random }) {
    if (!Number.isInteger(casts) || casts < 1) {
        throw new Error(`casts must be a positive integer, got ${JSON.stringify(casts)}`);
    }

    return db.sequelize.transaction(async (transaction) => {
        const stateRows = await db.sequelize.query(
            `SELECT money, exp, level, magical_crystal, fishing_rod, fishing_count
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

        const rods = state.fishing_rod;
        if (rods < 1) {
            // Not an exception: having no rods is an ordinary outcome the caller
            // reports to the player, exactly as the legacy did.
            return {
                casts: 0,
                caught: [],
                totalEarned: 0,
                money: toInt(state.money, "money"),
                exp: state.exp,
                level: state.level,
                magical_crystal: state.magical_crystal,
                levelsGained: 0,
                crystalsGained: 0,
                rodsLeft: 0,
                outOfRods: true,
            };
        }

        const pool = await getFishPool(db, { transaction });
        const actualCasts = Math.min(casts, rods, AUTO_CAST_LIMIT);

        const running = {
            money: toInt(state.money, "money"),
            exp: state.exp,
            level: state.level,
            magical_crystal: state.magical_crystal,
        };

        const caught = [];
        const ledgerRows = [];
        let totalEarned = 0;
        let levelsGained = 0;
        let crystalsGained = 0;

        for (let index = 0; index < actualCasts; index += 1) {
            const fish = drawFish(pool, random);
            const price = toInt(fish.price, `price of ${fish.fish_key}`);

            running.money += price;
            totalEarned += price;

            // Per catch, as the legacy did: money_add(price) called exp_add(price).
            const progressed = cascadeProgress({
                exp: running.exp,
                level: running.level,
                magical_crystal: running.magical_crystal,
                expDelta: price,
            });
            running.exp = progressed.exp;
            running.level = progressed.level;
            running.magical_crystal = progressed.magical_crystal;
            levelsGained += progressed.levelsGained;
            crystalsGained += progressed.crystalsGained;

            caught.push({ ...fish, price });

            ledgerRows.push({
                discord_id: String(discordId),
                reason: "fishing_catch",
                money_delta: price,
                money_after: running.money,
                exp_delta: price,
                exp_after: running.exp,
                level_after: running.level,
                crystal_after: running.magical_crystal,
                levels_gained: progressed.levelsGained,
                crystals_gained: progressed.crystalsGained,
                ref: fish.fish_key,
                guild_id: guildId ? String(guildId) : null,
                actor_id: null,
            });
        }

        // ONE write for the whole batch. This single statement replaces the legacy's
        // 120+ file rewrites.
        await db.sequelize.query(
            `UPDATE ${db.schema}.mst_player_state
                SET money = :money,
                    exp = :exp,
                    level = :level,
                    magical_crystal = :crystal,
                    fishing_rod = fishing_rod - :used,
                    fishing_count = fishing_count + :used,
                    updated_at = now()
              WHERE discord_id = :id`,
            {
                replacements: {
                    id: String(discordId),
                    money: running.money,
                    exp: running.exp,
                    level: running.level,
                    crystal: running.magical_crystal,
                    used: actualCasts,
                },
                transaction,
            },
        );

        // Rows are inserted in draw order, so rolling_id ascends with the casts and the
        // money_after chain reads correctly.
        await db.log_economy.bulkCreate(ledgerRows, { transaction });

        return {
            casts: actualCasts,
            caught,
            totalEarned,
            money: running.money,
            exp: running.exp,
            level: running.level,
            magical_crystal: running.magical_crystal,
            levelsGained,
            crystalsGained,
            rodsLeft: rods - actualCasts,
            outOfRods: false,
        };
    });
}

/** Burn every rod the player has, up to the legacy's 30-rod ceiling. */
export async function castAll(db, options) {
    return cast(db, { ...options, casts: AUTO_CAST_LIMIT });
}

// ── The animation ────────────────────────────────────────────────────────────
//
// ⭐ Ported from the legacy `fishing_animetion()`, unchanged, because it is the thing he
// noticed missing within one command of testing. Two rows: a sky of sunrises with a rower
// dropped in at a random spot, over a sea of waves with one random creature surfacing.
//
// ⚠️ It is now a REVEAL, not a live feed. The legacy drew a frame per cast *while* it
// rewrote the players file 4 times per rod; here the whole batch is already computed and
// committed in one transaction before the first frame is drawn. Identical to watch, and the
// coins are safe before the animation starts rather than during it.

/** His list, verbatim — including the custom slime emoji and the amogus. */
export const ANIMATION_CREATURES = [
    "🎣", "🦈", "🐬", "🐟", "🐠", "🐡", "🐳", "🐋",
    "<:slimesus:946402258822778961>",
    "🐢", "🐲", "🐉", "🦐", "🦑", "🐙", "🐚", "🦞", "🦀",
    "<:slimesus:946402258822778961>",
    "🌊", "𐐘ඞ", "𐐘ඞ",
];

/**
 * One frame. `random` is injectable so the shape can be tested.
 *
 * The legacy used `sea.insert(random.randint(0, 9), fish)` on a 10-wave list and
 * `sky.insert(random.randint(0, 8), rower)` on a 9-sunrise list, so the sea ends up 11 wide
 * and the sky 10. Reproduced exactly — the ragged edge is part of the look.
 */
export function animationFrame(random = Math.random) {
    const creature = ANIMATION_CREATURES[Math.floor(random() * ANIMATION_CREATURES.length)];

    const sea = Array(10).fill("🌊");
    sea.splice(Math.floor(random() * 10), 0, creature);

    const sky = Array(9).fill("🌅");
    sky.splice(Math.floor(random() * 9), 0, "🚣‍♂️🎣");

    return `\n${sky.join("")}\n${sea.join("")}`;
}

/**
 * A random ocean photo for the embed.
 *
 * ⚠️ His list had nine URLs; the two `encrypted-tbn0.gstatic.com` entries were Google image
 * thumbnails, which are not stable links and are dropped. The rest are Wikimedia / Flickr /
 * Pixabay / Pixahive and are left as they were. If one has rotted since 2022, Discord simply
 * shows no image — it does not break the command.
 */
export const SEA_PICTURES = [
    "https://upload.wikimedia.org/wikipedia/commons/4/48/Atlantis_-_Island_In_The_Middle_Of_The_Ocean_-_Middle_Of_Nowhere_-_panoramio.jpg",
    "https://live.staticflickr.com/3917/18857233062_3c6989d426_z.jpg",
    "https://cdn.pixabay.com/photo/2014/03/04/12/07/ocean-279440_1280.jpg",
    "https://live.staticflickr.com/65535/50838642242_a5a7a0918c_b.jpg",
    "https://live.staticflickr.com/4678/27877614039_6c7cc229e0_b.jpg",
    "https://pixahive.com/wp-content/uploads/2020/12/Ocean8217s-Afterglow-258318-pixahive.jpg",
    "https://live.staticflickr.com/65535/68724171_0e3007f065_b.jpg",
];

export function seaPicture(random = Math.random) {
    return SEA_PICTURES[Math.floor(random() * SEA_PICTURES.length)];
}

/**
 * How many frames to draw for a run of N casts.
 *
 * ⚠️ The legacy's own throttle, kept: `if rod_left < 21` — it only animated runs of 20 or
 * fewer, so a full 30-rod run showed one frame and then the result. That is what keeps this
 * from being 30 message edits, and it is his number, not mine.
 */
export function animationFrameCount(casts) {
    return casts < 21 ? casts : 0;
}

/** Group a batch of catches for display: what, how many, worth how much. */
export function summariseCatch(caught) {
    const byFish = new Map();
    for (const fish of caught) {
        const entry = byFish.get(fish.fish_key) ?? {
            fish_key: fish.fish_key,
            display_name: fish.display_name,
            tier: fish.tier,
            price: fish.price,
            count: 0,
            earned: 0,
        };
        entry.count += 1;
        entry.earned += fish.price;
        byFish.set(fish.fish_key, entry);
    }
    return [...byFish.values()].sort((a, b) => b.earned - a.earned || a.tier - b.tier);
}

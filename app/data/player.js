/**
 * app/data/player.js — everything that reads or writes a player's identity and
 * provisions their game state.
 *
 * ⭐ THE SEAM. The legacy drew this correctly: cogs never opened a file, they called
 * `b.money_add()` on one data layer. That is the only reason this port is tractable —
 * the game logic does not know what the store is. Kept exactly, with one change: it is
 * a directory of modules per concern instead of one 387-line `basic` class that owned
 * players, fish, guilds, formatting and the clock.
 *
 * 🔑 Provisioning is atomic. The legacy `add_player` was read-whole-file → mutate →
 * write-whole-file, so two commands arriving together for a new player could each read
 * "absent" and then both write.
 */

import { QueryTypes } from "sequelize";

/**
 * Provision-or-refresh a player, and make sure they have a game-state row.
 *
 * Three statements in ONE transaction:
 *   1. upsert identity        (INSERT … ON CONFLICT DO UPDATE … RETURNING)
 *   2. create state if absent (INSERT … ON CONFLICT DO NOTHING)
 *   3. if state was just created, write its `provision` row into log_economy
 *
 * Step 3 matters more than it looks: it is what makes a balance explainable from row
 * one. Without it the starting 200 coins would be money that appeared from nowhere,
 * and every later audit would have to special-case the beginning.
 *
 * `first_seen_at` is deliberately absent from the UPDATE set — written once by the
 * INSERT and never touched again, which is why this is a statement and not a
 * read-then-write.
 *
 * @returns {Promise<{row: object, state: object, created: boolean, stateCreated: boolean}>}
 */
export async function ensurePlayer(db, user, options = {}) {
    const defaults = options.defaults || {};

    const run = async (transaction) => {
        const identityRows = await db.sequelize.query(
            `
            INSERT INTO ${db.schema}.mst_player
                (discord_id, username, global_name, is_bot, first_seen_at, last_seen_at, created_at, updated_at)
            VALUES
                (:discord_id, :username, :global_name, :is_bot, now(), now(), now(), now())
            ON CONFLICT (discord_id) DO UPDATE SET
                username     = EXCLUDED.username,
                global_name  = EXCLUDED.global_name,
                is_bot       = EXCLUDED.is_bot,
                last_seen_at = now(),
                updated_at   = now()
            RETURNING *, (xmax = 0) AS was_inserted
            `,
            {
                replacements: {
                    discord_id: String(user.id),
                    username: user.username ?? null,
                    global_name: user.globalName ?? user.global_name ?? null,
                    is_bot: !!user.bot,
                },
                type: QueryTypes.SELECT,
                transaction,
            },
        );

        const row = identityRows[0];

        // The state row's defaults live in SQL (from the legacy settings.json
        // default_inventory), so DEFAULT is used unless a caller overrides.
        const stateRows = await db.sequelize.query(
            `
            INSERT INTO ${db.schema}.mst_player_state
                (discord_id, money, fishing_rod, inventory_size, exp, level, magical_crystal, fishing_count)
            VALUES
                (:discord_id,
                 COALESCE(:money, 200),
                 COALESCE(:fishing_rod, 10),
                 COALESCE(:inventory_size, 1),
                 0, 1, 0, 0)
            ON CONFLICT (discord_id) DO NOTHING
            RETURNING *
            `,
            {
                replacements: {
                    discord_id: String(user.id),
                    money: defaults.money ?? null,
                    fishing_rod: defaults.fishing_rod ?? null,
                    inventory_size: defaults.inventory_size ?? null,
                },
                type: QueryTypes.SELECT,
                transaction,
            },
        );

        const stateCreated = stateRows.length > 0;
        let state = stateRows[0] ?? null;

        if (stateCreated) {
            await db.sequelize.query(
                `
                INSERT INTO ${db.schema}.log_economy
                    (discord_id, reason, money_delta, money_after, exp_delta, exp_after,
                     level_after, crystal_after, ref)
                VALUES
                    (:discord_id, 'provision', :money, :money, 0, 0, :level, 0, 'starting balance')
                `,
                {
                    replacements: {
                        discord_id: String(user.id),
                        money: state.money,
                        level: state.level,
                    },
                    transaction,
                },
            );
        } else {
            const existing = await db.sequelize.query(
                `SELECT * FROM ${db.schema}.mst_player_state WHERE discord_id = :discord_id`,
                {
                    replacements: { discord_id: String(user.id) },
                    type: QueryTypes.SELECT,
                    transaction,
                },
            );
            state = existing[0] ?? null;
        }

        return {
            row,
            state,
            // `xmax = 0` is the Postgres trick for "this row came from the INSERT
            // branch", so the caller learns created-vs-updated without a second query.
            created: row?.was_inserted === true,
            stateCreated,
        };
    };

    return options.transaction
        ? run(options.transaction)
        : db.sequelize.transaction(run);
}

export async function getPlayer(db, discordId) {
    return db.mst_player.findByPk(String(discordId));
}

export async function countPlayers(db) {
    return db.mst_player.count();
}

/** Identity and state together — what a profile command needs. */
export async function getPlayerWithState(db, discordId) {
    const rows = await db.sequelize.query(
        `SELECT p.discord_id, p.username, p.global_name, p.is_bot, p.first_seen_at,
                s.money, s.exp, s.level, s.magical_crystal,
                s.fishing_rod, s.inventory_size, s.fishing_count
           FROM ${db.schema}.mst_player p
           LEFT JOIN ${db.schema}.mst_player_state s ON s.discord_id = p.discord_id
          WHERE p.discord_id = :id`,
        { replacements: { id: String(discordId) }, type: QueryTypes.SELECT },
    );
    return rows[0] ?? null;
}

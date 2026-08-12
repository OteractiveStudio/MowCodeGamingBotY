/**
 * app/data/player.js — everything that reads or writes a player row.
 *
 * ⭐ THE SEAM. The legacy drew this correctly: cogs never opened a file, they
 * called `b.money_add()` on one data layer. That is the only reason this port is
 * tractable — the game logic does not know what the store is. Kept exactly, with
 * one change: it is a directory of modules per concern instead of one 387-line
 * `basic` class that owned players, fish, guilds, formatting and the clock.
 *
 * 🔑 AND THIS IS THE ACTUAL PRIZE OF THE REWRITE. The legacy
 * `add_player`/`update_player` were read-whole-file → mutate → write-whole-file,
 * with no lock, and `money_add` called `exp_add` which did it again. One
 * `+fishing auto` was ~120+ sequential rewrites of players_inv.json while other
 * players' commands interleaved, so overlapping writes silently lost.
 *
 * Here it is ONE statement that the database serializes for us.
 */

/**
 * Provision-or-refresh a player from a Discord user, in a single atomic
 * INSERT ... ON CONFLICT DO UPDATE ... RETURNING.
 *
 * `first_seen_at` is deliberately absent from the UPDATE set: it is written once,
 * by the INSERT, and never touched again. That is the whole reason this is one
 * statement and not a read-then-write.
 *
 * @returns {Promise<{row: object, created: boolean}>}
 */
export async function ensurePlayer(db, user) {
    const [rows] = await db.sequelize.query(
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
                discord_id: user.id,
                username: user.username ?? null,
                global_name: user.globalName ?? user.global_name ?? null,
                is_bot: !!user.bot,
            },
        },
    );

    const row = rows[0];
    // `xmax = 0` is the Postgres trick for "this row came from the INSERT branch",
    // so the caller learns created-vs-updated without a second query.
    return { row, created: row?.was_inserted === true };
}

export async function getPlayer(db, discordId) {
    return db.mst_player.findByPk(String(discordId));
}

export async function countPlayers(db) {
    return db.mst_player.count();
}

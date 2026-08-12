/**
 * app/data/guild.js — everything that reads or writes a guild's settings row.
 *
 * From the legacy `settings.json.server_list` + `add_server`/`update_server`/
 * `get_server_prefix`.
 *
 * ⚠️ Two legacy defects this shape exists to avoid:
 *
 *  - `get_prefix` looped EVERY guild on EVERY message and called `add_server()`,
 *    which rewrote settings.json whenever anything had changed. A read path must
 *    not write. `getGuild()` here is read-only, and provisioning happens on the
 *    guild-join event — once — not on every message.
 *  - `get_server_prefix` was defined TWICE in the same class with different
 *    behaviour (one raised on an unknown guild, the other returned None) and the
 *    second silently won. There is one of each function here.
 */

/** Provision-or-refresh a guild row. One atomic statement; see app/data/player.js. */
export async function ensureGuild(db, guild, defaults = {}) {
    const [rows] = await db.sequelize.query(
        `
        INSERT INTO ${db.schema}.mst_guild
            (guild_id, name, prefix, lang, joined_at, left_at, created_at, updated_at)
        VALUES
            (:guild_id, :name, :prefix, :lang, now(), NULL, now(), now())
        ON CONFLICT (guild_id) DO UPDATE SET
            name       = EXCLUDED.name,
            left_at    = NULL,
            updated_at = now()
        RETURNING *, (xmax = 0) AS was_inserted
        `,
        {
            replacements: {
                guild_id: guild.id,
                name: guild.name ?? null,
                prefix: defaults.prefix ?? "+",
                lang: defaults.lang ?? "en",
            },
        },
    );

    const row = rows[0];
    // Note `left_at = NULL` on conflict: re-inviting the bot revives the row it
    // already had, so a guild's prefix, language and roles survive a kick.
    return { row, created: row?.was_inserted === true };
}

/** Mark the bot as gone. Never DELETE — the settings are worth keeping. */
export async function markGuildLeft(db, guildId) {
    const [, meta] = await db.sequelize.query(
        `
        UPDATE ${db.schema}.mst_guild
           SET left_at = now(), updated_at = now()
         WHERE guild_id = :guild_id AND left_at IS NULL
        `,
        { replacements: { guild_id: String(guildId) } },
    );
    return meta?.rowCount ?? 0;
}

/** Read-only. Returns null for an unknown guild — one behaviour, not two. */
export async function getGuild(db, guildId) {
    return db.mst_guild.findByPk(String(guildId));
}

export async function countActiveGuilds(db) {
    return db.mst_guild.count({ where: { left_at: null } });
}

/**
 * Write one or more settings. Only the keys present in `changes` are touched.
 *
 * ⚠️ `COALESCE(:key, column)` rather than building the SET clause from the caller's keys. String
 * concatenation into SQL is how the legacy's data editor worked (`data[target][set] = set_to`
 * straight from user input) and it is not a habit worth carrying into a language where the
 * placeholder version is this short.
 *
 * Returns the updated row, or null if the guild has no row yet — the caller provisions first.
 */
export async function setGuildSettings(db, guildId, changes = {}) {
    const rows = await db.sequelize.query(
        `
        UPDATE ${db.schema}.mst_guild
           SET lang       = COALESCE(:lang, lang),
               prefix     = COALESCE(:prefix, prefix),
               updated_at = now()
         WHERE guild_id = :guild_id
        RETURNING *
        `,
        {
            replacements: {
                guild_id: String(guildId),
                lang: changes.lang ?? null,
                prefix: changes.prefix ?? null,
            },
            type: db.sequelize.constructor.QueryTypes.SELECT,
        },
    );
    return rows[0] ?? null;
}

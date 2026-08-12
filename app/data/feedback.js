/**
 * app/data/feedback.js — recording what players think of the remake.
 *
 * ⭐ Ote, 2026-08-13: *"add abother feature there \feedback msg:[strings] — record feedbacks to a
 * pg table, so user adn feedback our new system"*. The bot is a rebuild that real people are
 * playing, and every game in it has at least one number that was a judgement call. This is the
 * cheapest way to find out which of those calls were wrong.
 *
 * ⚠️ The table has **no foreign key to `mst_player`** so feedback survives a player reset. That
 * reasoning belongs to the schema and lives in `database/migrations/006_feedback.sql`.
 *
 * Validation is PURE and tested without a database; the two functions that touch Postgres are
 * thin on purpose.
 */

import { QueryTypes } from "sequelize";

export const FEEDBACK_RULES = {
    /** Matches the CHECK in SQL. Declared in both places so a user is told, not just rejected. */
    MIN_LENGTH: 3,
    MAX_LENGTH: 1000,
    /** ⚠️ A rate limit, because a text box in a public bot is an invitation. */
    MAX_PER_WINDOW: 5,
    WINDOW_MS: 60 * 60 * 1000,
};

export const FEEDBACK_STATUS = {
    NEW: "new",
    READ: "read",
    ACTIONED: "actioned",
    DECLINED: "declined",
};

/**
 * Tidy what someone typed.
 *
 * ⚠️ Collapses runs of blank lines rather than storing them. A message that is mostly newlines
 * would otherwise pass the length CHECK on `btrim` while rendering as an embed full of nothing —
 * and embeds have their own limits, so "valid in SQL" is not the same as "displayable".
 */
export function normaliseMessage(raw) {
    if (typeof raw !== "string") return "";
    return raw
        .replace(/\r\n?/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]+$/gm, "")
        .trim();
}

/** Why a message cannot be stored. Returns null when it can. */
export function validateMessage(raw) {
    const message = normaliseMessage(raw);

    if (message.length === 0) {
        return { code: "EMPTY", message: "there was nothing in that" };
    }
    if (message.length < FEEDBACK_RULES.MIN_LENGTH) {
        return {
            code: "TOO_SHORT",
            message: `say a little more — at least ${FEEDBACK_RULES.MIN_LENGTH} characters`,
        };
    }
    if (message.length > FEEDBACK_RULES.MAX_LENGTH) {
        return {
            code: "TOO_LONG",
            message:
                `that is ${message.length} characters and the limit is ${FEEDBACK_RULES.MAX_LENGTH} — ` +
                "send the rest as a second one",
        };
    }
    return null;
}

/** How many this person has sent inside the window. Drives the rate limit. */
export async function countRecent(db, discordId) {
    const [row] = await db.sequelize.query(
        `SELECT count(*)::int AS n
           FROM ${db.schema}.log_feedback
          WHERE discord_id = :id
            AND created_at > now() - (:seconds * interval '1 second')`,
        {
            replacements: { id: String(discordId), seconds: FEEDBACK_RULES.WINDOW_MS / 1000 },
            type: QueryTypes.SELECT,
        },
    );
    return row.n;
}

/**
 * Store one piece of feedback and return the stored row.
 *
 * ⚠️ RETURNING, not a second SELECT. The caller needs the `rolling_id` to quote back at the user
 * so they have something to refer to, and re-reading it would be a second round trip that could
 * disagree with what was written.
 */
export async function submitFeedback(db, { discordId, username, guildId, channelId, message }) {
    const problem = validateMessage(message);
    if (problem) throw new Error(`refusing to store invalid feedback: ${problem.code}`);

    const rows = await db.sequelize.query(
        `INSERT INTO ${db.schema}.log_feedback
            (discord_id, username_at_time, guild_id, channel_id, message, status, created_at, updated_at)
         VALUES (:id, :username, :guild, :channel, :message, 'new', now(), now())
      RETURNING rolling_id, uuid, created_at, status`,
        {
            replacements: {
                id: String(discordId),
                username: username ?? null,
                guild: guildId ? String(guildId) : null,
                channel: channelId ? String(channelId) : null,
                message: normaliseMessage(message),
            },
            type: QueryTypes.SELECT,
        },
    );

    return rows[0];
}

/** Newest first, optionally of one status. For `/admin feedback`. */
export async function listFeedback(db, { status = null, limit = 10 } = {}) {
    return db.sequelize.query(
        `SELECT rolling_id, discord_id, username_at_time, guild_id, message, status,
                handled_by, handled_at, created_at
           FROM ${db.schema}.log_feedback
          WHERE (:status IS NULL OR status = :status)
          ORDER BY rolling_id DESC
          LIMIT :limit`,
        { replacements: { status, limit }, type: QueryTypes.SELECT },
    );
}

/** Counts per status, so the admin view can say what is waiting without a second command. */
export async function feedbackTally(db) {
    const rows = await db.sequelize.query(
        `SELECT status, count(*)::int AS n FROM ${db.schema}.log_feedback GROUP BY status`,
        { type: QueryTypes.SELECT },
    );
    const tally = { new: 0, read: 0, actioned: 0, declined: 0, total: 0 };
    for (const row of rows) {
        tally[row.status] = row.n;
        tally.total += row.n;
    }
    return tally;
}

/**
 * Move every `new` row to `read`, stamped with who did it.
 *
 * ⚠️ Idempotent and scoped to `new` by the WHERE clause, so a double-click cannot overwrite the
 * `handled_by` of something already dealt with. The SQL CHECK requires `handled_by` and
 * `handled_at` to be set together, which is why they are written in one statement.
 */
export async function markAllRead(db, adminId) {
    const rows = await db.sequelize.query(
        `UPDATE ${db.schema}.log_feedback
            SET status = 'read', handled_by = :admin, handled_at = now(), updated_at = now()
          WHERE status = 'new'
      RETURNING rolling_id`,
        { replacements: { admin: String(adminId) }, type: QueryTypes.SELECT },
    );
    return rows.length;
}

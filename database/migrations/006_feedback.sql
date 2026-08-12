-- 006_feedback.sql — where /feedback goes.
--
-- ⭐ Ote, 2026-08-13: *"add abother feature there \feedback msg:[strings] — record feedbacks to a
-- pg table, so user adn feedback our new system"*. The bot is a remake that real players are now
-- using, so the fastest way to find out what is wrong with it is to let them say so in the place
-- they already are.
--
-- ⚠️ **THERE IS DELIBERATELY NO FOREIGN KEY TO mst_player**, and that is the one design decision
-- in this file worth arguing about. Every other player-owned table declares
-- `REFERENCES mst_player (discord_id) ON DELETE CASCADE`, which is right for balances and
-- inventories: when a player is gone, so is their stuff.
--
-- Feedback is not their stuff. It is a message TO US. Two days ago every player row in this
-- schema was deliberately deleted (`DevTools/maintenance/reset-players.mjs`), and if this table
-- had existed with a cascading key, **every piece of feedback would have gone with it** — the
-- one kind of row whose whole value is that it outlives the state it was complaining about.
--
-- So the author is stored as a plain id, plus a SNAPSHOT of their username at the time, so a row
-- is readable on its own without joining to a player who may no longer exist. The cost is that an
-- id here can be orphaned; that is the intended trade, not an oversight.

CREATE TABLE IF NOT EXISTS {{schema}}.log_feedback (
    uuid                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rolling_id          BIGSERIAL NOT NULL UNIQUE,

    -- ⚠️ No FK — see the header. Shape is still enforced, so a garbage id cannot land.
    discord_id          TEXT NOT NULL,
    username_at_time    TEXT,

    guild_id            TEXT,
    channel_id          TEXT,

    message             TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'new',
    handled_by          TEXT,
    handled_at          TIMESTAMPTZ,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT log_feedback_author_is_snowflake
        CHECK (discord_id ~ '^[0-9]{1,32}$'),

    -- Long enough to be a real report, short enough to fit an embed field without truncation
    -- games. The command declares the same bounds so a user is told, not silently rejected.
    CONSTRAINT log_feedback_message_length
        CHECK (char_length(btrim(message)) BETWEEN 3 AND 1000),

    CONSTRAINT log_feedback_status_known
        CHECK (status IN ('new', 'read', 'actioned', 'declined')),

    -- A handled row must say who handled it and when; an unhandled one must claim neither.
    CONSTRAINT log_feedback_handled_consistently
        CHECK (
            (status = 'new'  AND handled_by IS NULL     AND handled_at IS NULL)
            OR
            (status <> 'new' AND handled_by IS NOT NULL AND handled_at IS NOT NULL)
        )
);

COMMENT ON TABLE  {{schema}}.log_feedback IS 'Append-only player feedback. Deliberately has NO foreign key to mst_player so it survives a player reset — see 006_feedback.sql.';
COMMENT ON COLUMN {{schema}}.log_feedback.username_at_time IS 'Snapshot, so a row reads on its own even after the player row is gone.';
COMMENT ON COLUMN {{schema}}.log_feedback.status IS 'new -> read | actioned | declined. Only /admin feedback moves it.';
COMMENT ON COLUMN {{schema}}.log_feedback.handled_by IS 'Which bot admin changed the status. Paired with handled_at by a CHECK.';

-- Reading it is always "the newest, optionally of one status", so index exactly that.
CREATE INDEX IF NOT EXISTS log_feedback_status_idx
    ON {{schema}}.log_feedback (status, rolling_id DESC);

-- And the per-user rate check is "how many did THIS person send recently".
CREATE INDEX IF NOT EXISTS log_feedback_author_idx
    ON {{schema}}.log_feedback (discord_id, created_at DESC);

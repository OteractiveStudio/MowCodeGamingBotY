-- 001_core.sql — MowCodeGamingBoteY core schema
--
-- THIS FILE IS THE SOURCE OF TRUTH. Sequelize models mirror it, and sync runs
-- with { alter: false } so it can never quietly reshape a table (STANDARDS §4).
-- The guarantees below are exactly the ones sync cannot express: CHECK
-- constraints, NOT NULL on the columns that matter, and partial indexes.
--
-- ⚠️ `{{schema}}` is a placeholder, substituted by database/scripts/migrate.js
-- from config.json (`database.connection.schemas.project`). The schema name is
-- NOT hardcoded here on purpose — 56 scripts with their own copy of a stale
-- database name once all connected happily to the wrong data.
--
--   Apply with:  npm run db:migrate
--
-- The runner connects AS THE APP ROLE, so the app owns every object it creates.
-- Applying as a superuser would leave the tables unwritable by the app.

CREATE SCHEMA IF NOT EXISTS {{schema}};

-- ─────────────────────────────────────────────────────────────────────────────
-- log_message — the process's own log, append-only.
--
-- The descendant of the legacy `debug_msg/YYYYMMDD_HHMMSS.txt` run files: one
-- row per emitted message, tagged with the run that produced it, so a run can
-- still be read back as a unit after the file has rotated away.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS {{schema}}.log_message (
    uuid                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rolling_id          BIGSERIAL NOT NULL UNIQUE,
    process_start_on    TIMESTAMPTZ NOT NULL,
    report_on           TIMESTAMPTZ NOT NULL,
    report_by           TEXT NOT NULL,
    level               TEXT NOT NULL DEFAULT 'info',
    message             TEXT NOT NULL,

    -- sync() cannot express this. An unconstrained level column is how a typo
    -- becomes a log level nobody ever filters on.
    CONSTRAINT log_message_level_check
        CHECK (level IN ('debug', 'info', 'warning', 'error'))
);

COMMENT ON TABLE  {{schema}}.log_message IS 'Append-only process log. One row per emitted log message, grouped by process_start_on.';
COMMENT ON COLUMN {{schema}}.log_message.process_start_on IS 'When the process that emitted this line started — groups a whole run.';
COMMENT ON COLUMN {{schema}}.log_message.report_by IS 'Project-relative path of the module that logged it.';

CREATE INDEX IF NOT EXISTS log_message_report_on_idx
    ON {{schema}}.log_message (report_on DESC);
CREATE INDEX IF NOT EXISTS log_message_process_start_on_idx
    ON {{schema}}.log_message (process_start_on DESC);

-- Partial index: the rows anyone actually goes looking for. sync() cannot
-- express a WHERE clause on an index.
CREATE INDEX IF NOT EXISTS log_message_problems_idx
    ON {{schema}}.log_message (report_on DESC)
    WHERE level IN ('warning', 'error');

-- ─────────────────────────────────────────────────────────────────────────────
-- mst_guild — one row per Discord server, with its settings.
--
-- From the legacy `settings.json.server_list`. ⚠️ That file mixed CONFIG with
-- LIVE STATE; here they are separated for good: the `default_*` keys are in
-- config.json, and the per-guild live rows are these. They do not share a home
-- again.
--
-- A guild that removes the bot is marked with `left_at`, never deleted — so its
-- prefix, language and role settings survive a re-invite.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS {{schema}}.mst_guild (
    guild_id            TEXT PRIMARY KEY,
    name                TEXT,
    prefix              TEXT NOT NULL DEFAULT '+',
    lang                TEXT NOT NULL DEFAULT 'en',
    music_channel_id    TEXT,
    manager_role_id     TEXT,
    joined_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    left_at             TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Discord snowflakes are digit strings. Stored as TEXT because a JS number
    -- silently loses precision above 2^53 and discord.js hands them over as
    -- strings anyway.
    CONSTRAINT mst_guild_id_is_snowflake
        CHECK (guild_id ~ '^[0-9]{1,32}$'),
    CONSTRAINT mst_guild_music_channel_is_snowflake
        CHECK (music_channel_id IS NULL OR music_channel_id ~ '^[0-9]{1,32}$'),
    CONSTRAINT mst_guild_manager_role_is_snowflake
        CHECK (manager_role_id IS NULL OR manager_role_id ~ '^[0-9]{1,32}$')
);

COMMENT ON TABLE  {{schema}}.mst_guild IS 'Per-guild live settings. Config defaults live in config.json, never here.';
COMMENT ON COLUMN {{schema}}.mst_guild.prefix IS 'Stored for the legacy prefix surface. NOT USED YET — the command surface (slash vs prefix) is undecided.';
COMMENT ON COLUMN {{schema}}.mst_guild.left_at IS 'Set on guild remove instead of deleting the row, so settings survive a re-invite.';

-- The guilds the bot is actually in — the read every command path does.
CREATE INDEX IF NOT EXISTS mst_guild_active_idx
    ON {{schema}}.mst_guild (guild_id)
    WHERE left_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- mst_player — one row per Discord user the bot knows.
--
-- Keyed by the Discord user id, exactly as the legacy `players_inv.json` was,
-- which is what keeps importing the 24 legacy players a later data job with no
-- schema change.
--
-- ⚠️ Deliberately NO `is_admin` column. The legacy read admin identity from
-- player rows that `reset_player` could wipe. Admin identity is config
-- (config.json is a security boundary), not user-editable data.
--
-- ⚠️ NO `discriminator` column: Discord retired discriminators in 2023. The
-- legacy `info.discriminator` field has no modern equivalent — `username` is now
-- unique and `global_name` is the display name.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS {{schema}}.mst_player (
    discord_id          TEXT PRIMARY KEY,
    username            TEXT,
    global_name         TEXT,
    is_bot              BOOLEAN NOT NULL DEFAULT false,
    first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT mst_player_id_is_snowflake
        CHECK (discord_id ~ '^[0-9]{1,32}$')
);

COMMENT ON TABLE  {{schema}}.mst_player IS 'Player identity, keyed by Discord user id. Economy/progression state is a separate table, not yet built.';
COMMENT ON COLUMN {{schema}}.mst_player.is_bot IS 'Bots get rows so they can be excluded from games explicitly rather than by accident.';

CREATE INDEX IF NOT EXISTS mst_player_last_seen_at_idx
    ON {{schema}}.mst_player (last_seen_at DESC);

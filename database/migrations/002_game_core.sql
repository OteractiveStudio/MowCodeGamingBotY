-- 002_game_core.sql — the game's data model
--
-- ⭐ THIS IS THE REDESIGN. The legacy stored all of this as JSON documents that were
-- read whole, mutated in memory, and written whole, with no lock:
--
--     players_inv.json = { "<discord_id>": { info{...}, inventory{money, fishing_rod,
--                          inventory_size, item{}}, stats{exp, level, magical_crystal,
--                          fishing} } }
--
-- Every field of that document becomes a column or a row here, with the invariants
-- the JSON could not state and the concurrency it could not survive.
--
-- ⚠️ `{{schema}}` is substituted by database/scripts/migrate.js from config.json.
-- Apply with: npm run db:migrate

-- ─────────────────────────────────────────────────────────────────────────────
-- mst_player_state — the legacy `inventory` + `stats` blocks, minus the item dict.
--
-- Split from mst_player deliberately: identity changes when Discord says so, game
-- state changes when the player plays. Only this table is locked by a mutation.
--
-- Defaults come from the legacy `settings.json.default_inventory` and `add_player`:
-- money 200 · fishing_rod 10 · inventory_size 1 · exp 0 · level 1 · crystals 0.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS {{schema}}.mst_player_state (
    discord_id          TEXT PRIMARY KEY
                        REFERENCES {{schema}}.mst_player (discord_id) ON DELETE CASCADE,
    money               BIGINT NOT NULL DEFAULT 200,
    exp                 INTEGER NOT NULL DEFAULT 0,
    level               INTEGER NOT NULL DEFAULT 1,
    magical_crystal     INTEGER NOT NULL DEFAULT 0,
    fishing_rod         INTEGER NOT NULL DEFAULT 10,
    inventory_size      INTEGER NOT NULL DEFAULT 1,
    fishing_count       INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- ⚠️ money has NO non-negative constraint, on purpose. A negative balance is a
    -- real game state in the legacy: `is_bad_econ` is true below -20. Constraining
    -- money >= 0 would delete a feature.
    CONSTRAINT mst_player_state_exp_not_negative
        CHECK (exp >= 0),

    -- The level cascade's invariant, which sync() cannot express: reaching 100
    -- converts to a magical crystal and subtracts 100, so a settled level is 0-99.
    -- (It can be 0: a player at exactly level 100 lands on 0 after the conversion.)
    CONSTRAINT mst_player_state_level_in_range
        CHECK (level >= 0 AND level < 100),

    CONSTRAINT mst_player_state_crystal_not_negative
        CHECK (magical_crystal >= 0),
    CONSTRAINT mst_player_state_rods_not_negative
        CHECK (fishing_rod >= 0),
    CONSTRAINT mst_player_state_inventory_size_not_negative
        CHECK (inventory_size >= 0),
    CONSTRAINT mst_player_state_fishing_count_not_negative
        CHECK (fishing_count >= 0)
);

COMMENT ON TABLE  {{schema}}.mst_player_state IS 'Mutable game state per player. The legacy inventory+stats blocks of players_inv.json.';
COMMENT ON COLUMN {{schema}}.mst_player_state.money IS 'May be NEGATIVE — below -20 the legacy treats the player as "bad econ".';
COMMENT ON COLUMN {{schema}}.mst_player_state.exp IS 'Resets on level-up. Cap is level*10 + magical_crystal*2.';
COMMENT ON COLUMN {{schema}}.mst_player_state.level IS '0-99. Hitting 100 converts to one magical crystal and subtracts 100.';
COMMENT ON COLUMN {{schema}}.mst_player_state.fishing_count IS 'Lifetime catches — the legacy stats.fishing counter.';

CREATE INDEX IF NOT EXISTS mst_player_state_money_idx
    ON {{schema}}.mst_player_state (money DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- mst_item — the item catalogue.
--
-- The legacy had no such table: an item existed if it appeared inside some
-- category's item_list in market.json, and a player's items were a bare
-- {name: count} dict with nothing to validate the name against. A typo created a
-- new item silently.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS {{schema}}.mst_item (
    item_key            TEXT PRIMARY KEY,
    display_name        TEXT NOT NULL,
    emoji               TEXT,
    detail              TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT mst_item_key_shape
        CHECK (item_key ~ '^[a-z0-9_]{1,64}$')
);

COMMENT ON TABLE {{schema}}.mst_item IS 'What an item IS. Prices live in mst_market_listing, because the same item is sold in more than one category.';

-- ─────────────────────────────────────────────────────────────────────────────
-- mst_player_item — ⭐ A ROW PER ITEM, not a dict.
--
-- The legacy `inventory.item` was `{"dog": 1}` inside the player document, so
-- adding one item rewrote every player's entire record.
--
-- ⚠️ quantity > 0 is enforced: "owns none" is the ABSENCE of a row, never a row
-- holding zero. One representation of empty, so no query has to remember both.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS {{schema}}.mst_player_item (
    discord_id          TEXT NOT NULL
                        REFERENCES {{schema}}.mst_player (discord_id) ON DELETE CASCADE,
    item_key            TEXT NOT NULL
                        REFERENCES {{schema}}.mst_item (item_key) ON DELETE RESTRICT,
    quantity            INTEGER NOT NULL,
    acquired_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (discord_id, item_key),

    CONSTRAINT mst_player_item_quantity_positive
        CHECK (quantity > 0)
);

COMMENT ON TABLE {{schema}}.mst_player_item IS 'One row per item a player holds. A zero quantity is deleted, never stored.';

CREATE INDEX IF NOT EXISTS mst_player_item_item_key_idx
    ON {{schema}}.mst_player_item (item_key);

-- ─────────────────────────────────────────────────────────────────────────────
-- mst_market_category + mst_market_listing
--
-- ⚠️ WHY TWO TABLES: in the legacy market.json, `fishingrod` appears in BOTH
-- "Quick_menu" AND "Tool", at the same price, duplicated. A category column on the
-- item cannot express that, and duplicating the item row would mean two rows to
-- keep in step. So the item is defined once and LISTED many times.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS {{schema}}.mst_market_category (
    category_key        TEXT PRIMARY KEY,
    display_name        TEXT NOT NULL,
    emoji               TEXT,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT mst_market_category_key_shape
        CHECK (category_key ~ '^[a-z0-9_]{1,64}$')
);

CREATE TABLE IF NOT EXISTS {{schema}}.mst_market_listing (
    category_key        TEXT NOT NULL
                        REFERENCES {{schema}}.mst_market_category (category_key) ON DELETE CASCADE,
    item_key            TEXT NOT NULL
                        REFERENCES {{schema}}.mst_item (item_key) ON DELETE CASCADE,
    price               BIGINT NOT NULL,
    is_available        BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (category_key, item_key),

    CONSTRAINT mst_market_listing_price_not_negative
        CHECK (price >= 0)
);

COMMENT ON TABLE {{schema}}.mst_market_listing IS 'What is for sale where, and for how much. fishingrod is listed in two categories, as in the legacy.';

CREATE INDEX IF NOT EXISTS mst_market_listing_available_idx
    ON {{schema}}.mst_market_listing (category_key, item_key)
    WHERE is_available;

-- ─────────────────────────────────────────────────────────────────────────────
-- mst_fish — the catch table.
--
-- 🔑 THE TIER CONSTRAINT IS LOAD-BEARING. The legacy draw builds a weighted pool:
--
--     for i in fish_data: fish_list += [i] * (10 - fish_data[i]['tier'])
--
-- so a fish's weight is `10 - tier`. A tier-10 fish would weigh 0 and be
-- undrawable; a tier-11 fish would contribute a NEGATIVE count and corrupt the
-- pool. Tier 0-9 is therefore not a style preference, it is the range in which the
-- game's own draw is defined. The legacy could not say so; this can.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS {{schema}}.mst_fish (
    fish_key            TEXT PRIMARY KEY,
    display_name        TEXT NOT NULL,
    file_name           TEXT,
    fish_type           TEXT NOT NULL DEFAULT 'creature',
    price               BIGINT NOT NULL,
    tier                INTEGER NOT NULL,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT mst_fish_tier_is_drawable
        CHECK (tier >= 0 AND tier <= 9),
    CONSTRAINT mst_fish_price_not_negative
        CHECK (price >= 0),
    CONSTRAINT mst_fish_type_known
        CHECK (fish_type IN ('creature', 'not_creature'))
);

COMMENT ON TABLE  {{schema}}.mst_fish IS 'Catchable things. Draw weight is 10 - tier, so a LOWER tier is MORE common.';
COMMENT ON COLUMN {{schema}}.mst_fish.tier IS '0-9. Weight = 10 - tier. Nothing/Trash are the low tiers, so they are the likeliest draws.';
COMMENT ON COLUMN {{schema}}.mst_fish.fish_type IS 'not_creature covers Nothing and Trash — a catch that is not an animal.';

-- ─────────────────────────────────────────────────────────────────────────────
-- txn_purchase — what happened at the market.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS {{schema}}.txn_purchase (
    uuid                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rolling_id          BIGSERIAL NOT NULL UNIQUE,
    discord_id          TEXT NOT NULL
                        REFERENCES {{schema}}.mst_player (discord_id) ON DELETE CASCADE,
    item_key            TEXT NOT NULL
                        REFERENCES {{schema}}.mst_item (item_key) ON DELETE RESTRICT,
    category_key        TEXT
                        REFERENCES {{schema}}.mst_market_category (category_key) ON DELETE SET NULL,
    quantity            INTEGER NOT NULL,
    unit_price          BIGINT NOT NULL,
    total_price         BIGINT NOT NULL,
    guild_id            TEXT,
    purchased_on        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT txn_purchase_quantity_positive
        CHECK (quantity > 0),
    CONSTRAINT txn_purchase_prices_not_negative
        CHECK (unit_price >= 0 AND total_price >= 0),
    -- The total has to be the product. A stored total that disagrees with its own
    -- parts is worse than not storing it.
    CONSTRAINT txn_purchase_total_is_consistent
        CHECK (total_price = unit_price * quantity)
);

CREATE INDEX IF NOT EXISTS txn_purchase_player_idx
    ON {{schema}}.txn_purchase (discord_id, purchased_on DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- log_economy — ⭐ append-only, so a balance can be EXPLAINED, not just read.
--
-- The legacy could tell you a player had 925 coins. It could not tell you why, or
-- when, or whether a write had been lost. Every mutation that touches money or exp
-- writes exactly one row here, inside the same transaction as the mutation — so
-- the log cannot disagree with the balance.
--
-- `money_after` makes the chain auditable: ordered by rolling_id, each row's
-- money_after must equal the previous one plus this row's money_delta.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS {{schema}}.log_economy (
    uuid                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rolling_id          BIGSERIAL NOT NULL UNIQUE,
    discord_id          TEXT NOT NULL
                        REFERENCES {{schema}}.mst_player (discord_id) ON DELETE CASCADE,
    occurred_on         TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason              TEXT NOT NULL,
    money_delta         BIGINT NOT NULL,
    money_after         BIGINT NOT NULL,
    exp_delta           INTEGER NOT NULL DEFAULT 0,
    exp_after           INTEGER NOT NULL DEFAULT 0,
    level_after         INTEGER NOT NULL DEFAULT 0,
    crystal_after       INTEGER NOT NULL DEFAULT 0,
    levels_gained       INTEGER NOT NULL DEFAULT 0,
    crystals_gained     INTEGER NOT NULL DEFAULT 0,
    ref                 TEXT,
    guild_id            TEXT,
    actor_id            TEXT,

    CONSTRAINT log_economy_reason_known
        CHECK (reason IN (
            'provision',
            'fishing_catch',
            'market_purchase',
            'transfer_in',
            'transfer_out',
            'admin_adjust',
            'game_win',
            'game_loss',
            'steal_gain',
            'steal_loss',
            'correction'
        ))
);

COMMENT ON TABLE  {{schema}}.log_economy IS 'Append-only. One row per money/exp mutation, written in the same transaction as the mutation.';
COMMENT ON COLUMN {{schema}}.log_economy.money_after IS 'The balance immediately after this row. Ordered by rolling_id the deltas must chain.';
COMMENT ON COLUMN {{schema}}.log_economy.ref IS 'What it was about — a fish key, an item key, or the other player in a transfer.';
COMMENT ON COLUMN {{schema}}.log_economy.actor_id IS 'Who caused it, when that is not the player themselves (an admin, or the sender of a gift).';

CREATE INDEX IF NOT EXISTS log_economy_player_idx
    ON {{schema}}.log_economy (discord_id, rolling_id DESC);
CREATE INDEX IF NOT EXISTS log_economy_occurred_on_idx
    ON {{schema}}.log_economy (occurred_on DESC);
CREATE INDEX IF NOT EXISTS log_economy_reason_idx
    ON {{schema}}.log_economy (reason, occurred_on DESC);

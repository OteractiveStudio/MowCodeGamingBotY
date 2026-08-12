-- 003_timestamps_everywhere.sql — created_at / updated_at on every table.
--
-- Ote, 2026-08-13: *"all db model timestamps: true please."*
--
-- Four tables were declared with `timestamps: false` because they carry a domain timestamp of
-- their own instead: `log_message.report_on`, `log_economy.occurred_on`,
-- `txn_purchase.purchased_on`, and `mst_player_item.acquired_at`. This adds the standard pair
-- to all of them so **every model can be `timestamps: true`** and Sequelize behaves the same
-- way across the whole schema.
--
-- ⚠️ The domain timestamps STAY, and they are not duplicates:
--   · `occurred_on` / `purchased_on` / `report_on` are when the THING happened
--   · `created_at` is when the ROW was written
-- Those differ the moment anything is backfilled — the legacy player import writes rows now
-- for balances that were earned years ago. Collapsing them would throw that away.
--
-- ⚠️ `updated_at` on an append-only log is admittedly redundant: nothing updates a log row.
-- It is here for uniformity, which is the point of the request — one shape everywhere beats
-- four tables that each need remembering.
--
-- Apply with: npm run db:migrate

ALTER TABLE {{schema}}.log_message
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE {{schema}}.log_economy
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE {{schema}}.txn_purchase
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- This one already had `updated_at`; only `created_at` was missing, which is why its model
-- carried a `createdAt: false` exception.
ALTER TABLE {{schema}}.mst_player_item
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

COMMENT ON COLUMN {{schema}}.log_message.created_at IS 'When the ROW was written. report_on is when the line was logged.';
COMMENT ON COLUMN {{schema}}.log_economy.created_at IS 'When the ROW was written. occurred_on is when the money moved — they differ for imported history.';
COMMENT ON COLUMN {{schema}}.txn_purchase.created_at IS 'When the ROW was written. purchased_on is when the purchase happened.';
COMMENT ON COLUMN {{schema}}.mst_player_item.created_at IS 'When the ROW was written. acquired_at is when the player first got the item.';

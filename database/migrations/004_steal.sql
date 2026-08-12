-- 004_steal.sql — one column, so a steal cooldown survives a restart.
--
-- The legacy `steal` had no cooldown at all, which made it pure grief-spam: nothing stopped you
-- running it at the same person until it worked. A cooldown held in memory would reset every
-- restart, so it belongs on the row.
--
-- ⚠️ Also worth recording why there is no `is_robber` column: his mechanic kept a module-level
-- `robber` list, where your FIRST steal always failed (costing bail) and only your SECOND
-- succeeded. That list was bot-wide, unpersisted, and meant the first attempt was a guaranteed
-- tax rather than a gamble. Replaced by a real success chance that depends on the tool used, so
-- there is no "am I currently a robber" state to store.
--
-- Apply with: npm run db:migrate

ALTER TABLE {{schema}}.mst_player_state
    ADD COLUMN IF NOT EXISTS last_steal_at TIMESTAMPTZ;

COMMENT ON COLUMN {{schema}}.mst_player_state.last_steal_at IS
    'When this player last ATTEMPTED a steal (success or not) — the cooldown is measured from here.';

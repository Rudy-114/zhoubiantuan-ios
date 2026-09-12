-- A transactional counter holds its row lock until COMMIT. Unlike bigserial,
-- a later committed event can never overtake an uncommitted lower cursor.
CREATE TABLE sync_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  cursor bigint NOT NULL DEFAULT 0,
  pruned_through bigint NOT NULL DEFAULT 0
);
LOCK TABLE sync_events IN ACCESS EXCLUSIVE MODE;
INSERT INTO sync_state(singleton, cursor, pruned_through)
  SELECT true, COALESCE(MAX(id), 0) + 1, COALESCE(MAX(id), 0) + 1 FROM sync_events;
-- Existing cursors reset once because historical bigserial events were unordered.
ALTER TABLE sync_events ALTER COLUMN id DROP DEFAULT;
ALTER TABLE sync_events ALTER COLUMN user_id DROP NOT NULL;
CREATE INDEX idx_sync_events_public_cursor ON sync_events(id) WHERE user_id IS NULL;

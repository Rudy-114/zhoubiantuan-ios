CREATE INDEX IF NOT EXISTS idx_sync_events_created_at
  ON sync_events (created_at);

CREATE INDEX IF NOT EXISTS idx_group_collections_owner_lower_name
  ON group_collections (owner_id, lower(name));

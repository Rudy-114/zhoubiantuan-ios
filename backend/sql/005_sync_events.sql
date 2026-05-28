CREATE TABLE IF NOT EXISTS sync_events (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  thread_id text REFERENCES message_threads(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_events_user_cursor
  ON sync_events (user_id, id);

CREATE INDEX IF NOT EXISTS idx_sync_events_thread
  ON sync_events (thread_id, id);

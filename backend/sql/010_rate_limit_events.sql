CREATE TABLE IF NOT EXISTS rate_limit_events (
  id bigserial PRIMARY KEY,
  scope text NOT NULL,
  key_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_events_lookup
  ON rate_limit_events (scope, key_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rate_limit_events_created_at
  ON rate_limit_events (created_at);

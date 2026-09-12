CREATE TABLE moderation_daily_usage (
  billing_day date PRIMARY KEY,
  reserved_calls integer NOT NULL DEFAULT 0 CHECK (reserved_calls >= 0)
);
CREATE TABLE moderation_call_receipts (
  billing_day date NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('reserved', 'completed', 'uncertain')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (billing_day, request_hash)
);

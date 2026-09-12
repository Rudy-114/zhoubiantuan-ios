ALTER TABLE users ADD COLUMN IF NOT EXISTS moderation_role text NOT NULL DEFAULT 'user'
  CHECK (moderation_role IN ('user', 'moderator', 'admin'));

-- Roles are deliberately not inferred from email addresses. Operators grant
-- them explicitly after the account has proved ownership of its email.
ALTER TABLE rate_limit_events ADD COLUMN IF NOT EXISTS expires_at timestamptz;
UPDATE rate_limit_events SET expires_at = created_at + interval '1 hour' WHERE expires_at IS NULL;
ALTER TABLE rate_limit_events ALTER COLUMN expires_at SET NOT NULL;
ALTER TABLE rate_limit_events ALTER COLUMN expires_at SET DEFAULT (now() + interval '1 hour');
CREATE INDEX IF NOT EXISTS idx_rate_limit_events_expiry ON rate_limit_events(expires_at);

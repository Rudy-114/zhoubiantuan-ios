-- User-to-user blocking for harassment controls (App Store Guideline 1.2).
-- Enforced server-side: blocked users cannot appear in each other's feed,
-- search, comments, follow graph, or direct messages.
CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

-- Reverse lookup: "who has blocked me" / filtering a viewer out of others' lists.
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks (blocked_id);

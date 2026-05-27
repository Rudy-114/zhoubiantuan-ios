ALTER TABLE group_collections
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

CREATE TABLE IF NOT EXISTS moderation_reviews (
  id text PRIMARY KEY,
  target_type text NOT NULL,
  target_id text NOT NULL,
  owner_id text REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'review',
  decision text,
  source text NOT NULL DEFAULT 'systemRule',
  risk_level text NOT NULL DEFAULT 'none',
  reason text NOT NULL DEFAULT '',
  text_snapshot text NOT NULL DEFAULT '',
  image_object_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  handled_by text REFERENCES users(id) ON DELETE SET NULL,
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_moderation_reviews_status ON moderation_reviews (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_reviews_target ON moderation_reviews (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_moderation_reviews_owner ON moderation_reviews (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_collections_status ON group_collections (status, created_at DESC);

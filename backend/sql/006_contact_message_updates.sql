ALTER TABLE group_collections
  ADD COLUMN IF NOT EXISTS contact_group_number text NOT NULL DEFAULT '';

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS group_number text NOT NULL DEFAULT '';

ALTER TABLE direct_messages
  ADD COLUMN IF NOT EXISTS image_object_key text,
  ADD COLUMN IF NOT EXISTS deleted_for_user_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_direct_messages_deleted_for_user_ids
  ON direct_messages USING gin (deleted_for_user_ids);

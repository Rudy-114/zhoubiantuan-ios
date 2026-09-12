CREATE TABLE upload_tickets (
  token_hash text PRIMARY KEY,
  object_key text NOT NULL UNIQUE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('post', 'avatar', 'background', 'message')),
  content_type text NOT NULL,
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'uploading', 'ready', 'failed', 'cleaning')),
  byte_size integer,
  sha256 text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '15 minutes',
  uploaded_at timestamptz,
  referenced_at timestamptz
);
CREATE INDEX idx_upload_tickets_owner ON upload_tickets(user_id, created_at DESC);
CREATE INDEX idx_upload_tickets_cleanup ON upload_tickets(created_at) WHERE referenced_at IS NULL;
CREATE INDEX idx_posts_image_keys ON posts USING gin(image_object_keys);
CREATE INDEX idx_posts_preview_keys ON posts USING gin(preview_image_object_keys);
CREATE INDEX idx_direct_messages_image_key ON direct_messages(image_object_key) WHERE image_object_key IS NOT NULL;

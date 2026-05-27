CREATE TABLE IF NOT EXISTS message_threads (
  id text PRIMARY KEY,
  buyer_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  publisher_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  related_post_id text REFERENCES posts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (buyer_user_id <> publisher_user_id)
);

CREATE TABLE IF NOT EXISTS direct_messages (
  id text PRIMARY KEY,
  thread_id text NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  sender_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL DEFAULT '',
  shared_post_id text REFERENCES posts(id) ON DELETE SET NULL,
  shared_profile_user_id text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS message_thread_reads (
  thread_id text NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_message_threads_participants
  ON message_threads (buyer_user_id, publisher_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_threads_buyer
  ON message_threads (buyer_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_threads_publisher
  ON message_threads (publisher_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_direct_messages_thread
  ON direct_messages (thread_id, created_at ASC);

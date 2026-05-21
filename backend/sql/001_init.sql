CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text UNIQUE,
  password_hash text,
  nickname text NOT NULL,
  bio text NOT NULL DEFAULT '',
  red_book_id text NOT NULL DEFAULT '',
  gender text NOT NULL DEFAULT '未设置',
  birthday text NOT NULL DEFAULT '选择生日',
  region text NOT NULL DEFAULT '未设置',
  avatar_symbol text NOT NULL DEFAULT '新',
  avatar_tint text NOT NULL DEFAULT 'rose',
  avatar_object_key text,
  background_image_name text NOT NULL DEFAULT 'merch_magazine',
  background_object_key text,
  phone_number text NOT NULL DEFAULT '',
  is_restricted boolean NOT NULL DEFAULT false,
  can_show_contact boolean NOT NULL DEFAULT true,
  last_nickname_changed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS group_collections (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  contact_wechat text NOT NULL DEFAULT '',
  contact_qq text NOT NULL DEFAULT '',
  group_info text NOT NULL DEFAULT '',
  deadline timestamptz NOT NULL,
  default_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS posts (
  id text PRIMARY KEY,
  author_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_id text REFERENCES group_collections(id) ON DELETE SET NULL,
  title text NOT NULL,
  image_names text[] NOT NULL DEFAULT ARRAY[]::text[],
  image_object_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  group_type text NOT NULL DEFAULT 'followGroup',
  category_tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  fandom_tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  price text NOT NULL DEFAULT '',
  deposit text NOT NULL DEFAULT '',
  deadline timestamptz NOT NULL,
  condition text NOT NULL DEFAULT '',
  is_formed boolean NOT NULL DEFAULT false,
  description text NOT NULL DEFAULT '',
  wechat text NOT NULL DEFAULT '',
  qq text NOT NULL DEFAULT '',
  group_info text NOT NULL DEFAULT '',
  external_link text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  image_aspect numeric NOT NULL DEFAULT 1.08,
  pinggu_average_price text NOT NULL DEFAULT '',
  pinggu_note text NOT NULL DEFAULT '',
  unsold_roles jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comments (
  id text PRIMARY KEY,
  post_id text NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reply_to_id text REFERENCES comments(id) ON DELETE SET NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS post_likes (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id text NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS post_favorites (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id text NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id text PRIMARY KEY,
  target_type text NOT NULL,
  target_id text NOT NULL,
  reason text NOT NULL DEFAULT '用户举报',
  detail text NOT NULL DEFAULT '',
  reporter_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  admin_result text,
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_posts_feed ON posts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments (post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status, created_at DESC);

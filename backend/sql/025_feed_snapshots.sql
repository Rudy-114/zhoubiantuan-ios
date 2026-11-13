CREATE TABLE feed_snapshots (
  id text PRIMARY KEY,
  viewer_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feed_mode text NOT NULL CHECK (feed_mode IN ('forYou', 'following')),
  query_key text NOT NULL,
  algorithm_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_accessed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE feed_snapshot_items (
  snapshot_id text NOT NULL REFERENCES feed_snapshots(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  post_id text NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  score double precision NOT NULL,
  post_created_at timestamptz NOT NULL,
  rank_reason text NOT NULL DEFAULT '',
  PRIMARY KEY (snapshot_id, position),
  UNIQUE (snapshot_id, post_id)
);

CREATE INDEX feed_snapshots_viewer_expiry ON feed_snapshots(viewer_id, expires_at DESC);
CREATE INDEX feed_snapshot_items_post ON feed_snapshot_items(post_id);
CREATE INDEX reports_status_page ON reports(status, created_at DESC, id DESC);
CREATE INDEX reports_target_status ON reports(target_type, target_id, status, created_at DESC, id DESC);

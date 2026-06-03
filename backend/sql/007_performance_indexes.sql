CREATE INDEX IF NOT EXISTS idx_post_likes_post
  ON post_likes (post_id);

CREATE INDEX IF NOT EXISTS idx_post_favorites_post
  ON post_favorites (post_id);

CREATE INDEX IF NOT EXISTS idx_follows_following
  ON follows (following_id);

CREATE INDEX IF NOT EXISTS idx_reports_target
  ON reports (target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_posts_author_status_created
  ON posts (author_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_posts_collection_status_created
  ON posts (collection_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_comments_author_status_created
  ON comments (author_id, status, created_at DESC);

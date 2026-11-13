-- These indexes support the personalized recall queries and the existing
-- substring search without changing response shapes. Trigram indexes are
-- optional because some managed Postgres roles cannot install extensions.
CREATE INDEX IF NOT EXISTS posts_category_tags_gin ON posts USING gin(category_tags);
CREATE INDEX IF NOT EXISTS posts_fandom_tags_gin ON posts USING gin(fandom_tags);
CREATE INDEX IF NOT EXISTS follows_follower_following ON follows(follower_id, following_id);
CREATE INDEX IF NOT EXISTS post_likes_user_post ON post_likes(user_id, post_id);
CREATE INDEX IF NOT EXISTS post_favorites_user_post ON post_favorites(user_id, post_id);
CREATE INDEX IF NOT EXISTS reports_status_page ON reports(status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS reports_target_status ON reports(target_type, target_id, status, created_at DESC, id DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_opclass WHERE opcname = 'gin_trgm_ops') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS posts_search_trgm ON posts USING gin ((lower(concat_ws('' '', title, description, category_tags::text, fandom_tags::text, unsold_roles::text, pinggu_note))) gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS users_search_trgm ON users USING gin ((lower(concat_ws('' '', nickname, red_book_id, bio))) gin_trgm_ops)';
  END IF;
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE NOTICE 'pg_trgm unavailable; keeping substring search without optional indexes';
END $$;

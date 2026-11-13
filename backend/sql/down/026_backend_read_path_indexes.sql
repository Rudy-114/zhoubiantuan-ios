-- Rollback for 026_backend_read_path_indexes.sql. reports_status_page and
-- reports_target_status belong to 025 (026 only repeats them with IF NOT
-- EXISTS), so they are dropped by the 025 rollback, not here.
DROP INDEX IF EXISTS users_search_trgm;
DROP INDEX IF EXISTS posts_search_trgm;
DROP INDEX IF EXISTS post_favorites_user_post;
DROP INDEX IF EXISTS post_likes_user_post;
DROP INDEX IF EXISTS follows_follower_following;
DROP INDEX IF EXISTS posts_fandom_tags_gin;
DROP INDEX IF EXISTS posts_category_tags_gin;
DELETE FROM schema_migrations WHERE version = '026_backend_read_path_indexes.sql';

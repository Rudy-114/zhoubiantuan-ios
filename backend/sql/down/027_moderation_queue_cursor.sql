-- Rollback for 027_moderation_queue_cursor.sql.
DROP INDEX IF EXISTS moderation_reviews_status_page;
DELETE FROM schema_migrations WHERE version = '027_moderation_queue_cursor.sql';

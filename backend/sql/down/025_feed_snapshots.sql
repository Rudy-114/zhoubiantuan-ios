-- Rollback for 025_feed_snapshots.sql. Snapshots are a cache; the feed
-- recomputes rankings without them.
DROP INDEX IF EXISTS reports_target_status;
DROP INDEX IF EXISTS reports_status_page;
DROP TABLE IF EXISTS feed_snapshot_items;
DROP TABLE IF EXISTS feed_snapshots;
DELETE FROM schema_migrations WHERE version = '025_feed_snapshots.sql';

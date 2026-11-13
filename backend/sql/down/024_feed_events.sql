-- Rollback for 024_feed_events.sql. Drops the collected feed events.
DROP TABLE IF EXISTS feed_events;
DELETE FROM schema_migrations WHERE version = '024_feed_events.sql';

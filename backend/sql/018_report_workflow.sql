ALTER TABLE reports ADD COLUMN target_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE reports ADD COLUMN image_object_keys text[] NOT NULL DEFAULT ARRAY[]::text[];
ALTER TABLE reports ADD COLUMN handled_by text REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX reports_reporter_page ON reports(reporter_id, created_at DESC, id DESC);
CREATE INDEX reports_pending_page ON reports(status, created_at DESC, id DESC);

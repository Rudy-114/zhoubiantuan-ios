-- Prevent a user from spamming reports against the same target.
-- First de-duplicate existing rows (keep the lexicographically smallest id per
-- reporter+target), then enforce uniqueness going forward.
DELETE FROM reports r
USING reports keep
WHERE r.reporter_id = keep.reporter_id
  AND r.target_type = keep.target_type
  AND r.target_id = keep.target_id
  AND r.id > keep.id;

CREATE UNIQUE INDEX IF NOT EXISTS reports_unique_reporter_target
  ON reports (reporter_id, target_type, target_id);

-- Rollbacks are verified only against disposable test databases and are not a default production operation.
DROP VIEW IF EXISTS posts_with_safety_context;

DROP INDEX IF EXISTS safety_evidence_case_created;
DROP INDEX IF EXISTS safety_case_events_case_created;
DROP INDEX IF EXISTS safety_actions_target_active;
DROP INDEX IF EXISTS safety_jobs_claim;
DROP INDEX IF EXISTS safety_evidence_report_request;
DROP INDEX IF EXISTS safety_cases_one_open_subject_category;
DROP INDEX IF EXISTS reports_one_pending_reason;
DROP INDEX IF EXISTS reports_unique_reporter_request;

ALTER TABLE reports
  DROP CONSTRAINT IF EXISTS reports_status_check,
  DROP CONSTRAINT IF EXISTS reports_source_type_check,
  DROP CONSTRAINT IF EXISTS reports_subject_type_check,
  DROP COLUMN IF EXISTS client_request_id,
  DROP COLUMN IF EXISTS case_id,
  DROP COLUMN IF EXISTS source_type,
  DROP COLUMN IF EXISTS source_id,
  DROP COLUMN IF EXISTS subject_type,
  DROP COLUMN IF EXISTS subject_id,
  DROP COLUMN IF EXISTS reason_code,
  DROP COLUMN IF EXISTS reported_field,
  DROP COLUMN IF EXISTS updated_at;

DELETE FROM reports r
USING reports keep
WHERE r.reporter_id = keep.reporter_id
  AND r.target_type = keep.target_type
  AND r.target_id = keep.target_id
  AND r.id > keep.id;

CREATE UNIQUE INDEX IF NOT EXISTS reports_unique_reporter_target
  ON reports (reporter_id, target_type, target_id);

DROP TABLE IF EXISTS safety_evidence;
DROP TABLE IF EXISTS safety_case_events;
DROP TABLE IF EXISTS safety_actions;
DROP TABLE IF EXISTS safety_jobs;
DROP TABLE IF EXISTS safety_cases;

ALTER TABLE posts DROP COLUMN IF EXISTS safety_status;
ALTER TABLE comments DROP COLUMN IF EXISTS safety_status;
ALTER TABLE group_collections
  DROP COLUMN IF EXISTS safety_status,
  DROP COLUMN IF EXISTS contact_visibility;
ALTER TABLE direct_messages DROP COLUMN IF EXISTS safety_status;

CREATE TABLE report_uploads (
  object_key text PRIMARY KEY,
  owner_user_id text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'attached', 'deleting', 'deleted')),
  failure_count int NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  reactivation_count int NOT NULL DEFAULT 0 CHECK (reactivation_count >= 0),
  last_failure_at timestamptz,
  last_reactivated_at timestamptz,
  attached_at timestamptz,
  delete_started_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX report_uploads_owner_outstanding
  ON report_uploads (owner_user_id, state, created_at)
  WHERE state IN ('pending', 'deleting');

CREATE INDEX report_uploads_owner_issued
  ON report_uploads (owner_user_id, created_at);

CREATE INDEX report_uploads_cleanup_due
  ON report_uploads (state, updated_at)
  WHERE state IN ('pending', 'deleting');

CREATE INDEX safety_evidence_object_keys_gin
  ON safety_evidence USING gin (object_keys);

CREATE INDEX safety_jobs_cleanup_retention
  ON safety_jobs (status, updated_at, completed_at)
  WHERE job_type = 'cleanup_report_upload';

WITH cleanup_jobs AS (
  SELECT
    j.payload->>'objectKey' AS object_key,
    split_part(j.payload->>'objectKey', '/', 2) AS owner_user_id,
    j.status,
    j.attempts,
    j.completed_at,
    j.created_at,
    j.updated_at
  FROM safety_jobs j
  WHERE j.job_type = 'cleanup_report_upload'
    AND j.payload->>'objectKey' ~ '^report/[^/]+/.+'
)
INSERT INTO report_uploads (
  object_key,
  owner_user_id,
  state,
  failure_count,
  last_failure_at,
  attached_at,
  deleted_at,
  created_at,
  updated_at
)
SELECT
  j.object_key,
  j.owner_user_id,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM safety_evidence e
      WHERE e.object_keys @> ARRAY[j.object_key]::text[]
    ) THEN 'attached'
    WHEN j.status = 'completed' THEN 'deleted'
    ELSE 'pending'
  END,
  j.attempts,
  CASE WHEN j.status = 'failed' THEN j.updated_at END,
  CASE WHEN EXISTS (
    SELECT 1
    FROM safety_evidence e
    WHERE e.object_keys @> ARRAY[j.object_key]::text[]
  ) THEN j.updated_at END,
  CASE WHEN j.status = 'completed' THEN j.completed_at END,
  j.created_at,
  j.updated_at
FROM cleanup_jobs j
ON CONFLICT (object_key) DO NOTHING;

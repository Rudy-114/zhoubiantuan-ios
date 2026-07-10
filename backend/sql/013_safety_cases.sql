CREATE TABLE safety_cases (
  id text PRIMARY KEY,
  subject_type text NOT NULL CHECK (subject_type IN ('post', 'comment', 'user', 'direct_message', 'collection')),
  subject_id text NOT NULL,
  category text NOT NULL,
  impact_scope text NOT NULL CHECK (impact_scope IN ('post', 'comment', 'user', 'direct_message', 'collection')),
  status text NOT NULL DEFAULT 'received' CHECK (status IN (
    'received', 'triaging', 'monitoring', 'manual_review', 'awaiting_correction',
    'rechecking', 'appealed', 'resolved_no_action', 'resolved_restored', 'resolved_actioned'
  )),
  risk_level text NOT NULL DEFAULT 'none' CHECK (risk_level IN ('none', 'low', 'medium', 'high', 'urgent')),
  confidence numeric(5,4) NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  ai_recommendation jsonb NOT NULL DEFAULT '{}'::jsonb,
  manual_hold boolean NOT NULL DEFAULT false,
  correction_due_at timestamptz,
  model_version text NOT NULL DEFAULT '',
  prompt_version text NOT NULL DEFAULT '',
  policy_version text NOT NULL DEFAULT 'safety-policy-v1',
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX safety_cases_one_open_subject_category ON safety_cases (subject_type, subject_id, category)
  WHERE status NOT IN ('resolved_no_action', 'resolved_restored', 'resolved_actioned');

ALTER TABLE reports
  ADD COLUMN client_request_id text,
  ADD COLUMN case_id text REFERENCES safety_cases(id) ON DELETE RESTRICT,
  ADD COLUMN source_type text,
  ADD COLUMN source_id text,
  ADD COLUMN subject_type text,
  ADD COLUMN subject_id text,
  ADD COLUMN reason_code text,
  ADD COLUMN reported_field text NOT NULL DEFAULT 'content',
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

INSERT INTO safety_cases (id, subject_type, subject_id, category, impact_scope, status)
SELECT DISTINCT
  'sc-legacy-' || md5(target_type || ':' || target_id || ':other'),
  target_type,
  target_id,
  'other',
  target_type,
  'received'
FROM reports;

UPDATE reports
SET
  client_request_id = 'legacy-' || id,
  case_id = 'sc-legacy-' || md5(target_type || ':' || target_id || ':other'),
  source_type = target_type,
  source_id = target_id,
  subject_type = target_type,
  subject_id = target_id,
  reason_code = 'other',
  status = CASE
    WHEN status = 'pending' THEN 'pending'
    WHEN status IN ('closed', 'ignored', 'hidden', 'removed', 'warned', 'handled', 'resolved') THEN 'closed'
    ELSE 'invalid'
  END;

ALTER TABLE reports
  ALTER COLUMN client_request_id SET NOT NULL,
  ALTER COLUMN case_id SET NOT NULL,
  ALTER COLUMN source_type SET NOT NULL,
  ALTER COLUMN source_id SET NOT NULL,
  ALTER COLUMN subject_type SET NOT NULL,
  ALTER COLUMN subject_id SET NOT NULL,
  ALTER COLUMN reason_code SET NOT NULL,
  ADD CONSTRAINT reports_status_check CHECK (status IN ('pending', 'closed', 'invalid')),
  ADD CONSTRAINT reports_source_type_check CHECK (source_type IN ('post', 'comment', 'user', 'direct_message', 'collection')),
  ADD CONSTRAINT reports_subject_type_check CHECK (subject_type IN ('post', 'comment', 'user', 'direct_message', 'collection'));

CREATE UNIQUE INDEX reports_unique_reporter_request
  ON reports (reporter_id, client_request_id);

CREATE UNIQUE INDEX reports_one_pending_reason
  ON reports (reporter_id, subject_type, subject_id, reason_code)
  WHERE status = 'pending';

DROP INDEX reports_unique_reporter_target;

CREATE TABLE safety_evidence (
  id text PRIMARY KEY,
  case_id text NOT NULL REFERENCES safety_cases(id) ON DELETE CASCADE,
  report_id text REFERENCES reports(id) ON DELETE SET NULL,
  client_request_id text,
  evidence_type text NOT NULL,
  text_snapshot text NOT NULL DEFAULT '',
  structured_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  object_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  context_start_message_id text,
  context_end_message_id text,
  retention_delete_at timestamptz,
  redacted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX safety_evidence_report_request ON safety_evidence (report_id, client_request_id)
  WHERE report_id IS NOT NULL AND client_request_id IS NOT NULL;

CREATE TABLE safety_case_events (
  id bigserial PRIMARY KEY,
  case_id text NOT NULL REFERENCES safety_cases(id) ON DELETE CASCADE,
  actor_type text NOT NULL CHECK (actor_type IN ('system', 'ai', 'admin', 'reporter', 'owner')),
  actor_id text,
  event_type text NOT NULL,
  event_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE safety_actions (
  id text PRIMARY KEY,
  case_id text NOT NULL REFERENCES safety_cases(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL UNIQUE,
  action_type text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('system', 'ai', 'admin')),
  actor_id text,
  reason text NOT NULL,
  execution_status text NOT NULL DEFAULT 'pending' CHECK (execution_status IN ('pending', 'applied', 'failed', 'rolled_back')),
  before_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  applied_at timestamptz,
  rolled_back_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE safety_jobs (
  id bigserial PRIMARY KEY,
  job_type text NOT NULL,
  case_id text REFERENCES safety_cases(id) ON DELETE CASCADE,
  unique_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  run_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  completed_at timestamptz,
  error_code text,
  error_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE posts
  ADD COLUMN safety_status text NOT NULL DEFAULT 'active' CHECK (safety_status IN ('active', 'hidden', 'removed'));

ALTER TABLE comments
  ADD COLUMN safety_status text NOT NULL DEFAULT 'active' CHECK (safety_status IN ('active', 'hidden'));

ALTER TABLE group_collections
  ADD COLUMN safety_status text NOT NULL DEFAULT 'active' CHECK (safety_status IN ('active', 'suspended', 'removed')),
  ADD COLUMN contact_visibility text NOT NULL DEFAULT 'active' CHECK (contact_visibility IN ('active', 'hidden'));

ALTER TABLE direct_messages
  ADD COLUMN safety_status text NOT NULL DEFAULT 'active' CHECK (safety_status IN ('active', 'hidden'));

CREATE VIEW posts_with_safety_context AS
SELECT
  p.*,
  COALESCE(c.status, 'active') AS collection_status,
  COALESCE(c.safety_status, 'active') AS collection_safety_status,
  COALESCE(c.contact_visibility, 'active') AS collection_contact_visibility
FROM posts p
LEFT JOIN group_collections c ON c.id = p.collection_id;

CREATE INDEX safety_evidence_case_created ON safety_evidence (case_id, created_at);
CREATE INDEX safety_case_events_case_created ON safety_case_events (case_id, created_at);
CREATE INDEX safety_actions_target_active ON safety_actions (target_type, target_id, execution_status);
CREATE INDEX safety_jobs_claim ON safety_jobs (status, run_at, id);

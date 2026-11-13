CREATE TABLE safety_ai_runs (
  id text PRIMARY KEY,
  case_id text NOT NULL REFERENCES safety_cases(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'dashscope',
  model_version text NOT NULL,
  prompt_version text NOT NULL,
  policy_version text NOT NULL,
  evidence_hash text NOT NULL,
  is_synthetic boolean NOT NULL DEFAULT false,
  mode text NOT NULL CHECK (mode IN ('shadow', 'enforce')),
  status text NOT NULL CHECK (status IN (
    'reserved', 'running', 'completed', 'invalid', 'failed', 'budget_blocked'
  )),
  hard_signal jsonb NOT NULL DEFAULT '{}'::jsonb,
  parsed_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  proposed_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_response text NOT NULL DEFAULT '',
  error_code text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_cny numeric(12,6) NOT NULL DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, model_version, prompt_version, policy_version, evidence_hash)
);

CREATE TABLE safety_ai_usage (
  id text PRIMARY KEY,
  ai_run_id text NOT NULL UNIQUE REFERENCES safety_ai_runs(id) ON DELETE CASCADE,
  month_key text NOT NULL,
  reserved_cny numeric(12,6) NOT NULL CHECK (reserved_cny >= 0),
  actual_cny numeric(12,6),
  status text NOT NULL CHECK (status IN ('reserved', 'settled', 'released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);

CREATE TABLE safety_ai_evaluations (
  id text PRIMARY KEY,
  ai_run_id text NOT NULL UNIQUE REFERENCES safety_ai_runs(id) ON DELETE CASCADE,
  admin_user_id text NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  category_correct boolean NOT NULL,
  action_correct boolean NOT NULL,
  scope_expansion_error boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX safety_ai_runs_case_created
  ON safety_ai_runs (case_id, created_at DESC);
CREATE INDEX safety_ai_usage_month_status
  ON safety_ai_usage (month_key, status);

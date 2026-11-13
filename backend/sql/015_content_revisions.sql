CREATE TABLE content_revisions (
  id text PRIMARY KEY,
  case_id text NOT NULL REFERENCES safety_cases(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('post', 'collection')),
  target_id text NOT NULL,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  snapshot jsonb NOT NULL,
  object_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'approved', 'rejected', 'published')),
  review_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX content_revisions_target_number
  ON content_revisions (target_type, target_id, revision_number);

CREATE UNIQUE INDEX content_revisions_one_active_case
  ON content_revisions (case_id)
  WHERE status IN ('pending', 'reviewing', 'approved');

ALTER TABLE safety_actions
  ADD CONSTRAINT safety_actions_id_case_unique UNIQUE (id, case_id);

CREATE TABLE safety_appeals (
  id text PRIMARY KEY,
  case_id text NOT NULL REFERENCES safety_cases(id) ON DELETE CASCADE,
  decision_action_id text NOT NULL,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  detail text NOT NULL CHECK (char_length(detail) BETWEEN 1 AND 1000),
  object_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'upheld', 'overturned')),
  handled_by text,
  handled_reason text,
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT safety_appeals_decision_case_fkey
    FOREIGN KEY (decision_action_id, case_id)
    REFERENCES safety_actions(id, case_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX safety_appeals_one_per_decision ON safety_appeals (decision_action_id);
CREATE INDEX safety_appeals_pending_created ON safety_appeals (status, created_at);

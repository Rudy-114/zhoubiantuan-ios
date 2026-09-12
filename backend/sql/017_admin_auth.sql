CREATE TABLE admin_users (
  id text PRIMARY KEY,
  username text NOT NULL,
  username_normalized text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'locked', 'disabled')),
  failed_login_count integer NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_devices (
  id text PRIMARY KEY,
  admin_user_id text NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  public_key_jwk jsonb NOT NULL,
  fingerprint_hash text NOT NULL,
  is_root boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'revoked')),
  approved_by_device_id text REFERENCES admin_devices(id) ON DELETE SET NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (admin_user_id, fingerprint_hash)
);

CREATE TABLE admin_device_requests (
  id text PRIMARY KEY,
  admin_user_id text NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  proposed_device_id text NOT NULL,
  display_name text NOT NULL,
  public_key_jwk jsonb NOT NULL,
  fingerprint_hash text NOT NULL,
  short_code_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  requested_ip_hash text NOT NULL,
  user_agent_summary text NOT NULL DEFAULT '',
  expires_at timestamptz NOT NULL,
  handled_by_device_id text REFERENCES admin_devices(id) ON DELETE SET NULL,
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_auth_challenges (
  id text PRIMARY KEY,
  admin_user_id text NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  device_id text REFERENCES admin_devices(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('login', 'approve_device', 'reject_device')),
  target_id text,
  nonce_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_sessions (
  id text PRIMARY KEY,
  admin_user_id text NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  device_id text NOT NULL REFERENCES admin_devices(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  csrf_hash text NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_recovery_codes (
  id bigserial PRIMARY KEY,
  admin_user_id text NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_bootstrap_codes (
  id text PRIMARY KEY,
  admin_user_id text NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_audit_events (
  id bigserial PRIMARY KEY,
  admin_user_id text REFERENCES admin_users(id) ON DELETE SET NULL,
  device_id text REFERENCES admin_devices(id) ON DELETE SET NULL,
  session_id text REFERENCES admin_sessions(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  subject_type text,
  subject_id text,
  ip_hash text NOT NULL DEFAULT '',
  user_agent_summary text NOT NULL DEFAULT '',
  event_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_device_requests_pending
  ON admin_device_requests (status, created_at);
CREATE INDEX admin_sessions_active
  ON admin_sessions (token_hash) WHERE revoked_at IS NULL;
CREATE INDEX admin_auth_challenges_active
  ON admin_auth_challenges (id, expires_at) WHERE consumed_at IS NULL;
CREATE INDEX admin_audit_events_created
  ON admin_audit_events (created_at DESC);

ALTER TABLE users ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE TABLE IF NOT EXISTS auth_identities (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_subject text NOT NULL,
  email text,
  email_verified boolean NOT NULL DEFAULT false,
  display_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject),
  CHECK (provider IN ('email', 'apple', 'wechat'))
);

CREATE TABLE IF NOT EXISTS email_verification_codes (
  id text PRIMARY KEY,
  email text NOT NULL,
  purpose text NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (purpose IN ('register', 'login'))
);

CREATE INDEX IF NOT EXISTS idx_email_verification_codes_lookup
  ON email_verification_codes (email, purpose, created_at DESC)
  WHERE consumed_at IS NULL;

INSERT INTO auth_identities (
  id,
  user_id,
  provider,
  provider_subject,
  email,
  email_verified,
  display_name
)
SELECT
  'ident-' || md5('email:' || lower(u.email)),
  u.id,
  'email',
  lower(u.email),
  lower(u.email),
  false,
  u.nickname
FROM users u
WHERE u.email IS NOT NULL
ON CONFLICT (provider, provider_subject) DO NOTHING;

-- 027: account security (F11/F27/F28) and user-facing copy cleanup (F15).

-- Bumping token_version revokes every JWT issued before the bump. Existing
-- tokens carry no version and are treated as version 0, so upgrading does not
-- sign anybody out.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;

-- Allow password reset and account deletion codes. The original constraint
-- was created inline in 002 and named by PostgreSQL; look it up instead of
-- assuming the generated name.
DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT c.conname FROM pg_constraint c
    WHERE c.conrelid = 'email_verification_codes'::regclass AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%purpose%'
  LOOP
    EXECUTE format('ALTER TABLE email_verification_codes DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;
ALTER TABLE email_verification_codes ADD CONSTRAINT email_verification_codes_purpose_check
  CHECK (purpose IN ('register', 'login', 'reset', 'delete'));

-- F15: replace the old "internal testing" default note, only where users
-- never edited it.
UPDATE group_collections
SET default_note = '该合集内帖子共享联系方式、截团时间和默认说明。'
WHERE default_note = '该合集用于内部测试发布，可在后续版本编辑联系方式和截团时间。';

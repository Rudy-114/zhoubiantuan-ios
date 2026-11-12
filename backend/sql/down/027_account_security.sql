-- Rollback for 027_account_security.sql.
-- The F15 copy update is intentionally not reverted: the old text was a
-- user-facing mistake and cannot be told apart from later identical edits.
DELETE FROM email_verification_codes WHERE purpose IN ('reset', 'delete');
ALTER TABLE email_verification_codes DROP CONSTRAINT IF EXISTS email_verification_codes_purpose_check;
ALTER TABLE email_verification_codes ADD CONSTRAINT email_verification_codes_purpose_check
  CHECK (purpose IN ('register', 'login'));
ALTER TABLE users DROP COLUMN IF EXISTS token_version;
DELETE FROM schema_migrations WHERE version = '027_account_security.sql';

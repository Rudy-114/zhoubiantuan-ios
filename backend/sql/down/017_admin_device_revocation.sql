DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM admin_auth_challenges WHERE purpose = 'revoke_device'
  ) THEN
    RAISE EXCEPTION 'cannot roll back admin device revocation while revoke challenges exist';
  END IF;
END
$$;

ALTER TABLE admin_auth_challenges
  DROP CONSTRAINT admin_auth_challenges_purpose_check,
  ADD CONSTRAINT admin_auth_challenges_purpose_check
    CHECK (purpose IN ('login', 'approve_device', 'reject_device'));

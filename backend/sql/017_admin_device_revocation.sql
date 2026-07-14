ALTER TABLE admin_auth_challenges
  DROP CONSTRAINT admin_auth_challenges_purpose_check,
  ADD CONSTRAINT admin_auth_challenges_purpose_check
    CHECK (purpose IN ('login', 'approve_device', 'reject_device', 'revoke_device'));

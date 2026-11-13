DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM safety_ai_runs
    GROUP BY case_id, model_version, prompt_version, policy_version, evidence_hash
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'cannot restore safety AI run uniqueness while retry attempts exist';
  END IF;
END
$migration$;

DROP INDEX safety_ai_runs_one_blocking_evidence;

ALTER TABLE safety_ai_runs
  DROP COLUMN retryable,
  ADD CONSTRAINT safety_ai_runs_evidence_identity_key UNIQUE (
    case_id, model_version, prompt_version, policy_version, evidence_hash
  );

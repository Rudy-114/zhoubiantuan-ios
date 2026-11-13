ALTER TABLE safety_ai_runs
  ADD COLUMN retryable boolean NOT NULL DEFAULT false;

DO $migration$
DECLARE
  evidence_constraint text;
BEGIN
  SELECT constraint_row.conname
  INTO evidence_constraint
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'safety_ai_runs'::regclass
    AND constraint_row.contype = 'u'
    AND ARRAY(
      SELECT attribute.attname::text
      FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum, position)
      JOIN pg_attribute attribute
        ON attribute.attrelid = constraint_row.conrelid
       AND attribute.attnum = key_column.attnum
      ORDER BY key_column.position
    ) = ARRAY[
      'case_id', 'model_version', 'prompt_version', 'policy_version', 'evidence_hash'
    ]::text[];

  IF evidence_constraint IS NULL THEN
    RAISE EXCEPTION 'safety AI evidence uniqueness constraint not found';
  END IF;
  EXECUTE format('ALTER TABLE safety_ai_runs DROP CONSTRAINT %I', evidence_constraint);
END
$migration$;

CREATE UNIQUE INDEX safety_ai_runs_one_blocking_evidence
  ON safety_ai_runs (
    case_id, model_version, prompt_version, policy_version, evidence_hash
  )
  WHERE status <> 'failed' OR retryable = false;

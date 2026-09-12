-- Legacy application versions aggregate reports into appealed cases. Refuse
-- their schema rollback once 016 has admitted rows that the legacy unique
-- predicate cannot represent safely; the transaction leaves 016 applied.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM safety_cases
    WHERE status NOT IN ('resolved_no_action', 'resolved_restored', 'resolved_actioned')
    GROUP BY subject_type, subject_id, category
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'cannot roll back 016 while appealed and open safety cases coexist';
  END IF;
END
$$;

DROP INDEX safety_cases_one_open_subject_category;

CREATE UNIQUE INDEX safety_cases_one_open_subject_category
  ON safety_cases (subject_type, subject_id, category)
  WHERE status NOT IN ('resolved_no_action', 'resolved_restored', 'resolved_actioned');

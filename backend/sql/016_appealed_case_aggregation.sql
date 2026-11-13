DROP INDEX safety_cases_one_open_subject_category;

CREATE UNIQUE INDEX safety_cases_one_open_subject_category
  ON safety_cases (subject_type, subject_id, category)
  WHERE status NOT IN ('appealed', 'resolved_no_action', 'resolved_restored', 'resolved_actioned');

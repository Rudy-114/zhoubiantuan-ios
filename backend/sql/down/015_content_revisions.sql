DROP TABLE IF EXISTS safety_appeals;
ALTER TABLE safety_actions DROP CONSTRAINT IF EXISTS safety_actions_id_case_unique;
DROP TABLE IF EXISTS content_revisions;

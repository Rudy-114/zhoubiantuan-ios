ALTER TABLE posts ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE group_collections ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE group_collections ADD COLUMN submission_hash text;

-- Give legacy roles a repeatable identity without changing quantities or prices.
UPDATE posts p SET unsold_roles = (
  SELECT jsonb_agg(CASE WHEN jsonb_typeof(role) = 'object' AND coalesce(role->>'id', '') = ''
    THEN role || jsonb_build_object('id', 'role-' || md5(p.id || ':' || ordinal::text)) ELSE role END ORDER BY ordinal)
  FROM jsonb_array_elements(p.unsold_roles) WITH ORDINALITY AS r(role, ordinal)
) WHERE jsonb_typeof(unsold_roles) = 'array' AND jsonb_array_length(unsold_roles) > 0;

CREATE FUNCTION increment_content_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.revision := OLD.revision + 1;
  RETURN NEW;
END;
$$;
CREATE TRIGGER posts_revision BEFORE UPDATE ON posts FOR EACH ROW EXECUTE FUNCTION increment_content_revision();
CREATE TRIGGER collections_revision BEFORE UPDATE ON group_collections FOR EACH ROW EXECUTE FUNCTION increment_content_revision();

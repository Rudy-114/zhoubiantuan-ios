ALTER TABLE message_threads ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0);
CREATE TRIGGER threads_revision BEFORE UPDATE ON message_threads FOR EACH ROW EXECUTE FUNCTION increment_content_revision();

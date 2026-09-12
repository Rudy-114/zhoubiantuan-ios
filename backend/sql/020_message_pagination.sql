ALTER TABLE direct_messages ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0);
CREATE TRIGGER messages_revision BEFORE UPDATE ON direct_messages FOR EACH ROW EXECUTE FUNCTION increment_content_revision();
CREATE INDEX direct_messages_history ON direct_messages(thread_id,created_at DESC,id DESC);
CREATE INDEX threads_buyer_page ON message_threads(buyer_user_id,updated_at DESC,id DESC);
CREATE INDEX threads_publisher_page ON message_threads(publisher_user_id,updated_at DESC,id DESC);

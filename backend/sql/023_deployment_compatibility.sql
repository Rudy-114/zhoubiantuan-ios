-- Preserve the existing case workflow and immutable evidence uploads.
ALTER TABLE upload_tickets DROP CONSTRAINT upload_tickets_kind_check;
ALTER TABLE upload_tickets ADD CONSTRAINT upload_tickets_kind_check CHECK (kind IN ('post','avatar','background','message','report'));
-- Refresh the view's expanded columns after post revision migrations.
DROP VIEW posts_with_safety_context;
CREATE VIEW posts_with_safety_context AS
SELECT
  p.*,
  COALESCE(c.status, 'active') AS collection_status,
  COALESCE(c.safety_status, 'active') AS collection_safety_status,
  COALESCE(c.contact_visibility, 'active') AS collection_contact_visibility
FROM posts p
LEFT JOIN group_collections c ON c.id = p.collection_id;

UPDATE report_uploads r SET state='deleting', delete_started_at=now(), updated_at=now()
WHERE r.state='pending' AND NOT EXISTS (SELECT 1 FROM upload_tickets t WHERE t.object_key=r.object_key);

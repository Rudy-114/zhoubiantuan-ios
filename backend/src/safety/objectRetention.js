export async function loadRetainedSafetyObjectKeys(client, objectKeys) {
  if (!objectKeys.length) return new Set();
  const { rows } = await client.query(
    `SELECT DISTINCT source_references.object_key
     FROM (
       SELECT object_key
       FROM safety_evidence evidence
       CROSS JOIN LATERAL unnest(evidence.object_keys) AS reference(object_key)
       WHERE evidence.redacted_at IS NULL
       UNION ALL
       SELECT object_key
       FROM users source
       CROSS JOIN LATERAL unnest(ARRAY[source.avatar_object_key, source.background_object_key]) AS reference(object_key)
       WHERE source.status = 'active' AND source.deleted_at IS NULL
       UNION ALL
       SELECT object_key
       FROM posts source
       CROSS JOIN LATERAL unnest(source.image_object_keys || source.preview_image_object_keys) AS reference(object_key)
       WHERE source.status <> 'deleted'
       UNION ALL
       SELECT source.image_object_key
       FROM direct_messages source
       JOIN users sender ON sender.id = source.sender_id
       WHERE source.image_object_key IS NOT NULL
         AND source.revoked_at IS NULL
         AND source.safety_status = 'active'
         AND sender.status = 'active'
         AND sender.deleted_at IS NULL
       UNION ALL
       SELECT object_key
       FROM moderation_reviews review
       CROSS JOIN LATERAL unnest(review.image_object_keys) AS reference(object_key)
       UNION ALL
       SELECT object_key
       FROM content_revisions revision
       CROSS JOIN LATERAL unnest(revision.object_keys) AS reference(object_key)
       UNION ALL
       SELECT object_key
       FROM safety_appeals appeal
       CROSS JOIN LATERAL unnest(appeal.object_keys) AS reference(object_key)
     ) source_references
     WHERE source_references.object_key = ANY($1::text[])`,
    [objectKeys]
  );
  return new Set(rows.map((row) => row.object_key));
}

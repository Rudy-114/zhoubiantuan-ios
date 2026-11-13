export const POST_PUBLIC_VISIBILITY_PREDICATE = "p.status = 'active' AND p.safety_status = 'active' AND p.collection_status = 'active' AND p.collection_safety_status = 'active'";
export const COLLECTION_PUBLIC_VISIBILITY_PREDICATE = "c.status = 'active' AND c.safety_status = 'active'";
export const COMMENT_PUBLIC_VISIBILITY_PREDICATE = "cm.status = 'active' AND cm.safety_status = 'active' AND p.status = 'active' AND p.safety_status = 'active' AND p.collection_status = 'active' AND p.collection_safety_status = 'active'";

export async function isPostPubliclyVisible(client, postId) {
  const { rows } = await client.query(
    `SELECT 1 FROM posts_with_safety_context p
     WHERE p.id = $1 AND ${POST_PUBLIC_VISIBILITY_PREDICATE}`,
    [postId]
  );
  return Boolean(rows[0]);
}

export function isPostRowPubliclyVisible(post) {
  return post?.status === "active" &&
    post.safety_status === "active" &&
    post.collection_status === "active" &&
    post.collection_safety_status === "active";
}

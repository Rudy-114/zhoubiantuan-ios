import { collectionToClient, commentToClient, postToClient, reportToClient, userToClient } from "./mappers.js";
import { query } from "./db.js";

export async function loadBootstrap(userId) {
  const [usersResult, postsResult, collectionsResult, commentsResult, reportsResult, likedResult, favoriteResult, followedResult] = await Promise.all([
    query(`
      SELECT u.*,
        (SELECT count(*) FROM follows f WHERE f.follower_id = u.id) AS following_count,
        (SELECT count(*) FROM follows f WHERE f.following_id = u.id) AS followers_count,
        (SELECT count(*) FROM posts p WHERE p.author_id = u.id AND p.status = 'active') AS post_count
      FROM users u
      WHERE u.deleted_at IS NULL AND u.status = 'active'
      ORDER BY u.created_at ASC
    `),
    query(`
      SELECT p.*,
        (SELECT count(*) FROM post_likes l WHERE l.post_id = p.id) AS liked_count,
        (SELECT count(*) FROM post_favorites f WHERE f.post_id = p.id) AS favorite_count,
        (SELECT count(*) FROM comments c WHERE c.post_id = p.id AND c.status = 'active') AS comment_count,
        (SELECT count(*) FROM reports r WHERE r.target_type = 'post' AND r.target_id = p.id) AS report_count
      FROM posts p
      WHERE p.status <> 'deleted'
      ORDER BY p.created_at DESC
    `),
    query(`
      SELECT c.*,
        COALESCE(array_agg(p.id ORDER BY p.created_at DESC) FILTER (WHERE p.id IS NOT NULL), ARRAY[]::text[]) AS post_ids
      FROM group_collections c
      LEFT JOIN posts p ON p.collection_id = c.id AND p.status <> 'deleted'
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `),
    query("SELECT * FROM comments WHERE status = 'active' ORDER BY created_at ASC"),
    query("SELECT * FROM reports ORDER BY created_at DESC LIMIT 100"),
    query("SELECT post_id FROM post_likes WHERE user_id = $1", [userId]),
    query("SELECT post_id FROM post_favorites WHERE user_id = $1", [userId]),
    query("SELECT following_id FROM follows WHERE follower_id = $1", [userId])
  ]);

  return {
    users: usersResult.rows.map((row) => userToClient(row, row)),
    posts: postsResult.rows.map((row) => postToClient(row, row)),
    collections: collectionsResult.rows.map((row) => collectionToClient(row, row.post_ids)),
    comments: commentsResult.rows.map(commentToClient),
    reports: reportsResult.rows.map(reportToClient),
    likedPostIDs: likedResult.rows.map((row) => row.post_id),
    favoritePostIDs: favoriteResult.rows.map((row) => row.post_id),
    followedUserIDs: followedResult.rows.map((row) => row.following_id)
  };
}

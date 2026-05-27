import { collectionToClient, commentToClient, directMessageToClient, messageThreadToClient, postToClient, reportToClient, userToClient } from "./mappers.js";
import { query } from "./db.js";

export async function loadBootstrap(userId) {
  const [usersResult, postsResult, collectionsResult, commentsResult, reportsResult, likedResult, favoriteResult, followedResult, followsResult, threadsResult, messagesResult] = await Promise.all([
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
        (SELECT count(*) FROM reports r WHERE r.target_type = 'post' AND r.target_id = p.id) AS report_count,
        (SELECT mr.reason FROM moderation_reviews mr WHERE mr.target_type = 'post' AND mr.target_id = p.id ORDER BY mr.created_at DESC LIMIT 1) AS moderation_reason,
        (SELECT mr.id FROM moderation_reviews mr WHERE mr.target_type = 'post' AND mr.target_id = p.id ORDER BY mr.created_at DESC LIMIT 1) AS review_id
      FROM posts p
      WHERE p.status = 'active'
         OR (p.author_id = $1 AND p.status IN ('pending', 'review', 'rejected', 'hidden', 'removed'))
      ORDER BY p.created_at DESC
    `, [userId]),
    query(`
      SELECT c.*,
        COALESCE(array_agg(p.id ORDER BY p.created_at DESC) FILTER (WHERE p.id IS NOT NULL), ARRAY[]::text[]) AS post_ids
      FROM group_collections c
      LEFT JOIN posts p ON p.collection_id = c.id AND (
        p.status = 'active' OR (p.author_id = $1 AND p.status IN ('pending', 'review', 'rejected', 'hidden', 'removed'))
      )
      WHERE c.status = 'active'
         OR (c.owner_id = $1 AND c.status IN ('pending', 'review', 'rejected'))
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `, [userId]),
    query(
      `SELECT cm.*,
        (SELECT mr.reason FROM moderation_reviews mr WHERE mr.target_type = 'comment' AND mr.target_id = cm.id ORDER BY mr.created_at DESC LIMIT 1) AS moderation_reason,
        (SELECT mr.id FROM moderation_reviews mr WHERE mr.target_type = 'comment' AND mr.target_id = cm.id ORDER BY mr.created_at DESC LIMIT 1) AS review_id
       FROM comments cm
       WHERE cm.status = 'active'
          OR (cm.author_id = $1 AND cm.status IN ('pending', 'review', 'rejected'))
       ORDER BY cm.created_at ASC`,
      [userId]
    ),
    query("SELECT * FROM reports ORDER BY created_at DESC LIMIT 100"),
    query("SELECT post_id FROM post_likes WHERE user_id = $1", [userId]),
    query("SELECT post_id FROM post_favorites WHERE user_id = $1", [userId]),
    query("SELECT following_id FROM follows WHERE follower_id = $1", [userId]),
    query("SELECT follower_id, following_id FROM follows"),
    query(
      `SELECT mt.*,
        (SELECT count(*)
         FROM direct_messages dm
         WHERE dm.thread_id = mt.id
           AND dm.sender_id <> $1
           AND dm.created_at > COALESCE(
             (SELECT r.read_at FROM message_thread_reads r WHERE r.thread_id = mt.id AND r.user_id = $1),
             '-infinity'::timestamptz
           )) AS unread_count
       FROM message_threads mt
       WHERE mt.buyer_user_id = $1 OR mt.publisher_user_id = $1
       ORDER BY mt.updated_at DESC
       LIMIT 100`,
      [userId]
    ),
    query(
      `SELECT dm.*
       FROM direct_messages dm
       JOIN message_threads mt ON mt.id = dm.thread_id
       WHERE mt.buyer_user_id = $1 OR mt.publisher_user_id = $1
       ORDER BY dm.created_at ASC`,
      [userId]
    )
  ]);

  const followingByUserID = {};
  for (const row of followsResult.rows) {
    if (!followingByUserID[row.follower_id]) followingByUserID[row.follower_id] = [];
    followingByUserID[row.follower_id].push(row.following_id);
  }

  const messagesByThreadID = {};
  for (const row of messagesResult.rows) {
    if (!messagesByThreadID[row.thread_id]) messagesByThreadID[row.thread_id] = [];
    messagesByThreadID[row.thread_id].push(directMessageToClient(row));
  }

  return {
    users: usersResult.rows.map((row) => userToClient(row, row)),
    posts: postsResult.rows.map((row) => postToClient(row, row)),
    collections: collectionsResult.rows.map((row) => collectionToClient(row, row.post_ids)),
    comments: commentsResult.rows.map(commentToClient),
    messageThreads: threadsResult.rows.map((row) => messageThreadToClient(row, messagesByThreadID[row.id] || [])),
    reports: reportsResult.rows.map(reportToClient),
    likedPostIDs: likedResult.rows.map((row) => row.post_id),
    favoritePostIDs: favoriteResult.rows.map((row) => row.post_id),
    followedUserIDs: followedResult.rows.map((row) => row.following_id),
    followingByUserID
  };
}

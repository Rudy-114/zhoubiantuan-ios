import { visiblePostSQL, visibleCollectionSQL, visibleCommentSQL } from "./visibility.js";
import { collectionToClient, commentToClient, directMessageToClient, messageThreadToClient, postToClient, reportToClient, userToClient } from "./mappers.js";
import { query } from "./db.js";
import { attachPostCounts } from "./postCounts.js";

export async function loadBootstrap(userId) {
  const [rawPostsResult, collectionsResult, commentsResult, reportsResult, likedResult, favoriteResult, followedResult, followsResult, threadsResult, messagesResult, blockedResult, blockedByResult] = await Promise.all([
    query(`
      SELECT p.*,
        (SELECT mr.reason FROM moderation_reviews mr WHERE mr.target_type = 'post' AND mr.target_id = p.id ORDER BY mr.created_at DESC LIMIT 1) AS moderation_reason,
        (SELECT mr.id FROM moderation_reviews mr WHERE mr.target_type = 'post' AND mr.target_id = p.id ORDER BY mr.created_at DESC LIMIT 1) AS review_id
      FROM posts p
      WHERE ${visiblePostSQL("p", "$1", true)}
      ORDER BY p.created_at DESC
      LIMIT 200
    `, [userId]),
    query(`
      SELECT c.*,
        COALESCE(array_agg(p.id ORDER BY p.created_at DESC) FILTER (WHERE p.id IS NOT NULL), ARRAY[]::text[]) AS post_ids
      FROM group_collections c
      LEFT JOIN posts p ON p.collection_id = c.id AND ${visiblePostSQL("p", "$1", true)}
      WHERE ${visibleCollectionSQL("c", "$1", true)}
      GROUP BY c.id
      ORDER BY c.created_at DESC
      LIMIT 200
    `, [userId]),
    query(
      `SELECT *
       FROM (
         SELECT cm.*,
           (SELECT mr.reason FROM moderation_reviews mr WHERE mr.target_type = 'comment' AND mr.target_id = cm.id ORDER BY mr.created_at DESC LIMIT 1) AS moderation_reason,
           (SELECT mr.id FROM moderation_reviews mr WHERE mr.target_type = 'comment' AND mr.target_id = cm.id ORDER BY mr.created_at DESC LIMIT 1) AS review_id
         FROM comments cm
         WHERE ${visibleCommentSQL("cm", "$1", true)}
         ORDER BY cm.created_at DESC
         LIMIT 500
       ) recent_comments
       ORDER BY created_at ASC`,
      [userId]
    ),
    query("SELECT * FROM reports WHERE reporter_id = $1 ORDER BY created_at DESC LIMIT 100", [userId]),
    query(`SELECT r.post_id FROM post_likes r JOIN posts p ON p.id=r.post_id WHERE r.user_id=$1 AND ${visiblePostSQL("p", "$1", true)}`, [userId]),
    query(`SELECT r.post_id FROM post_favorites r JOIN posts p ON p.id=r.post_id WHERE r.user_id=$1 AND ${visiblePostSQL("p", "$1", true)}`, [userId]),
    query("SELECT following_id FROM follows WHERE follower_id = $1", [userId]),
    query("SELECT follower_id, following_id FROM follows WHERE follower_id = $1 OR following_id = $1", [userId]),
    query(
      `SELECT mt.*,
        (SELECT count(*)
         FROM direct_messages dm
         WHERE dm.thread_id = mt.id
           AND dm.revoked_at IS NULL
           AND NOT ($1 = ANY(dm.deleted_for_user_ids))
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
      `SELECT *
       FROM (
         SELECT dm.*
         FROM direct_messages dm
         JOIN (
           SELECT id
           FROM message_threads
           WHERE buyer_user_id = $1 OR publisher_user_id = $1
           ORDER BY updated_at DESC
           LIMIT 100
         ) mt ON mt.id = dm.thread_id
         WHERE dm.revoked_at IS NULL
           AND NOT ($1 = ANY(dm.deleted_for_user_ids))
         ORDER BY dm.created_at DESC
         LIMIT 500
       ) recent_messages
       ORDER BY created_at ASC`,
      [userId]
    ),
    query("SELECT blocked_id FROM user_blocks WHERE blocker_id = $1", [userId]),
    query("SELECT blocker_id FROM user_blocks WHERE blocked_id = $1", [userId])
  ]);

  const posts = await attachPostCounts(rawPostsResult.rows);
  const userIds = uniqueIds([
    userId,
    ...posts.map((row) => row.author_id),
    ...collectionsResult.rows.map((row) => row.owner_id),
    ...commentsResult.rows.map((row) => row.author_id),
    ...followsResult.rows.flatMap((row) => [row.follower_id, row.following_id]),
    ...threadsResult.rows.flatMap((row) => [row.buyer_user_id, row.publisher_user_id]),
    ...messagesResult.rows.map((row) => row.sender_id),
    ...blockedResult.rows.map((row) => row.blocked_id)
  ]);
  const usersResult = userIds.length
    ? await query(
        `SELECT u.*,
          (SELECT count(*) FROM follows f WHERE f.follower_id = u.id) AS following_count,
          (SELECT count(*) FROM follows f WHERE f.following_id = u.id) AS followers_count,
          (SELECT count(*) FROM posts p WHERE p.author_id = u.id AND p.status = 'active') AS post_count
        FROM users u
        WHERE u.id = ANY($1::text[])
          AND u.deleted_at IS NULL
          AND u.status = 'active'
        ORDER BY u.created_at ASC`,
        [userIds]
      )
    : { rows: [] };

  const followingByUserID = {};
  for (const row of followsResult.rows) {
    if (!followingByUserID[row.follower_id]) followingByUserID[row.follower_id] = [];
    followingByUserID[row.follower_id].push(row.following_id);
  }

  const messagesByThreadID = {};
  for (const row of messagesResult.rows) {
    if (!messagesByThreadID[row.thread_id]) messagesByThreadID[row.thread_id] = [];
    messagesByThreadID[row.thread_id].push(directMessageToClient(row, userId));
  }

  return {
    users: usersResult.rows.map((row) => userToClient(row, row, userId)),
    posts: posts.map((row) => postToClient(row, row)),
    collections: collectionsResult.rows.map((row) => collectionToClient(row, row.post_ids)),
    comments: commentsResult.rows.map(commentToClient),
    messageThreads: threadsResult.rows.map((row) => messageThreadToClient(row, messagesByThreadID[row.id] || [])),
    reports: reportsResult.rows.map(reportToClient),
    likedPostIDs: likedResult.rows.map((row) => row.post_id),
    favoritePostIDs: favoriteResult.rows.map((row) => row.post_id),
    followedUserIDs: followedResult.rows.map((row) => row.following_id),
    followingByUserID,
    blockedUserIDs: blockedResult.rows.map((row) => row.blocked_id),
    blockedByUserIDs: blockedByResult.rows.map((row) => row.blocker_id)
  };
}

function uniqueIds(values) {
  return [...new Set(values.filter(Boolean))];
}

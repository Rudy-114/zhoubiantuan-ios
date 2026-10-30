import { visiblePostSQL, visibleCollectionSQL, visibleCommentSQL } from "./visibility.js";
import { collectionToClient, commentToClient, directMessageToClient, messageThreadToClient, postToClient, reportToClient, userToClient } from "./mappers.js";
import { query } from "./db.js";
import { loadThreadsPage } from "./messages.js";
import { attachPostCounts } from "./postCounts.js";

export async function loadBootstrap(userId) {
  const [rawPostsResult, collectionsResult, commentsResult, reportsResult, likedResult, favoriteResult, followedResult, followsResult, messagePage, blockedResult, blockedByResult] = await Promise.all([
    query(`
      SELECT p.*,
        (SELECT mr.reason FROM moderation_reviews mr WHERE mr.target_type = 'post' AND mr.target_id = p.id ORDER BY mr.created_at DESC LIMIT 1) AS moderation_reason,
        (SELECT mr.id FROM moderation_reviews mr WHERE mr.target_type = 'post' AND mr.target_id = p.id ORDER BY mr.created_at DESC LIMIT 1) AS review_id
      FROM posts p
      WHERE ${visiblePostSQL("p", "$1", true)}
      ORDER BY p.created_at DESC,p.id DESC
      LIMIT 40
    `, [userId]),
    query(`
      SELECT c.*,
        ARRAY(SELECT p.id FROM posts p WHERE p.collection_id=c.id AND ${visiblePostSQL("p", "$1", true)} ORDER BY p.created_at DESC,p.id DESC LIMIT 50) AS post_ids,
        (SELECT count(*) FROM posts p WHERE p.collection_id=c.id AND ${visiblePostSQL("p", "$1", true)}) AS post_count
      FROM group_collections c
      WHERE ${visibleCollectionSQL("c", "$1", true)}
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
         LIMIT 100
       ) recent_comments
       ORDER BY created_at ASC`,
      [userId]
    ),
    query("SELECT * FROM reports WHERE reporter_id = $1 ORDER BY created_at DESC LIMIT 100", [userId]),
    query(`SELECT r.post_id FROM post_likes r JOIN posts p ON p.id=r.post_id WHERE r.user_id=$1 AND ${visiblePostSQL("p", "$1", true)}`, [userId]),
    query(`SELECT r.post_id FROM post_favorites r JOIN posts p ON p.id=r.post_id WHERE r.user_id=$1 AND ${visiblePostSQL("p", "$1", true)}`, [userId]),
    query("SELECT following_id FROM follows WHERE follower_id = $1", [userId]),
    query("SELECT follower_id, following_id FROM follows WHERE follower_id = $1 OR following_id = $1", [userId]),
    loadThreadsPage({ query }, userId),
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
    ...messagePage.users.map(user => user.id),
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

  return {
    users: usersResult.rows.map((row) => userToClient(row, row, userId)),
    posts: posts.map((row) => postToClient(row, row)),
    collections: collectionsResult.rows.map((row) => collectionToClient(row, row.post_ids)),
    comments: commentsResult.rows.map(commentToClient),
    messageThreads: messagePage.messageThreads,
    nextThreadsCursor: messagePage.nextCursor,
    threadsHasMore: messagePage.hasMore,
    unreadMessageCount: messagePage.unreadMessageCount,
    unreadCursor: messagePage.unreadCursor,
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

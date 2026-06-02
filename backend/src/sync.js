import { query } from "./db.js";
import { collectionToClient, commentToClient, postToClient, userToClient } from "./mappers.js";
import { loadMessageThreadsForUser } from "./messages.js";

const DEFAULT_SYNC_LIMIT = 100;
const MAX_SYNC_LIMIT = 200;

export async function getCurrentSyncCursor(client = { query }) {
  const { rows } = await client.query("SELECT COALESCE(MAX(id), 0)::text AS cursor FROM sync_events");
  return rows[0]?.cursor || "0";
}

export async function createSyncEvent(client, { userId, eventType, entityType, entityId, threadId = null }) {
  const { rows } = await client.query(
    `INSERT INTO sync_events (user_id, event_type, entity_type, entity_id, thread_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id::text, user_id, event_type, entity_type, entity_id, thread_id, created_at`,
    [userId, eventType, entityType, entityId, threadId]
  );
  return syncEventToClient(rows[0]);
}

export async function createThreadSyncEvents(client, { userIds, eventType, entityType, entityId, threadId }) {
  return createSyncEventsForUsers(client, { userIds, eventType, entityType, entityId, threadId });
}

export async function createSyncEventsForUsers(client, { userIds, eventType, entityType, entityId, threadId = null }) {
  const events = [];
  for (const userId of [...new Set(userIds.filter(Boolean))]) {
    events.push(await createSyncEvent(client, { userId, eventType, entityType, entityId, threadId }));
  }
  return events;
}

export async function loadSyncPayload(userId, { cursor, limit } = {}) {
  const safeCursor = normalizeCursor(cursor);
  const safeLimit = normalizeLimit(limit);
  const eventsResult = await query(
    `SELECT id::text, user_id, event_type, entity_type, entity_id, thread_id, created_at
     FROM sync_events
     WHERE user_id = $1 AND id > $2::bigint
     ORDER BY id ASC
     LIMIT $3`,
    [userId, safeCursor, safeLimit + 1]
  );
  const rows = eventsResult.rows.slice(0, safeLimit);
  const hasMore = eventsResult.rows.length > safeLimit;
  const events = rows.map(syncEventToClient);
  const nextCursor = rows.length ? rows[rows.length - 1].id : safeCursor;
  const threadIds = rows.map((row) => row.thread_id).filter(Boolean);
  const commentIds = unique(rows.filter((row) => row.entity_type === "comment").map((row) => row.entity_id));
  const initialPostIds = unique(rows.filter((row) => row.entity_type === "post").map((row) => row.entity_id));
  const initialUserIds = unique(rows.filter((row) => row.entity_type === "user").map((row) => row.entity_id));

  const [messageThreads, unreadMessageCount, comments, relationships] = await Promise.all([
    loadMessageThreadsForUser({ query }, threadIds, userId),
    loadUnreadMessageCount(userId),
    loadCommentsForSync(userId, commentIds),
    loadRelationshipState(userId)
  ]);
  const postIds = unique([...initialPostIds, ...comments.map((comment) => comment.postID)]);
  const posts = await loadPostsForSync(userId, postIds);
  const collectionIds = unique(posts.map((post) => post.collectionID).filter(Boolean));
  const collections = await loadCollectionsForSync(userId, collectionIds);
  const userIds = unique([
    ...initialUserIds,
    ...posts.map((post) => post.authorID),
    ...comments.map((comment) => comment.authorID),
    ...collections.map((collection) => collection.ownerID)
  ]);
  const users = await loadUsersForSync(userIds);

  return {
    nextCursor,
    hasMore,
    events,
    users,
    posts,
    collections,
    comments,
    messageThreads,
    unreadMessageCount,
    ...relationships
  };
}

function normalizeCursor(value) {
  const text = String(value ?? "0").trim();
  if (!/^\d+$/.test(text)) return "0";
  return text;
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(String(value ?? DEFAULT_SYNC_LIMIT), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SYNC_LIMIT;
  return Math.min(parsed, MAX_SYNC_LIMIT);
}

async function loadUnreadMessageCount(userId) {
  const { rows } = await query(
    `SELECT COALESCE(SUM(unread_count), 0)::int AS unread_count
     FROM (
       SELECT count(*) AS unread_count
       FROM message_threads mt
       JOIN direct_messages dm ON dm.thread_id = mt.id
       WHERE (mt.buyer_user_id = $1 OR mt.publisher_user_id = $1)
         AND dm.revoked_at IS NULL
         AND NOT ($1 = ANY(dm.deleted_for_user_ids))
         AND dm.sender_id <> $1
         AND dm.created_at > COALESCE(
           (SELECT r.read_at FROM message_thread_reads r WHERE r.thread_id = mt.id AND r.user_id = $1),
           '-infinity'::timestamptz
         )
       GROUP BY mt.id
     ) unread_threads`,
    [userId]
  );
  return Number(rows[0]?.unread_count || 0);
}

async function loadUsersForSync(userIds) {
  const ids = unique(userIds);
  if (!ids.length) return [];
  const { rows } = await query(
    `SELECT u.*,
        (SELECT count(*) FROM follows f WHERE f.follower_id = u.id) AS following_count,
        (SELECT count(*) FROM follows f WHERE f.following_id = u.id) AS followers_count,
        (SELECT count(*) FROM posts p WHERE p.author_id = u.id AND p.status = 'active') AS post_count
      FROM users u
      WHERE u.id = ANY($1::text[])
        AND u.deleted_at IS NULL
        AND u.status = 'active'
      ORDER BY u.created_at ASC`,
    [ids]
  );
  return rows.map((row) => userToClient(row, row));
}

async function loadPostsForSync(userId, postIds) {
  const ids = unique(postIds);
  if (!ids.length) return [];
  const { rows } = await query(
    `SELECT p.*,
        (SELECT count(*) FROM post_likes l WHERE l.post_id = p.id) AS liked_count,
        (SELECT count(*) FROM post_favorites f WHERE f.post_id = p.id) AS favorite_count,
        (SELECT count(*) FROM comments c WHERE c.post_id = p.id AND c.status = 'active') AS comment_count,
        (SELECT count(*) FROM reports r WHERE r.target_type = 'post' AND r.target_id = p.id) AS report_count,
        (SELECT mr.reason FROM moderation_reviews mr WHERE mr.target_type = 'post' AND mr.target_id = p.id ORDER BY mr.created_at DESC LIMIT 1) AS moderation_reason,
        (SELECT mr.id FROM moderation_reviews mr WHERE mr.target_type = 'post' AND mr.target_id = p.id ORDER BY mr.created_at DESC LIMIT 1) AS review_id
      FROM posts p
      WHERE p.id = ANY($2::text[])
        AND (
          p.status IN ('active', 'deleted')
          OR (p.author_id = $1 AND p.status IN ('pending', 'review', 'rejected', 'hidden', 'removed'))
        )
      ORDER BY p.created_at DESC`,
    [userId, ids]
  );
  return rows.map((row) => postToClient(row, row));
}

async function loadCollectionsForSync(userId, collectionIds) {
  const ids = unique(collectionIds);
  if (!ids.length) return [];
  const { rows } = await query(
    `SELECT c.*,
        COALESCE(array_agg(p.id ORDER BY p.created_at DESC) FILTER (WHERE p.id IS NOT NULL), ARRAY[]::text[]) AS post_ids
      FROM group_collections c
      LEFT JOIN posts p ON p.collection_id = c.id AND (
        p.status = 'active' OR (p.author_id = $1 AND p.status IN ('pending', 'review', 'rejected', 'hidden', 'removed'))
      )
      WHERE c.id = ANY($2::text[])
        AND (
          c.status = 'active'
          OR (c.owner_id = $1 AND c.status IN ('pending', 'review', 'rejected'))
        )
      GROUP BY c.id
      ORDER BY c.created_at DESC`,
    [userId, ids]
  );
  return rows.map((row) => collectionToClient(row, row.post_ids));
}

async function loadCommentsForSync(userId, commentIds) {
  const ids = unique(commentIds);
  if (!ids.length) return [];
  const { rows } = await query(
    `SELECT cm.*,
        (SELECT mr.reason FROM moderation_reviews mr WHERE mr.target_type = 'comment' AND mr.target_id = cm.id ORDER BY mr.created_at DESC LIMIT 1) AS moderation_reason,
        (SELECT mr.id FROM moderation_reviews mr WHERE mr.target_type = 'comment' AND mr.target_id = cm.id ORDER BY mr.created_at DESC LIMIT 1) AS review_id
      FROM comments cm
      WHERE cm.id = ANY($2::text[])
        AND (
          cm.status IN ('active', 'deleted')
          OR (cm.author_id = $1 AND cm.status IN ('pending', 'review', 'rejected'))
        )
      ORDER BY cm.created_at ASC`,
    [userId, ids]
  );
  return rows.map(commentToClient);
}

async function loadRelationshipState(userId) {
  const [likedResult, favoriteResult, followedResult, followsResult] = await Promise.all([
    query("SELECT post_id FROM post_likes WHERE user_id = $1", [userId]),
    query("SELECT post_id FROM post_favorites WHERE user_id = $1", [userId]),
    query("SELECT following_id FROM follows WHERE follower_id = $1", [userId]),
    query("SELECT follower_id, following_id FROM follows")
  ]);

  const followingByUserID = {};
  for (const row of followsResult.rows) {
    if (!followingByUserID[row.follower_id]) followingByUserID[row.follower_id] = [];
    followingByUserID[row.follower_id].push(row.following_id);
  }

  return {
    likedPostIDs: likedResult.rows.map((row) => row.post_id),
    favoritePostIDs: favoriteResult.rows.map((row) => row.post_id),
    followedUserIDs: followedResult.rows.map((row) => row.following_id),
    followingByUserID
  };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function syncEventToClient(row) {
  return {
    id: row.id,
    userID: row.user_id,
    eventType: row.event_type,
    entityType: row.entity_type,
    entityID: row.entity_id,
    threadID: row.thread_id || null,
    createdAt: row.created_at.toISOString()
  };
}

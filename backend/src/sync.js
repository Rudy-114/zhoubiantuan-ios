import { safetyReportToBootstrapClient } from "./safety/reportMapper.js";
import { query, withTransaction, beforeCommit } from "./db.js";
import { logger } from "./logger.js";
import { collectionToClient, commentToClient, postToClient, reportToClient, userToClient } from "./mappers.js";
import { loadMessageThreadsForUser, loadUnreadSnapshot } from "./messages.js";
import { attachPostCounts } from "./postCounts.js";
import { visiblePostSQL, visibleCollectionSQL, visibleCommentSQL } from "./visibility.js";

const DEFAULT_SYNC_LIMIT = 100;
const MAX_SYNC_LIMIT = 200;
const SYNC_EVENT_RETENTION_DAYS = 7;
const SYNC_EVENT_PRUNE_INTERVAL_MS = 60 * 60 * 1000;

export async function getCurrentSyncCursor(client = { query }) {
  const { rows } = await client.query("SELECT cursor::text FROM sync_state WHERE singleton");
  return rows[0]?.cursor || "0";
}

export async function createSyncEvent(client, { userId, eventType, entityType, entityId, threadId = null }) {
  const event = {};
  const input = { userId, eventType, entityType, entityId, threadId };
  if (beforeCommit(client, async () => Object.assign(event, await insertSyncEvent(client, input)))) return event;
  return insertSyncEvent(client, input);
}

async function insertSyncEvent(client, { userId, eventType, entityType, entityId, threadId }) {
  // Allocate only after business writes; callers must not acquire more business
  // row locks after publishing events. The counter lock serializes commit order.
  const { rows } = await client.query(
    `WITH allocated AS (UPDATE sync_state SET cursor = cursor + 1 WHERE singleton RETURNING cursor)
     INSERT INTO sync_events (id, user_id, event_type, entity_type, entity_id, thread_id)
     SELECT cursor, $1, $2, $3, $4, $5 FROM allocated
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
  for (const userId of [...new Set(userIds.filter(value => value === null || Boolean(value)))]) {
    events.push(await createSyncEvent(client, { userId, eventType, entityType, entityId, threadId }));
  }
  return events;
}

export async function loadSyncPayload(userId, { cursor, limit } = {}) {
  const safeCursor = normalizeCursor(cursor);
  const safeLimit = normalizeLimit(limit);
  // State and events share a single MVCC snapshot, including concurrent pruning.
  const snapshot = await query(
    `SELECT s.cursor::text AS current_cursor, s.pruned_through::text, e.*
     FROM sync_state s LEFT JOIN LATERAL (
       SELECT id::text, user_id, event_type, entity_type, entity_id, thread_id, created_at
       FROM sync_events WHERE (user_id = $1 OR user_id IS NULL) AND id > $2::bigint
       ORDER BY sync_events.id ASC LIMIT $3
     ) e ON true WHERE s.singleton ORDER BY e.id::bigint ASC`,
    [userId, safeCursor, safeLimit + 1]
  );
  const state = snapshot.rows[0];
  if (BigInt(safeCursor) < BigInt(state.pruned_through) || BigInt(safeCursor) > BigInt(state.current_cursor)) {
    return { nextCursor: state.current_cursor, hasMore: false, resetRequired: true, events: [], messageThreads: [] };
  }
  const eventsResult = { rows: snapshot.rows.filter(row => row.id != null) };
  const rows = eventsResult.rows.slice(0, safeLimit);
  const hasMore = eventsResult.rows.length > safeLimit;
  const events = rows.map(syncEventToClient);
  const nextCursor = rows.length ? rows[rows.length - 1].id : state.current_cursor;
  if (!rows.length) return { nextCursor, hasMore: false, events: [], messageThreads: [] };
  const messageIdsByThread = {};
  for (const event of rows) if (event.thread_id && event.entity_type === "direct_message") {
    (messageIdsByThread[event.thread_id] ||= []).push(event.entity_id);
  }
  const threadIds = rows.map((row) => row.thread_id).filter(Boolean);
  const commentIds = unique(rows.filter((row) => row.entity_type === "comment").map((row) => row.entity_id));
  const initialPostIds = unique(rows.filter((row) => row.entity_type === "post").map((row) => row.entity_id));
  const initialCollectionIds = unique(rows.filter((row) => row.entity_type === "collection").map((row) => row.entity_id));
  const initialUserIds = unique(rows.filter((row) => row.entity_type === "user").map((row) => row.entity_id));

  const [messageThreads, unread, comments, relationships] = await Promise.all([
    loadMessageThreadsForUser({ query }, threadIds, userId, messageIdsByThread),
    threadIds.length || rows.some(row => row.event_type === "user.deleted" || row.entity_type === "safety_visibility") ? loadUnreadSnapshot(userId) : {},
    loadCommentsForSync(userId, commentIds),
    rows.some(row => row.entity_type === "user" || /liked|favorit|follow|block/.test(row.event_type)) ? loadRelationshipState(userId) : {}
  ]);
  const postIds = unique([...initialPostIds, ...comments.map((comment) => comment.postID)]);
  const posts = await loadPostsForSync(userId, postIds);
  const collectionIds = unique([...initialCollectionIds, ...posts.map((post) => post.collectionID).filter(Boolean)]);
  const collections = await loadCollectionsForSync(userId, collectionIds);
  const userIds = unique([
    ...initialUserIds,
    ...messageThreads.flatMap(thread => [thread.buyerUserID, thread.publisherUserID]),
    ...messageThreads.flatMap(thread => thread.messages.map(message => message.senderID)),
    ...posts.map((post) => post.authorID),
    ...comments.map((comment) => comment.authorID),
    ...collections.map((collection) => collection.ownerID)
  ]);
  const users = await loadUsersForSync(userId, userIds);
  const reportIds = unique(rows.filter(row => row.entity_type === "report").map(row => row.entity_id));
  const caseIds = unique(rows.filter(row => row.entity_type === "safety_case").map(row => row.entity_id));
  const reports = reportIds.length || caseIds.length ? (await query("SELECT r.*, sc.status AS case_status FROM reports r LEFT JOIN safety_cases sc ON sc.id=r.case_id WHERE (r.id=ANY($1::text[]) OR r.case_id=ANY($3::text[])) AND r.reporter_id=$2", [reportIds, userId, caseIds])).rows.map(row => safetyReportToBootstrapClient(row, userId)) : [];

  return {
    nextCursor,
    hasMore,
    events,
    users,
    reports,
    removedUserIDs: initialUserIds.filter(id => !users.some(user => user.id === id)),
    posts,
    removedPostIDs: postIds.filter(id => !posts.some(post => post.id === id)),
    collections,
    removedCollectionIDs: collectionIds.filter(id => !collections.some(collection => collection.id === id)),
    comments,
    removedCommentIDs: commentIds.filter(id => !comments.some(comment => comment.id === id)),
    contentRefreshRequired: rows.some(row => ["collection", "safety_visibility"].includes(row.entity_type) || ["user.blocked", "user.unblocked", "user.deleted"].includes(row.event_type)),
    messageThreads,
    ...unread,
    ...relationships
  };
}

function normalizeCursor(value) {
  const text = String(value ?? "0").trim();
  if (!/^\d{1,19}$/.test(text) || BigInt(text) > 9223372036854775807n) return "0";
  return text;
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(String(value ?? DEFAULT_SYNC_LIMIT), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SYNC_LIMIT;
  return Math.min(parsed, MAX_SYNC_LIMIT);
}

async function loadUsersForSync(viewerUserId, userIds) {
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
  return rows.map((row) => userToClient(row, row, viewerUserId));
}

async function loadPostsForSync(userId, postIds) {
  const ids = unique(postIds);
  if (!ids.length) return [];
  const { rows } = await query(
    `SELECT p.*,
        (SELECT mr.reason FROM moderation_reviews mr WHERE mr.target_type = 'post' AND mr.target_id = p.id ORDER BY mr.created_at DESC LIMIT 1) AS moderation_reason,
        (SELECT mr.id FROM moderation_reviews mr WHERE mr.target_type = 'post' AND mr.target_id = p.id ORDER BY mr.created_at DESC LIMIT 1) AS review_id
      FROM posts p
      WHERE p.id = ANY($2::text[])
        AND ${visiblePostSQL("p", "$1", true)}
      ORDER BY p.created_at DESC`,
    [userId, ids]
  );
  const posts = await attachPostCounts(rows);
  return posts.map((row) => postToClient(row, row));
}

async function loadCollectionsForSync(userId, collectionIds) {
  const ids = unique(collectionIds);
  if (!ids.length) return [];
  const { rows } = await query(
    `SELECT c.*,
        ARRAY(SELECT p.id FROM posts p WHERE p.collection_id=c.id AND ${visiblePostSQL("p", "$1", true)} ORDER BY p.created_at DESC,p.id DESC LIMIT 50) AS post_ids,
        (SELECT count(*) FROM posts p WHERE p.collection_id=c.id AND ${visiblePostSQL("p", "$1", true)}) AS post_count
      FROM group_collections c
      WHERE c.id = ANY($2::text[])
        AND ${visibleCollectionSQL("c", "$1", true)}
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
        AND ${visibleCommentSQL("cm", "$1", true)}
      ORDER BY cm.created_at ASC`,
    [userId, ids]
  );
  return rows.map(commentToClient);
}

async function loadRelationshipState(userId) {
  const [likedResult, favoriteResult, followedResult, followsResult, blockedResult, blockedByResult] = await Promise.all([
    query(`SELECT r.post_id FROM post_likes r JOIN posts p ON p.id=r.post_id WHERE r.user_id=$1 AND ${visiblePostSQL("p", "$1", true)}`, [userId]),
    query(`SELECT r.post_id FROM post_favorites r JOIN posts p ON p.id=r.post_id WHERE r.user_id=$1 AND ${visiblePostSQL("p", "$1", true)}`, [userId]),
    query("SELECT following_id FROM follows WHERE follower_id = $1", [userId]),
    query("SELECT follower_id, following_id FROM follows WHERE follower_id = $1 OR following_id = $1", [userId]),
    query("SELECT blocked_id FROM user_blocks WHERE blocker_id = $1", [userId]),
    query("SELECT blocker_id FROM user_blocks WHERE blocked_id = $1", [userId])
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
    followingByUserID,
    blockedUserIDs: blockedResult.rows.map((row) => row.blocked_id),
    blockedByUserIDs: blockedByResult.rows.map((row) => row.blocker_id)
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

export async function pruneOldSyncEvents(retentionDays = SYNC_EVENT_RETENTION_DAYS) {
  const days = Math.max(1, Number(retentionDays) || SYNC_EVENT_RETENTION_DAYS);
  return withTransaction(async client => {
    // Lock the counter first, then prune. No publisher can allocate during this transaction.
    await client.query("SELECT cursor FROM sync_state WHERE singleton FOR UPDATE");
    const { rows } = await client.query(`WITH removed AS (
      DELETE FROM sync_events WHERE created_at < now() - ($1::text)::interval RETURNING id
    ) SELECT count(*)::int AS count, COALESCE(max(id), 0)::text AS last FROM removed`, [`${days} days`]);
    await client.query("UPDATE sync_state SET pruned_through = GREATEST(pruned_through, $1::bigint) WHERE singleton", [rows[0].last]);
    return rows[0].count;
  });
}

export function startSyncEventPruner({ intervalMs = SYNC_EVENT_PRUNE_INTERVAL_MS } = {}) {
  const run = () => {
    pruneOldSyncEvents().catch((error) => {
      logger.error("sync_events.prune_failed", { error });
    });
  };
  run();
  return setInterval(run, intervalMs);
}

import { badRequest } from "../validators.js";
import { COLLECTION_SHARED_FIELDS } from "./constants.js";

const TARGET_NOT_VISIBLE = "举报目标不存在或不可见";
const SELF_REPORT = "不能举报自己的内容";
const CONTACT_FIELDS = new Set(["contact_wechat", "contact_qq", "contact_group_number"]);

export async function resolveReportSubject(client, input = {}) {
  const sourceType = input.sourceType;
  const sourceId = input.sourceId ?? input.sourceID;
  const reporterId = normalizeReporterId(input.reporterId);

  switch (sourceType) {
    case "post":
      return resolvePost(client, sourceId, input, reporterId);
    case "comment":
      return resolveComment(client, sourceId, reporterId);
    case "user":
      return resolveUser(client, sourceId, reporterId);
    case "direct_message":
      return resolveDirectMessage(client, sourceId, reporterId);
    case "collection":
      return resolveCollection(client, sourceId, input, reporterId);
    default:
      throw targetNotVisible();
  }
}

async function resolvePost(client, sourceId, input, reporterId) {
  const { rows } = await client.query(
    `SELECT *
     FROM posts_with_safety_context
     WHERE id = $1`,
    [sourceId]
  );
  const post = rows[0];
  if (!post || !isActivePost(post)) throw targetNotVisible();
  if (COLLECTION_SHARED_FIELDS.has(input.reportedField) && !post.collection_id) throw targetNotVisible();
  if (CONTACT_FIELDS.has(input.reportedField) && post.collection_contact_visibility !== "active") {
    throw targetNotVisible();
  }

  const collectionScoped = COLLECTION_SHARED_FIELDS.has(input.reportedField);
  const ownerId = collectionScoped ? await collectionOwner(client, post.collection_id) : post.author_id;
  await assertReporterAccess(client, reporterId, ownerId, post.collection_id, post.collection_status, post.collection_safety_status);
  return {
    subjectType: collectionScoped ? "collection" : "post",
    subjectId: collectionScoped ? post.collection_id : post.id,
    impactScope: collectionScoped ? "collection" : "post",
    ownerId
  };
}

async function resolveComment(client, sourceId, reporterId) {
  const { rows } = await client.query(
    `SELECT cm.*, p.status AS post_status, p.safety_status AS post_safety_status,
            p.collection_id, p.collection_status, p.collection_safety_status
     FROM comments cm
     JOIN posts_with_safety_context p ON p.id = cm.post_id
     WHERE cm.id = $1`,
    [sourceId]
  );
  const comment = rows[0];
  if (!comment || comment.status !== "active" || comment.safety_status !== "active" ||
      comment.post_status !== "active" || comment.post_safety_status !== "active" ||
      comment.collection_status !== "active" || comment.collection_safety_status !== "active") {
    throw targetNotVisible();
  }

  await assertReporterAccess(client, reporterId, comment.author_id, comment.collection_id, comment.collection_status, comment.collection_safety_status);
  return { subjectType: "comment", subjectId: comment.id, impactScope: "comment", ownerId: comment.author_id };
}

async function resolveUser(client, sourceId, reporterId) {
  const { rows } = await client.query(
    "SELECT id, status, deleted_at FROM users WHERE id = $1",
    [sourceId]
  );
  const user = rows[0];
  if (!user || user.status !== "active" || user.deleted_at) throw targetNotVisible();
  await assertReporterAccess(client, reporterId, user.id);
  return { subjectType: "user", subjectId: user.id, impactScope: "user", ownerId: user.id };
}

async function resolveDirectMessage(client, sourceId, reporterId) {
  const { rows } = await client.query(
    `SELECT dm.*, mt.buyer_user_id, mt.publisher_user_id,
            sender.status AS sender_status, sender.deleted_at AS sender_deleted_at
     FROM direct_messages dm
     JOIN message_threads mt ON mt.id = dm.thread_id
     JOIN users sender ON sender.id = dm.sender_id
     WHERE dm.id = $1`,
    [sourceId]
  );
  const message = rows[0];
  if (!message || message.safety_status !== "active" || message.revoked_at ||
      message.sender_status !== "active" || message.sender_deleted_at) {
    throw targetNotVisible();
  }

  if (message.sender_id === reporterId) throw badRequest(SELF_REPORT);
  const otherParticipantId = otherDirectMessageParticipant(message, reporterId);
  if (!otherParticipantId || message.sender_id !== otherParticipantId ||
      (message.deleted_for_user_ids || []).includes(reporterId)) {
    throw targetNotVisible();
  }
  await assertReporterAccess(client, reporterId, message.sender_id);

  return {
    subjectType: "direct_message",
    subjectId: message.id,
    impactScope: "direct_message",
    ownerId: message.sender_id
  };
}

async function resolveCollection(client, sourceId, input, reporterId) {
  const { rows } = await client.query(
    "SELECT id, owner_id, status, safety_status, contact_visibility FROM group_collections WHERE id = $1",
    [sourceId]
  );
  const collection = rows[0];
  if (!collection || collection.status !== "active" || collection.safety_status !== "active") {
    throw targetNotVisible();
  }
  if (CONTACT_FIELDS.has(input.reportedField) && collection.contact_visibility !== "active") {
    throw targetNotVisible();
  }
  await assertReporterAccess(client, reporterId, collection.owner_id);
  return {
    subjectType: "collection",
    subjectId: collection.id,
    impactScope: "collection",
    ownerId: collection.owner_id
  };
}

async function assertReporterAccess(client, reporterId, ownerId, collectionId = null, collectionStatus = "active", collectionSafetyStatus = "active") {
  if (reporterId === ownerId) throw badRequest(SELF_REPORT);
  if (collectionId && (collectionStatus !== "active" || collectionSafetyStatus !== "active")) {
    throw targetNotVisible();
  }

  const { rows } = await client.query(
    `SELECT 1
     FROM user_blocks
     WHERE (blocker_id = $1 AND blocked_id = $2)
        OR (blocker_id = $2 AND blocked_id = $1)
     LIMIT 1`,
    [reporterId, ownerId]
  );
  if (rows[0]) throw targetNotVisible();
}

async function collectionOwner(client, collectionId) {
  const { rows } = await client.query(
    `SELECT owner_id
     FROM group_collections
     WHERE id = $1
       AND status = 'active'
       AND safety_status = 'active'`,
    [collectionId]
  );
  if (!rows[0]) throw targetNotVisible();
  return rows[0].owner_id;
}

function isActivePost(post) {
  return post.status === "active" && post.safety_status === "active" &&
    post.collection_status === "active" && post.collection_safety_status === "active";
}

function otherDirectMessageParticipant(message, reporterId) {
  if (message.buyer_user_id === reporterId) return message.publisher_user_id;
  if (message.publisher_user_id === reporterId) return message.buyer_user_id;
  return null;
}

function normalizeReporterId(reporterId) {
  if (typeof reporterId !== "string") throw targetNotVisible();
  const trimmed = reporterId.trim();
  if (!trimmed) throw targetNotVisible();
  return trimmed;
}

function targetNotVisible() {
  return badRequest(TARGET_NOT_VISIBLE);
}

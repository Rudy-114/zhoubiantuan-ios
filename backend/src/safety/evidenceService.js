import { badRequest } from "../validators.js";

const TARGET_NOT_VISIBLE = "举报目标不存在或不可见";
const SOURCE_TYPES = new Set(["post", "comment", "user", "direct_message", "collection"]);
const TRANSACTION_PROBE_SAVEPOINT = "capture_source_evidence_probe";

/**
 * Capture immutable source evidence using a PoolClient after the caller has begun a transaction.
 * The caller owns COMMIT/ROLLBACK; this service never opens or ends the transaction.
 */
export async function captureSourceEvidence(client, { reporterId, sourceType, sourceId } = {}) {
  assertTransactionScopedClient(client);
  await assertActiveTransaction(client);
  const reporter = requiredId(reporterId);
  const source = requiredId(sourceId);
  if (!SOURCE_TYPES.has(sourceType)) throw targetNotVisible();

  switch (sourceType) {
    case "direct_message":
      return captureDirectMessageEvidence(client, reporter, source);
    case "post":
      return capturePostEvidence(client, source);
    case "comment":
      return captureCommentEvidence(client, source);
    case "user":
      return captureUserEvidence(client, source);
    case "collection":
      return captureCollectionEvidence(client, source);
    default:
      throw targetNotVisible();
  }
}

function assertTransactionScopedClient(client) {
  if (!client || typeof client.query !== "function" || typeof client.release !== "function") {
    throw new TypeError("captureSourceEvidence requires a transaction-scoped pg PoolClient; caller must BEGIN and own COMMIT/ROLLBACK");
  }
}

async function assertActiveTransaction(client) {
  try {
    await client.query(`SAVEPOINT ${TRANSACTION_PROBE_SAVEPOINT}`);
    await client.query(`RELEASE SAVEPOINT ${TRANSACTION_PROBE_SAVEPOINT}`);
  } catch (error) {
    const developerError = new TypeError("captureSourceEvidence requires an active transaction; caller must BEGIN before invoking it");
    developerError.cause = error;
    throw developerError;
  }
}

async function captureDirectMessageEvidence(client, reporterId, sourceId) {
  const { rows } = await client.query(
    `SELECT dm.id, dm.thread_id, dm.sender_id, dm.body, dm.revoked_at, dm.deleted_for_user_ids,
            dm.safety_status, mt.buyer_user_id, mt.publisher_user_id
     FROM direct_messages dm
     JOIN message_threads mt ON mt.id = dm.thread_id
     WHERE dm.id = $1
     FOR UPDATE OF dm, mt`,
    [sourceId]
  );
  const target = rows[0];
  if (!target || target.safety_status !== "active" || target.revoked_at ||
      (target.deleted_for_user_ids || []).includes(reporterId)) {
    throw targetNotVisible();
  }

  const participantIds = [target.buyer_user_id, target.publisher_user_id];
  if (!participantIds.includes(reporterId) || target.sender_id === reporterId) {
    throw targetNotVisible();
  }
  const otherParticipantId = participantIds.find((id) => id !== reporterId);
  if (!otherParticipantId || target.sender_id !== otherParticipantId) {
    throw targetNotVisible();
  }
  const participantUsers = await client.query(
    `SELECT id, status, deleted_at
     FROM users
     WHERE id = ANY($1::text[])
     ORDER BY id
     FOR SHARE`,
    [participantIds]
  );
  const sender = participantUsers.rows.find((user) => user.id === target.sender_id);
  if (participantUsers.rows.length !== new Set(participantIds).size ||
      !sender || sender.status !== "active" || sender.deleted_at) {
    throw targetNotVisible();
  }

  const contextResult = await client.query(
    `WITH ordered AS (
       SELECT dm.*,
              row_number() OVER (PARTITION BY dm.thread_id ORDER BY dm.created_at, dm.id) AS position
       FROM direct_messages dm
       WHERE dm.thread_id = $1
     ), target AS (
       SELECT position FROM ordered WHERE id = $2
     )
     SELECT ordered.id, ordered.sender_id, ordered.body, ordered.image_object_key,
            ordered.shared_post_id, ordered.shared_profile_user_id,
            ordered.revoked_at, ordered.created_at, ordered.safety_status
     FROM ordered, target
     WHERE ordered.position BETWEEN target.position - 3 AND target.position + 3
     ORDER BY ordered.position`,
    [target.thread_id, sourceId]
  );
  const messages = contextResult.rows.map((message) => ({
    id: message.id,
    senderId: message.sender_id,
    body: message.body || "",
    imageObjectKey: message.image_object_key || null,
    sharedPostId: message.shared_post_id || null,
    sharedProfileUserId: message.shared_profile_user_id || null,
    revokedAt: isoDate(message.revoked_at),
    safetyStatus: message.safety_status,
    createdAt: isoDate(message.created_at),
    isTarget: message.id === sourceId
  }));
  if (!messages.length) throw targetNotVisible();

  return evidence({
    evidenceType: "direct_message",
    textSnapshot: target.body || "",
    structuredSnapshot: { messages },
    objectKeys: uniqueObjectKeys(messages.map((message) => message.imageObjectKey)),
    ownerId: target.sender_id,
    contextStartMessageId: messages[0].id,
    contextEndMessageId: messages[messages.length - 1].id
  });
}

async function capturePostEvidence(client, sourceId) {
  const { rows } = await client.query(
    `SELECT p.id, p.title, p.description, p.price, p.deposit, p.pinggu_average_price, p.pinggu_note,
            p.image_object_keys, p.author_id, p.collection_id, p.wechat, p.qq, p.group_number,
            p.group_info, p.deadline, p.created_at, p.updated_at, p.status, p.safety_status,
            c.status AS collection_status, c.safety_status AS collection_safety_status,
            c.default_note AS collection_default_note
     FROM posts p
     LEFT JOIN group_collections c ON c.id = p.collection_id
     WHERE p.id = $1
     FOR SHARE OF p`,
    [sourceId]
  );
  const post = rows[0];
  if (!post || post.status !== "active" || post.safety_status !== "active" ||
      (post.collection_id && (post.collection_status !== "active" || post.collection_safety_status !== "active"))) {
    throw targetNotVisible();
  }

  return evidence({
    evidenceType: "post",
    textSnapshot: joinText(post.title, post.description, post.price, post.deposit, post.pinggu_average_price),
    structuredSnapshot: {
      id: post.id,
      title: post.title,
      description: post.description,
      price: post.price,
      deposit: post.deposit,
      pingguAveragePrice: post.pinggu_average_price,
      pingguNote: post.pinggu_note,
      imageObjectKeys: uniqueObjectKeys(post.image_object_keys),
      authorId: post.author_id,
      collectionId: post.collection_id,
      wechat: post.wechat,
      qq: post.qq,
      groupNumber: post.group_number,
      groupInfo: post.group_info,
      deadline: isoDate(post.deadline),
      collectionDefaultNote: post.collection_default_note,
      createdAt: isoDate(post.created_at),
      updatedAt: isoDate(post.updated_at),
      status: post.status,
      safetyStatus: post.safety_status
    },
    objectKeys: post.image_object_keys,
    ownerId: post.author_id
  });
}

async function captureCommentEvidence(client, sourceId) {
  const { rows } = await client.query(
    `SELECT cm.id, cm.body, cm.author_id, cm.post_id, cm.reply_to_id, cm.created_at,
            cm.status, cm.safety_status, p.status AS post_status, p.safety_status AS post_safety_status,
            c.id AS collection_id, c.status AS collection_status, c.safety_status AS collection_safety_status
     FROM comments cm
     JOIN posts p ON p.id = cm.post_id
     LEFT JOIN group_collections c ON c.id = p.collection_id
     WHERE cm.id = $1
     FOR SHARE OF cm`,
    [sourceId]
  );
  const comment = rows[0];
  if (!comment || comment.status !== "active" || comment.safety_status !== "active" ||
      comment.post_status !== "active" || comment.post_safety_status !== "active" ||
      (comment.collection_id && (comment.collection_status !== "active" || comment.collection_safety_status !== "active"))) {
    throw targetNotVisible();
  }

  return evidence({
    evidenceType: "comment",
    textSnapshot: comment.body || "",
    structuredSnapshot: {
      id: comment.id,
      body: comment.body,
      authorId: comment.author_id,
      postId: comment.post_id,
      replyToId: comment.reply_to_id,
      createdAt: isoDate(comment.created_at),
      status: comment.status,
      safetyStatus: comment.safety_status
    },
    objectKeys: [],
    ownerId: comment.author_id
  });
}

async function captureUserEvidence(client, sourceId) {
  const { rows } = await client.query(
    `SELECT id, nickname, bio, avatar_object_key, background_object_key,
            created_at, is_restricted, can_show_contact, status, deleted_at
     FROM users
     WHERE id = $1
     FOR SHARE`,
    [sourceId]
  );
  const user = rows[0];
  if (!user || user.status !== "active" || user.deleted_at) throw targetNotVisible();

  return evidence({
    evidenceType: "user",
    textSnapshot: joinText(user.nickname, user.bio),
    structuredSnapshot: {
      id: user.id,
      nickname: user.nickname,
      bio: user.bio,
      avatarObjectKey: user.avatar_object_key,
      backgroundObjectKey: user.background_object_key,
      createdAt: isoDate(user.created_at),
      isRestricted: user.is_restricted,
      canShowContact: user.can_show_contact,
      status: user.status
    },
    objectKeys: [user.avatar_object_key, user.background_object_key],
    ownerId: user.id
  });
}

async function captureCollectionEvidence(client, sourceId) {
  const { rows } = await client.query(
    `SELECT id, owner_id, name, contact_wechat, contact_qq, contact_group_number,
            group_info, deadline, default_note, status, safety_status, contact_visibility,
            created_at, updated_at
     FROM group_collections
     WHERE id = $1
     FOR SHARE`,
    [sourceId]
  );
  const collection = rows[0];
  if (!collection || collection.status !== "active" || collection.safety_status !== "active") {
    throw targetNotVisible();
  }

  return evidence({
    evidenceType: "collection",
    textSnapshot: joinText(collection.name, collection.group_info, collection.default_note),
    structuredSnapshot: {
      id: collection.id,
      name: collection.name,
      contactWechat: collection.contact_wechat,
      contactQQ: collection.contact_qq,
      contactGroupNumber: collection.contact_group_number,
      groupInfo: collection.group_info,
      deadline: isoDate(collection.deadline),
      defaultNote: collection.default_note,
      ownerId: collection.owner_id,
      status: collection.status,
      safetyStatus: collection.safety_status,
      contactVisibility: collection.contact_visibility,
      createdAt: isoDate(collection.created_at),
      updatedAt: isoDate(collection.updated_at)
    },
    objectKeys: [],
    ownerId: collection.owner_id
  });
}

function evidence({ evidenceType, textSnapshot, structuredSnapshot, objectKeys, ownerId, contextStartMessageId = null, contextEndMessageId = null }) {
  return {
    evidenceType,
    textSnapshot: textSnapshot || "",
    structuredSnapshot,
    objectKeys: uniqueObjectKeys(objectKeys),
    ownerId,
    contextStartMessageId,
    contextEndMessageId,
    retentionDeleteAt: null
  };
}

function requiredId(value) {
  if (typeof value !== "string" || !value.trim()) throw targetNotVisible();
  return value.trim();
}

function targetNotVisible() {
  return badRequest(TARGET_NOT_VISIBLE);
}

function joinText(...values) {
  return values.filter((value) => value !== null && value !== undefined && String(value) !== "").join("\n");
}

function uniqueObjectKeys(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === "string" && value))];
}

function isoDate(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

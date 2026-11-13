import { randomUUID } from "node:crypto";
import { assertOwnedObjectKeys } from "../moderation/index.js";
import { assertReadyUploads } from "../uploads.js";
import { badRequest } from "../validators.js";
import { enqueueSafetyJob } from "./jobQueue.js";
import { claimReportUploadsForAttachment } from "./reportUploadCleanup.js";
import { publishApprovedRevision } from "./revisionPublishing.js";
import { reviewContentRevision } from "./revisionReview.js";
import { collectionRevisionSnapshot, postRevisionSnapshot } from "./revisionValidation.js";
import { lockSafetyTarget } from "./safetyTargetLock.js";

const ACTIVE_REVISION_STATUSES = ["pending", "reviewing", "approved"];
const TRANSACTION_PROBE = "submit_content_revision_probe";
const MAX_REVISION_OBJECT_KEYS = 6;
const MAX_OBJECT_KEY_LENGTH = 1024;
const UNSAFE_OBJECT_KEY_CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

export async function submitContentRevision(client, input = {}) {
  assertTransactionClient(client);
  await assertActiveTransaction(client);
  const { caseId, ownerId, snapshot, objectKeys = [] } = input || {};
  const caseMetadata = await loadSafetyCaseMetadata(client, caseId);
  await lockSafetyTarget(client, caseMetadata.subject_type, caseMetadata.subject_id);
  const safetyCase = await lockSafetyCase(client, caseMetadata);
  await lockAndAuthorizeTarget(client, safetyCase, ownerId);

  const activeRevision = await lockActiveRevision(client, safetyCase.id);
  if (activeRevision) throw conflict("已有整改版本正在处理中", "revision_in_progress");
  if (safetyCase.status !== "awaiting_correction") {
    throw conflict("当前案件未要求整改", "correction_not_requested");
  }

  const normalizedSnapshot = safetyCase.subject_type === "post"
    ? await postRevisionSnapshot(client, safetyCase.subject_id, ownerId, snapshot)
    : await collectionRevisionSnapshot(client, safetyCase.subject_id, ownerId, snapshot);
  const normalizedObjectKeys = normalizeObjectKeys(ownerId, objectKeys);
  const existing = safetyCase.subject_type === 'post'
    ? (await client.query('SELECT image_object_keys, preview_image_object_keys FROM posts WHERE id=$1', [safetyCase.subject_id])).rows[0]
    : null;
  await assertReadyUploads(ownerId, [
    ...(normalizedSnapshot.imageObjectKeys || []), ...(normalizedSnapshot.previewImageObjectKeys || []),
    ...normalizedObjectKeys.filter(key => !key.startsWith('report/'))
  ], client, { retainKeys: [...(existing?.image_object_keys || []), ...(existing?.preview_image_object_keys || [])], markReferenced: true });
  await claimReportUploads(client, ownerId, normalizedObjectKeys);
  const revisionNumber = await nextRevisionNumber(client, safetyCase.subject_type, safetyCase.subject_id);
  const revision = await insertRevision(client, {
    caseId: safetyCase.id,
    targetType: safetyCase.subject_type,
    targetId: safetyCase.subject_id,
    ownerId,
    revisionNumber,
    snapshot: normalizedSnapshot,
    objectKeys: normalizedObjectKeys
  });

  await enqueueSafetyJob(client, {
    type: "review_revision",
    caseId: safetyCase.id,
    uniqueKey: `review_revision:${revision.id}`,
    payload: { revisionId: revision.id }
  });
  await client.query(
    "UPDATE safety_cases SET status = 'rechecking', updated_at = now() WHERE id = $1",
    [safetyCase.id]
  );
  await client.query(
    `INSERT INTO safety_case_events (case_id, actor_type, actor_id, event_type, event_data)
     VALUES ($1, 'owner', $2, 'revision.submitted', $3::jsonb)`,
    [safetyCase.id, ownerId, JSON.stringify({ revisionId: revision.id, revisionNumber })]
  );
  return revision;
}

export {
  collectionRevisionSnapshot,
  postRevisionSnapshot,
  publishApprovedRevision,
  reviewContentRevision
};

function assertTransactionClient(client) {
  if (!client || typeof client.query !== "function" || typeof client.release !== "function") {
    throw new TypeError(
      "submitContentRevision requires a transaction-scoped pg PoolClient; caller must BEGIN and own COMMIT/ROLLBACK"
    );
  }
}

async function assertActiveTransaction(client) {
  try {
    await client.query(`SAVEPOINT ${TRANSACTION_PROBE}`);
    await client.query(`RELEASE SAVEPOINT ${TRANSACTION_PROBE}`);
  } catch (error) {
    const developerError = new TypeError(
      "submitContentRevision requires an active transaction; caller must BEGIN before invoking it"
    );
    developerError.cause = error;
    throw developerError;
  }
}

async function loadSafetyCaseMetadata(client, caseId) {
  if (!caseId || typeof caseId !== "string") throw badRequest("案件 ID 不能为空");
  const { rows } = await client.query(
    "SELECT id, subject_type, subject_id FROM safety_cases WHERE id = $1",
    [caseId]
  );
  if (!rows[0]) throw httpError(404, "整改案件不存在", "safety_case_not_found");
  return rows[0];
}

async function lockSafetyCase(client, metadata) {
  const { rows } = await client.query("SELECT * FROM safety_cases WHERE id = $1 FOR UPDATE", [metadata.id]);
  if (!rows[0]) throw httpError(404, "整改案件不存在", "safety_case_not_found");
  if (rows[0].subject_type !== metadata.subject_type || rows[0].subject_id !== metadata.subject_id) {
    throw conflict("整改案件目标已变化", "revision_target_changed");
  }
  return rows[0];
}

async function lockAndAuthorizeTarget(client, safetyCase, ownerId) {
  let queryText;
  if (safetyCase.subject_type === "post") {
    queryText = "SELECT author_id AS owner_id FROM posts WHERE id = $1 FOR UPDATE";
  } else if (safetyCase.subject_type === "collection") {
    queryText = "SELECT owner_id FROM group_collections WHERE id = $1 FOR UPDATE";
  } else {
    throw badRequest("该内容类型不支持提交整改", "unsupported_revision_target");
  }
  const { rows } = await client.query(queryText, [safetyCase.subject_id]);
  if (!rows[0]) throw httpError(404, "整改目标不存在", "revision_target_not_found");
  if (!ownerId || rows[0].owner_id !== ownerId) throw httpError(403, "无权提交该内容的整改");
}

async function lockActiveRevision(client, caseId) {
  const { rows } = await client.query(
    `SELECT * FROM content_revisions
     WHERE case_id = $1 AND status = ANY($2::text[])
     ORDER BY created_at DESC, id DESC
     LIMIT 1
     FOR UPDATE`,
    [caseId, ACTIVE_REVISION_STATUSES]
  );
  return rows[0] || null;
}

function normalizeObjectKeys(ownerId, objectKeys) {
  if (!Array.isArray(objectKeys)) throw badRequest("整改附件必须是数组");
  if (objectKeys.length > MAX_REVISION_OBJECT_KEYS) {
    throw badRequest(`整改附件最多包含 ${MAX_REVISION_OBJECT_KEYS} 项`);
  }
  const normalized = [];
  for (const item of objectKeys) {
    if (typeof item !== "string") throw badRequest("整改附件必须只包含字符串");
    if (UNSAFE_OBJECT_KEY_CONTROL_CHARACTERS.test(item)) throw badRequest("整改附件包含不支持的控制字符");
    const key = item.trim();
    if (!key) throw badRequest("整改附件不能为空");
    if (Array.from(key).length > MAX_OBJECT_KEY_LENGTH) {
      throw badRequest(`整改附件单项不能超过 ${MAX_OBJECT_KEY_LENGTH} 个字符`);
    }
    normalized.push(key);
  }
  return [...new Set(assertOwnedObjectKeys(ownerId, normalized, ["report", "post"]))];
}

async function claimReportUploads(client, ownerId, objectKeys) {
  const reportObjectKeys = objectKeys.filter((key) => key.startsWith("report/"));
  try {
    await claimReportUploadsForAttachment(client, { ownerUserID: ownerId, objectKeys: reportObjectKeys });
  } catch (error) {
    if (error?.apiCode === "report_upload_unavailable") {
      throw httpError(400, error.message, error.apiCode);
    }
    throw error;
  }
}

async function nextRevisionNumber(client, targetType, targetId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(revision_number), 0)::int + 1 AS revision_number
     FROM content_revisions
     WHERE target_type = $1 AND target_id = $2`,
    [targetType, targetId]
  );
  return rows[0].revision_number;
}

async function insertRevision(client, input) {
  const { rows } = await client.query(
    `INSERT INTO content_revisions (
       id, case_id, target_type, target_id, owner_id, revision_number, snapshot, object_keys, status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, 'pending')
     RETURNING *`,
    [
      `cr-${randomUUID()}`, input.caseId, input.targetType, input.targetId, input.ownerId,
      input.revisionNumber, JSON.stringify(input.snapshot), input.objectKeys
    ]
  );
  return rows[0];
}

function conflict(message, apiCode) {
  return httpError(409, message, apiCode);
}

function httpError(status, message, apiCode) {
  const error = new Error(message);
  error.status = status;
  if (apiCode) error.apiCode = apiCode;
  return error;
}

import { randomUUID } from "node:crypto";
import { createSyncEvent } from "../sync.js";
import { badRequest } from "../validators.js";
import { claimReportUploadsForAttachment } from "./reportUploadCleanup.js";
import { lockSafetyTarget } from "./safetyTargetLock.js";

const TRANSACTION_PROBE = "submit_safety_appeal_probe";
const MAX_APPEAL_DETAIL_LENGTH = 1000;
const MAX_APPEAL_OBJECT_KEYS = 6;
const MAX_OBJECT_KEY_LENGTH = 512;
const UNSAFE_CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;
const UNSAFE_MULTILINE_CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export const APPEAL_WINDOW_SQL = `
  a.applied_at >= transaction_timestamp() - interval '7 days'
  AND a.applied_at <= transaction_timestamp()
`;

export async function submitSafetyAppeal(client, input = {}) {
  assertTransactionClient(client);
  await assertActiveTransaction(client);
  const appealInput = normalizeAppealInput(input);
  const metadata = await loadCaseMetadata(client, appealInput.caseId);
  if (!["post", "collection"].includes(metadata.subject_type)) {
    throw badRequest("该内容类型不支持申诉", "unsupported_appeal_target");
  }

  await lockSafetyTarget(client, metadata.subject_type, metadata.subject_id);
  const safetyCase = await lockAndRevalidateCase(client, metadata);
  await lockAndAuthorizeTarget(client, safetyCase, appealInput.ownerId);
  const decision = await lockLatestFinalDecision(client, safetyCase);
  if (!decision) throw conflict("当前没有可申诉的人工处理决定", "appeal_not_available");

  const existingAppeal = await lockExistingAppeal(client, decision.id);
  if (existingAppeal) throw conflict("该处理决定已提交过申诉", "appeal_already_submitted");
  if (safetyCase.status !== "resolved_actioned") {
    throw conflict("当前案件状态不支持申诉", "appeal_not_available");
  }
  if (!decision.appeal_window_open) {
    throw conflict("申诉期限已结束或尚未开始", "appeal_window_closed");
  }

  await claimReportUploadsForAttachment(client, {
    ownerUserID: appealInput.ownerId,
    objectKeys: appealInput.objectKeys
  });
  const appeal = await insertAppeal(client, {
    ...appealInput,
    decisionActionId: decision.id
  });
  const eventData = { appealId: appeal.id, decisionActionId: decision.id };
  await client.query(
    `INSERT INTO safety_evidence (
       id, case_id, evidence_type, text_snapshot, structured_snapshot, object_keys
     ) VALUES ($1, $2, 'appeal', $3, $4::jsonb, $5)`,
    [`se-${randomUUID()}`, safetyCase.id, appealInput.detail, JSON.stringify(eventData), appealInput.objectKeys]
  );
  await client.query(
    `UPDATE safety_cases
     SET status = 'appealed', manual_hold = true, resolved_at = NULL, updated_at = now()
     WHERE id = $1`,
    [safetyCase.id]
  );
  await client.query(
    `INSERT INTO safety_case_events (case_id, actor_type, actor_id, event_type, event_data)
     VALUES ($1, 'owner', $2, 'appeal.submitted', $3::jsonb)`,
    [safetyCase.id, appealInput.ownerId, JSON.stringify(eventData)]
  );
  const syncEvent = await createSyncEvent(client, {
    userId: appealInput.ownerId,
    eventType: "safety.content_action.updated",
    entityType: "safety_case",
    entityId: safetyCase.id
  });
  return { appeal, syncEvents: [syncEvent] };
}

function assertTransactionClient(client) {
  if (!client || typeof client.query !== "function" || typeof client.release !== "function") {
    throw new TypeError(
      "submitSafetyAppeal requires a transaction-scoped pg PoolClient; caller must BEGIN and own COMMIT/ROLLBACK"
    );
  }
}

async function assertActiveTransaction(client) {
  try {
    await client.query(`SAVEPOINT ${TRANSACTION_PROBE}`);
    await client.query(`RELEASE SAVEPOINT ${TRANSACTION_PROBE}`);
  } catch (error) {
    const developerError = new TypeError(
      "submitSafetyAppeal requires an active transaction; caller must BEGIN before invoking it"
    );
    developerError.cause = error;
    throw developerError;
  }
}

function normalizeAppealInput(input) {
  if (!isPlainObject(input)) throw badRequest("申诉参数不正确", "invalid_appeal_request");
  const caseId = requiredIdentifier(input.caseId, "案件 ID", 160);
  const ownerId = requiredIdentifier(input.ownerId, "内容所有者", 160);
  const detail = requiredDetail(input.detail);
  const objectKeys = normalizeObjectKeys(ownerId, input.objectKeys);
  return { caseId, ownerId, detail, objectKeys };
}

function normalizeObjectKeys(ownerId, value) {
  if (!Array.isArray(value)) throw badRequest("申诉证据必须是数组", "invalid_appeal_evidence");
  if (value.length > MAX_APPEAL_OBJECT_KEYS) {
    throw badRequest(`申诉证据最多包含 ${MAX_APPEAL_OBJECT_KEYS} 项`, "invalid_appeal_evidence");
  }

  const normalized = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string") throw badRequest("申诉证据必须只包含字符串", "invalid_appeal_evidence");
    if (UNSAFE_CONTROL_CHARACTERS.test(item)) {
      throw badRequest("申诉证据包含不支持的控制字符", "invalid_appeal_evidence");
    }
    const key = item.trim();
    if (!key) throw badRequest("申诉证据不能为空", "invalid_appeal_evidence");
    if (Array.from(key).length > MAX_OBJECT_KEY_LENGTH) {
      throw badRequest(`申诉证据单项不能超过 ${MAX_OBJECT_KEY_LENGTH} 个字符`, "invalid_appeal_evidence");
    }
    if (!key.startsWith(`report/${ownerId}/`) || key.includes("..")) {
      throw badRequest("申诉证据上传归属无效", "invalid_appeal_evidence");
    }
    if (!seen.has(key)) normalized.push(key);
    seen.add(key);
  }
  return normalized;
}

async function loadCaseMetadata(client, caseId) {
  const { rows } = await client.query(
    "SELECT id, subject_type, subject_id FROM safety_cases WHERE id = $1",
    [caseId]
  );
  if (!rows[0]) throw httpError(404, "申诉案件不存在", "safety_case_not_found");
  return rows[0];
}

async function lockAndRevalidateCase(client, metadata) {
  const { rows } = await client.query("SELECT * FROM safety_cases WHERE id = $1 FOR UPDATE", [metadata.id]);
  const safetyCase = rows[0];
  if (!safetyCase) throw httpError(404, "申诉案件不存在", "safety_case_not_found");
  if (safetyCase.subject_type !== metadata.subject_type || safetyCase.subject_id !== metadata.subject_id) {
    throw conflict("申诉案件目标已变化", "appeal_target_changed");
  }
  return safetyCase;
}

async function lockAndAuthorizeTarget(client, safetyCase, ownerId) {
  const source = safetyCase.subject_type === "post"
    ? { table: "posts", ownerColumn: "author_id" }
    : { table: "group_collections", ownerColumn: "owner_id" };
  const { rows } = await client.query(
    `SELECT ${source.ownerColumn} AS owner_id FROM ${source.table} WHERE id = $1 FOR UPDATE`,
    [safetyCase.subject_id]
  );
  if (!rows[0]) throw httpError(404, "申诉内容不存在", "appeal_target_not_found");
  if (rows[0].owner_id !== ownerId) throw httpError(403, "无权申诉该内容", "appeal_not_owner");
}

async function lockLatestFinalDecision(client, safetyCase) {
  const { rows } = await client.query(
    `SELECT a.*, (${APPEAL_WINDOW_SQL}) AS appeal_window_open
     FROM safety_actions a
     WHERE a.case_id = $1
       AND a.target_type = $2
       AND a.target_id = $3
       AND a.actor_type = 'admin'
       AND a.execution_status = 'applied'
       AND a.action_type NOT IN ('notify_owner', 'request_correction')
     ORDER BY a.applied_at DESC NULLS LAST, a.created_at DESC, a.id DESC
     LIMIT 1
     FOR UPDATE`,
    [safetyCase.id, safetyCase.subject_type, safetyCase.subject_id]
  );
  return rows[0] || null;
}

async function lockExistingAppeal(client, decisionActionId) {
  const { rows } = await client.query(
    "SELECT id FROM safety_appeals WHERE decision_action_id = $1 FOR UPDATE",
    [decisionActionId]
  );
  return rows[0] || null;
}

async function insertAppeal(client, input) {
  try {
    const { rows } = await client.query(
      `INSERT INTO safety_appeals (
         id, case_id, decision_action_id, owner_id, detail, object_keys
       ) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [`sap-${randomUUID()}`, input.caseId, input.decisionActionId, input.ownerId, input.detail, input.objectKeys]
    );
    return rows[0];
  } catch (error) {
    if (error?.code === "23505" && error?.constraint === "safety_appeals_one_per_decision") {
      throw conflict("该处理决定已提交过申诉", "appeal_already_submitted");
    }
    throw error;
  }
}

function requiredIdentifier(value, label, maxLength) {
  if (typeof value !== "string") throw badRequest(`${label}必须是字符串`, "invalid_appeal_request");
  if (UNSAFE_CONTROL_CHARACTERS.test(value)) {
    throw badRequest(`${label}包含不支持的控制字符`, "invalid_appeal_request");
  }
  const text = value.trim();
  if (!text) throw badRequest(`${label}不能为空`, "invalid_appeal_request");
  if (Array.from(text).length > maxLength) {
    throw badRequest(`${label}不能超过 ${maxLength} 个字符`, "invalid_appeal_request");
  }
  return text;
}

function requiredDetail(value) {
  if (typeof value !== "string") throw badRequest("申诉说明必须是字符串", "invalid_appeal_request");
  if (UNSAFE_MULTILINE_CONTROL_CHARACTERS.test(value)) {
    throw badRequest("申诉说明包含不支持的控制字符", "invalid_appeal_request");
  }
  const detail = value.trim();
  if (!detail) throw badRequest("申诉说明不能为空", "invalid_appeal_request");
  if (Array.from(detail).length > MAX_APPEAL_DETAIL_LENGTH) {
    throw badRequest(`申诉说明不能超过 ${MAX_APPEAL_DETAIL_LENGTH} 个字符`, "invalid_appeal_request");
  }
  return detail;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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

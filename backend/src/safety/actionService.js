import { randomUUID } from "node:crypto";
import { createSyncEventsForUsers } from "../sync.js";
import { badRequest } from "../validators.js";
import { lockSafetyTarget } from "./safetyTargetLock.js";

export const REVERSIBLE_AUTOMATIC_ACTIONS = new Set([
  "hide_post", "hide_comment", "hide_message",
  "hide_collection_contact", "suspend_collection", "request_correction"
]);
export const NON_PUNITIVE_AUTOMATIC_ACTIONS = new Set(["notify_owner"]);

const ACTIONS = new Map([
  ["hide_post", { targetType: "post", table: "posts", column: "safety_status", restrictedValue: "hidden" }],
  ["hide_comment", { targetType: "comment", table: "comments", column: "safety_status", restrictedValue: "hidden" }],
  ["hide_message", { targetType: "direct_message", table: "direct_messages", column: "safety_status", restrictedValue: "hidden" }],
  ["hide_collection_contact", { targetType: "collection", table: "group_collections", column: "contact_visibility", restrictedValue: "hidden" }],
  ["suspend_collection", { targetType: "collection", table: "group_collections", column: "safety_status", restrictedValue: "suspended" }]
]);
const ACTORS = new Set(["system", "ai", "admin"]);

export async function applySafetyAction(client, input = {}) {
  const action = normalizeActionInput(input);
  await lockIdempotencyKey(client, action.idempotencyKey);
  const existing = await findActionByKey(client, action.idempotencyKey);
  if (existing) {
    assertMatchingIdempotencyPayload(existing, action);
    return { action: existing, unchanged: true, syncEvents: [] };
  }
  await lockSafetyTarget(client, action.targetType, action.targetId);
  const safetyCase = await lockCase(client, action.caseId);
  validateCaseTarget(safetyCase, action);
  const target = await lockTarget(client, action.targetType, action.targetId);

  const mapping = ACTIONS.get(action.actionType);
  const chainId = await resolveActionChainId(client, action);
  const beforeSnapshot = mapping ? { [mapping.column]: target[mapping.column], action_chain_id: chainId } : action.actionType === "request_correction"
    ? correctionSnapshot(safetyCase, chainId)
    : {};
  const afterSnapshot = mapping ? { [mapping.column]: mapping.restrictedValue, action_chain_id: chainId } : action.actionType === "request_correction"
    ? { status: "awaiting_correction", correction_due_at: action.correctionDueAt.toISOString(), action_chain_id: chainId }
    : {};

  if (mapping) {
    await client.query(
      `UPDATE ${mapping.table} SET ${mapping.column} = $2 WHERE id = $1`,
      [action.targetId, mapping.restrictedValue]
    );
  }
  await updateCaseForAction(client, action);
  const inserted = await insertAction(client, action, beforeSnapshot, afterSnapshot);
  await appendCaseEvent(client, {
    caseId: action.caseId,
    actorType: action.actorType,
    actorId: action.actorId,
    eventType: "safety_action_applied",
    eventData: { actionId: inserted.id, actionType: action.actionType, targetType: action.targetType, targetId: action.targetId }
  });
  const syncEvents = await createSafetyCaseSyncEvents(client, {
    caseId: action.caseId,
    ownerId: target.owner_id,
    ownerOnly: action.actionType === "notify_owner"
  });
  return { action: inserted, unchanged: false, syncEvents };
}

export async function rollbackSafetyAction(client, input = {}) {
  const actionId = requiredText(input.actionId, "操作 ID", 160);
  const actorType = requiredActor(input.actorType);
  const actorId = optionalText(input.actorId, "操作人 ID", 160);
  const reason = requiredText(input.reason, "撤销原因", 1000);
  const actionMetadata = await findActionById(client, actionId);
  if (!actionMetadata) throw badRequest("安全操作不存在");
  if (!REVERSIBLE_AUTOMATIC_ACTIONS.has(actionMetadata.action_type)) throw badRequest("该安全操作不支持撤销");
  await lockSafetyTarget(client, actionMetadata.target_type, actionMetadata.target_id);
  const revalidatedMetadata = await findActionById(client, actionId);
  if (!sameActionMetadata(actionMetadata, revalidatedMetadata)) throw badRequest("安全操作已变化");
  const safetyCase = await lockCase(client, actionMetadata.case_id);
  const target = await lockTarget(client, actionMetadata.target_type, actionMetadata.target_id);
  const targetActions = await lockTargetActions(client, actionMetadata);
  const action = targetActions.find((candidate) => candidate.id === actionId);
  if (!action) throw badRequest("安全操作不存在");
  if (action.execution_status === "rolled_back") return { action, unchanged: true, syncEvents: [] };
  if (action.execution_status !== "applied") throw badRequest("该安全操作尚未生效");

  const mapping = ACTIONS.get(action.action_type);
  const otherActions = targetActions.filter((candidate) => candidate.id !== action.id && candidate.execution_status === "applied");
  if (mapping && !otherActions.length) {
    const chainActions = targetActions.filter((candidate) => actionChainId(candidate) === actionChainId(action));
    const baseline = chainActions[0]?.before_snapshot?.[mapping.column] || "active";
    await client.query(`UPDATE ${mapping.table} SET ${mapping.column} = $2 WHERE id = $1`, [action.target_id, baseline]);
  }
  const { rows } = await client.query(
    `UPDATE safety_actions
     SET execution_status = 'rolled_back', rolled_back_at = now()
     WHERE id = $1
     RETURNING *`,
    [action.id]
  );
  const rolledBack = rows[0];
  if (action.action_type === "request_correction") {
    await restoreCorrectionState(client, action, targetActions.map((candidate) => candidate.id === action.id ? rolledBack : candidate));
  }
  await appendCaseEvent(client, {
    caseId: action.case_id,
    actorType,
    actorId,
    eventType: "safety_action_rolled_back",
    eventData: { actionId: action.id, actionType: action.action_type, targetType: action.target_type, targetId: action.target_id, reason }
  });
  const syncEvents = input.emitSyncEvents === false
    ? []
    : await createSafetyCaseSyncEvents(client, { caseId: action.case_id, ownerId: target.owner_id });
  return { action: rolledBack, unchanged: false, syncEvents };
}

function sameActionMetadata(expected, actual) {
  return Boolean(actual) && ["case_id", "action_type", "target_type", "target_id"].every(
    (key) => actual[key] === expected[key]
  );
}

function normalizeActionInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw badRequest("安全操作参数不正确");
  const actionType = requiredText(input.actionType, "操作类型", 80);
  if (!REVERSIBLE_AUTOMATIC_ACTIONS.has(actionType) && !NON_PUNITIVE_AUTOMATIC_ACTIONS.has(actionType)) {
    throw badRequest("不支持的自动安全操作");
  }
  const normalized = {
    caseId: requiredText(input.caseId, "安全案件 ID", 160),
    idempotencyKey: requiredText(input.idempotencyKey, "幂等键", 200),
    actionType,
    targetType: requiredText(input.targetType, "目标类型", 80),
    targetId: requiredText(input.targetId, "目标 ID", 160),
    actorType: requiredActor(input.actorType),
    actorId: optionalText(input.actorId, "操作人 ID", 160),
    reason: requiredText(input.reason, "原因", 1000),
    correctionDueAt: null
  };
  const mapping = ACTIONS.get(actionType);
  if (mapping && mapping.targetType !== normalized.targetType) throw badRequest("安全操作目标类型不匹配");
  if (actionType === "request_correction") {
    if (!input.correctionDueAt) throw badRequest("整改期限不能为空");
    const dueAt = new Date(input.correctionDueAt);
    if (Number.isNaN(dueAt.getTime())) throw badRequest("整改期限无效");
    normalized.correctionDueAt = dueAt;
  }
  return normalized;
}

async function lockCase(client, caseId) {
  const { rows } = await client.query("SELECT * FROM safety_cases WHERE id = $1 FOR UPDATE", [caseId]);
  if (!rows[0]) throw badRequest("安全案件不存在");
  return rows[0];
}

function validateCaseTarget(safetyCase, action) {
  if (safetyCase.subject_type !== action.targetType || safetyCase.subject_id !== action.targetId) {
    throw badRequest("安全操作目标必须与案件主体一致");
  }
  if (action.actorType !== "admin" && (safetyCase.manual_hold ||
      ["appealed", "resolved_no_action", "resolved_restored", "resolved_actioned"].includes(safetyCase.status))) {
    throw conflict("人工处理中的案件不能执行自动安全操作", "manual_hold");
  }
}

async function lockTarget(client, targetType, targetId) {
  const source = targetSource(targetType);
  const { rows } = await client.query(`SELECT ${source.select} FROM ${source.table} WHERE id = $1 FOR UPDATE`, [targetId]);
  if (!rows[0]) throw badRequest("安全操作目标不存在");
  return rows[0];
}

function targetSource(targetType) {
  const source = {
    post: { table: "posts", select: "*, author_id AS owner_id" },
    comment: { table: "comments", select: "*, author_id AS owner_id" },
    direct_message: { table: "direct_messages", select: "*, sender_id AS owner_id" },
    collection: { table: "group_collections", select: "*, owner_id" },
    user: { table: "users", select: "*, id AS owner_id" }
  }[targetType];
  if (!source) throw badRequest("不支持的安全操作目标");
  return source;
}

async function findActionByKey(client, idempotencyKey) {
  const { rows } = await client.query("SELECT * FROM safety_actions WHERE idempotency_key = $1", [idempotencyKey]);
  return rows[0] || null;
}

async function lockIdempotencyKey(client, idempotencyKey) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, $2::bigint))", [idempotencyKey, "0"]);
}

async function findActionById(client, actionId) {
  const { rows } = await client.query("SELECT * FROM safety_actions WHERE id = $1", [actionId]);
  return rows[0] || null;
}

function assertMatchingIdempotencyPayload(existing, action) {
  const sameIdentity = existing.case_id === action.caseId &&
    existing.action_type === action.actionType &&
    existing.target_type === action.targetType &&
    existing.target_id === action.targetId &&
    existing.actor_type === action.actorType &&
    (existing.actor_id || "") === action.actorId &&
    existing.reason === action.reason;
  const sameDeadline = action.actionType !== "request_correction" ||
    existing.after_snapshot?.correction_due_at === action.correctionDueAt.toISOString();
  if (!sameIdentity || !sameDeadline) throw conflict("幂等键已用于不同的安全操作");
}

async function insertAction(client, action, beforeSnapshot, afterSnapshot) {
  const { rows } = await client.query(
    `INSERT INTO safety_actions (
       id, case_id, idempotency_key, action_type, target_type, target_id,
       actor_type, actor_id, reason, execution_status, before_snapshot, after_snapshot, applied_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'applied', $10::jsonb, $11::jsonb, clock_timestamp())
     RETURNING *`,
    [
      `sa-${randomUUID()}`, action.caseId, action.idempotencyKey, action.actionType, action.targetType, action.targetId,
      action.actorType, action.actorId || null, action.reason, JSON.stringify(beforeSnapshot), JSON.stringify(afterSnapshot)
    ]
  );
  return rows[0];
}

async function updateCaseForAction(client, action) {
  if (action.actionType === "request_correction") {
    await client.query("UPDATE safety_cases SET status = 'awaiting_correction', correction_due_at = $2, updated_at = now() WHERE id = $1", [action.caseId, action.correctionDueAt]);
    return;
  }
  const corrections = await loadCaseCorrections(client, action.caseId);
  const activeCorrection = [...corrections].reverse().find((candidate) => candidate.execution_status === "applied");
  if (activeCorrection) {
    await client.query("UPDATE safety_cases SET status = 'awaiting_correction', correction_due_at = $2, updated_at = now() WHERE id = $1", [
      action.caseId,
      activeCorrection.after_snapshot?.correction_due_at || null
    ]);
    return;
  }
  await client.query("UPDATE safety_cases SET status = 'monitoring', correction_due_at = NULL, updated_at = now() WHERE id = $1", [action.caseId]);
}

async function loadCaseCorrections(client, caseId) {
  const { rows } = await client.query(
    `SELECT * FROM safety_actions
     WHERE case_id = $1 AND action_type = 'request_correction'
     ORDER BY applied_at ASC NULLS LAST, created_at ASC, id ASC`,
    [caseId]
  );
  return rows;
}

async function lockTargetActions(client, action) {
  const { rows } = await client.query(
    `SELECT * FROM safety_actions
     WHERE action_type = $1 AND target_type = $2 AND target_id = $3
     ORDER BY applied_at ASC NULLS LAST, created_at ASC, id ASC
     FOR UPDATE`,
    [action.action_type, action.target_type, action.target_id]
  );
  return rows;
}

async function resolveActionChainId(client, action) {
  const params = [action.actionType, action.targetType, action.targetId];
  let caseClause = "";
  if (action.actionType === "request_correction") {
    params.push(action.caseId);
    caseClause = "AND case_id = $4";
  }
  const { rows } = await client.query(
    `SELECT before_snapshot, after_snapshot
     FROM safety_actions
     WHERE action_type = $1 AND target_type = $2 AND target_id = $3
       AND execution_status = 'applied' ${caseClause}
     ORDER BY applied_at DESC NULLS LAST, created_at DESC, id DESC
     LIMIT 1`,
    params
  );
  return actionChainId(rows[0]) || `chain-${randomUUID()}`;
}

async function restoreCorrectionState(client, action, targetActions) {
  const caseCorrections = targetActions
    .filter((candidate) => candidate.case_id === action.case_id && candidate.action_type === "request_correction");
  const chainId = actionChainId(action);
  const chainCorrections = caseCorrections.filter((candidate) => actionChainId(candidate) === chainId);
  const activeCorrection = [...chainCorrections]
    .reverse()
    .find((candidate) => candidate.execution_status === "applied");
  if (activeCorrection) {
    const dueAt = activeCorrection.after_snapshot?.correction_due_at || null;
    await client.query("UPDATE safety_cases SET status = 'awaiting_correction', correction_due_at = $2, updated_at = now() WHERE id = $1", [action.case_id, dueAt]);
    return;
  }
  const baseline = correctionChainBaseline(chainCorrections);
  await client.query("UPDATE safety_cases SET status = $2, correction_due_at = $3, updated_at = now() WHERE id = $1", [
    action.case_id,
    baseline?.status || "monitoring",
    baseline?.correction_due_at || null
  ]);
}

function correctionChainBaseline(corrections) {
  return corrections[0]?.before_snapshot || null;
}

function actionChainId(action) {
  return action?.after_snapshot?.action_chain_id || action?.before_snapshot?.action_chain_id || "";
}

function correctionSnapshot(safetyCase, chainId) {
  return {
    status: safetyCase.status,
    correction_due_at: safetyCase.correction_due_at ? safetyCase.correction_due_at.toISOString() : null,
    action_chain_id: chainId
  };
}

async function appendCaseEvent(client, { caseId, actorType, actorId, eventType, eventData }) {
  await client.query(
    `INSERT INTO safety_case_events (case_id, actor_type, actor_id, event_type, event_data)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [caseId, actorType, actorId || null, eventType, JSON.stringify(eventData)]
  );
}

export async function createSafetyCaseSyncEvents(client, { caseId, ownerId, ownerOnly = false }) {
  let userIds = [ownerId];
  if (!ownerOnly) {
    const { rows } = await client.query("SELECT DISTINCT reporter_id FROM reports WHERE case_id = $1", [caseId]);
    userIds = [...userIds, ...rows.map((row) => row.reporter_id)];
  }
  return createSyncEventsForUsers(client, {
    userIds,
    eventType: "safety.report.updated",
    entityType: "safety_case",
    entityId: caseId
  });
}

function requiredActor(value) {
  const actorType = requiredText(value, "操作人类型", 40);
  if (!ACTORS.has(actorType)) throw badRequest("安全操作人类型不支持");
  return actorType;
}

function requiredText(value, label, limit) {
  if (typeof value !== "string" || !value.trim()) throw badRequest(`${label}不能为空`);
  const text = value.trim();
  if (Array.from(text).length > limit) throw badRequest(`${label}不能超过 ${limit} 个字符`);
  return text;
}

function optionalText(value, label, limit) {
  if (value == null) return "";
  return requiredText(value, label, limit);
}

function conflict(message, apiCode) {
  const error = new Error(message);
  error.status = 409;
  if (apiCode) error.apiCode = apiCode;
  return error;
}

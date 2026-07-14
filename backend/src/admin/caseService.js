import { randomUUID } from "node:crypto";
import { recordAdminAuditEvent } from "./auditService.js";
import { adminError } from "./deviceService.js";
import { adminCaseDetail, adminCaseListItem } from "./caseMapper.js";
import {
  REVERSIBLE_AUTOMATIC_ACTIONS,
  applySafetyAction,
  createSafetyCaseSyncEvents,
  rollbackSafetyAction
} from "../safety/actionService.js";
import { SAFETY_REASON_CODES, SAFETY_TARGET_TYPES } from "../safety/constants.js";
import { publishApprovedRevision } from "../safety/revisionPublishing.js";
import { lockSafetyTarget } from "../safety/safetyTargetLock.js";

const CASE_STATUSES = new Set([
  "received", "triaging", "monitoring", "manual_review", "awaiting_correction",
  "rechecking", "appealed", "resolved_no_action", "resolved_restored", "resolved_actioned"
]);
const RISK_LEVELS = new Set(["none", "low", "medium", "high", "urgent"]);
const SORTS = new Set(["urgent", "oldest", "newest", "deadline"]);
const HUMAN_DECISIONS = new Set([
  "no_action",
  "temporary_hide",
  "request_correction",
  "permanent_remove",
  "approve_revision",
  "restore",
  "uphold_appeal",
  "overturn_appeal"
]);

export async function listAdminCases(client, query = {}) {
  const input = normalizeListQuery(query);
  const params = [];
  const predicates = [];
  addFilter(predicates, params, "sc.status", input.status);
  addFilter(predicates, params, "sc.subject_type", input.subjectType);
  addFilter(predicates, params, "sc.category", input.category);
  addFilter(predicates, params, "sc.risk_level", input.riskLevel);
  const where = predicates.length ? `WHERE ${predicates.join(" AND ")}` : "";
  const order = sortClause(input.sort);
  params.push(input.limit + 1, input.offset);
  const { rows } = await client.query(
    `${caseListSelect}
     ${where}
     ORDER BY ${order}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const hasMore = rows.length > input.limit;
  const page = rows.slice(0, input.limit);
  const counts = await loadQueueCounts(client);
  return {
    cases: page.map(adminCaseListItem),
    counts,
    nextCursor: hasMore ? encodeCursor(input.offset + input.limit) : null
  };
}

export async function listAdminAuditEvents(client, query = {}) {
  const limit = boundedInteger(query.limit, 100, 1, 200, "分页数量");
  const eventType = optionalAuditIdentifier(query.eventType, "审计事件类型");
  const cursor = decodeAuditCursor(query.cursor);
  const params = [];
  const predicates = [];
  if (eventType) {
    params.push(eventType);
    predicates.push(`audit.event_type = $${params.length}`);
  }
  if (cursor) {
    params.push(cursor.createdAt, cursor.id);
    predicates.push(`(audit.created_at, audit.id) < ($${params.length - 1}::timestamptz, $${params.length}::bigint)`);
  }
  const where = predicates.length ? `WHERE ${predicates.join(" AND ")}` : "";
  params.push(limit + 1);
  const { rows } = await client.query(
    `SELECT audit.id::text, audit.event_type, audit.subject_type, audit.subject_id,
            audit.user_agent_summary, audit.event_data, audit.created_at,
            admin_user.username AS admin_username,
            device.display_name AS device_name
     FROM admin_audit_events audit
     LEFT JOIN admin_users admin_user ON admin_user.id = audit.admin_user_id
     LEFT JOIN admin_devices device ON device.id = audit.device_id
     ${where}
     ORDER BY audit.created_at DESC, audit.id DESC
     LIMIT $${params.length}`,
    params
  );
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return {
    events: page.map((row) => ({
      id: row.id,
      adminUsername: row.admin_username || "",
      deviceName: row.device_name || "",
      eventType: row.event_type,
      subjectType: row.subject_type || null,
      subjectID: row.subject_id || null,
      userAgentSummary: row.user_agent_summary || "",
      data: safeObject(row.event_data),
      createdAt: row.created_at.toISOString()
    })),
    nextCursor: hasMore ? encodeAuditCursor(page[page.length - 1]) : null
  };
}

export async function loadAdminCaseDetail(client, caseID) {
  const id = requiredIdentifier(caseID, "案件 ID");
  const selected = await client.query(`${caseListSelect} WHERE sc.id = $1`, [id]);
  if (!selected.rows[0]) throw adminError(404, "admin_case_not_found", "安全案件不存在");
  const reports = await client.query(
    `SELECT id, reporter_id, reason_code, reported_field, detail, status, created_at, updated_at
     FROM reports WHERE case_id = $1 ORDER BY created_at, id`,
    [id]
  );
  const evidence = await client.query(
    `SELECT id, evidence_type, text_snapshot <> '' AS has_text,
            structured_snapshot <> '{}'::jsonb AS has_structured_data,
            cardinality(object_keys) AS object_count,
            context_start_message_id, context_end_message_id, redacted_at, created_at
     FROM safety_evidence WHERE case_id = $1 ORDER BY created_at, id`,
    [id]
  );
  const events = await client.query(
    `SELECT id, actor_type, actor_id, event_type, event_data, created_at
     FROM safety_case_events WHERE case_id = $1 ORDER BY created_at, id`,
    [id]
  );
  const actions = await client.query(
    `SELECT id, action_type, target_type, target_id, actor_type, reason,
            execution_status, applied_at, rolled_back_at, created_at
     FROM safety_actions WHERE case_id = $1 ORDER BY created_at, id`,
    [id]
  );
  const revisions = await client.query(
    `SELECT id, revision_number, snapshot, cardinality(object_keys) AS object_count,
            status, review_summary, reviewed_at, published_at, created_at
     FROM content_revisions WHERE case_id = $1 ORDER BY revision_number, id`,
    [id]
  );
  const appeals = await client.query(
    `SELECT id, decision_action_id, detail, status, handled_reason, handled_at, created_at
     FROM safety_appeals WHERE case_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [id]
  );
  const relatedCases = await client.query(
    `${caseListSelect}
     WHERE sc.id <> $1 AND sc.subject_type = $2 AND sc.subject_id = $3
     ORDER BY sc.updated_at DESC, sc.id DESC
     LIMIT 20`,
    [id, selected.rows[0].subject_type, selected.rows[0].subject_id]
  );
  return adminCaseDetail({
    row: selected.rows[0],
    reports: reports.rows,
    evidence: evidence.rows,
    events: events.rows,
    actions: actions.rows,
    revisions: revisions.rows,
    appeal: appeals.rows[0] || null,
    relatedCases: relatedCases.rows
  });
}

export async function revealAdminCaseEvidence(client, input = {}) {
  const caseId = requiredIdentifier(input.caseId, "案件 ID");
  const evidenceId = requiredIdentifier(input.evidenceId, "证据 ID");
  const accessReason = requiredText(input.accessReason, "访问理由", 500);
  const { rows } = await client.query(
    `SELECT evidence.*, safety_case.subject_type
     FROM safety_evidence evidence
     JOIN safety_cases safety_case ON safety_case.id = evidence.case_id
     WHERE evidence.id = $1 AND evidence.case_id = $2`,
    [evidenceId, caseId]
  );
  const evidence = rows[0];
  if (!evidence) throw adminError(404, "admin_evidence_not_found", "案件证据不存在");
  const reporters = await client.query(
    `SELECT reporter_id
     FROM reports
     WHERE case_id = $1
     ORDER BY created_at, id`,
    [caseId]
  );
  await recordAdminAuditEvent(client, {
    adminUserId: input.adminUserId,
    deviceId: input.deviceId,
    sessionId: input.sessionId,
    eventType: "safety.evidence_viewed",
    subjectType: "evidence",
    subjectId: evidence.id,
    ip: input.ip,
    userAgent: input.userAgent,
    eventData: { accessReason, caseId }
  });
  const structuredSnapshot = evidence.subject_type === "direct_message"
    ? directMessageWindow({
        value: evidence.structured_snapshot,
        reporterIds: reporters.rows.map((report) => report.reporter_id),
        objectKeys: evidence.object_keys || [],
        objectURL: (index) => evidenceObjectURL(caseId, evidenceId, index)
      })
    : sanitizeEvidenceValue(safeObject(evidence.structured_snapshot));
  return {
    id: evidence.id,
    type: evidence.evidence_type,
    textSnapshot: evidence.text_snapshot || "",
    structuredSnapshot,
    objectURLs: (evidence.object_keys || []).map((_, index) =>
      evidenceObjectURL(caseId, evidenceId, index)),
    createdAt: evidence.created_at.toISOString()
  };
}

export async function authorizeAdminEvidenceObject(client, input = {}) {
  const caseId = requiredIdentifier(input.caseId, "案件 ID");
  const evidenceId = requiredIdentifier(input.evidenceId, "证据 ID");
  const objectIndex = requiredObjectIndex(input.objectIndex);
  const accessReason = requiredText(input.accessReason, "访问理由", 500);
  const { rows } = await client.query(
    `SELECT evidence.object_keys
     FROM safety_evidence evidence
     WHERE evidence.id = $1 AND evidence.case_id = $2`,
    [evidenceId, caseId]
  );
  const objectKey = rows[0]?.object_keys?.[objectIndex];
  if (!objectKey) throw adminError(404, "admin_evidence_object_not_found", "案件证据图片不存在");
  await recordAdminAuditEvent(client, {
    adminUserId: input.adminUserId,
    deviceId: input.deviceId,
    sessionId: input.sessionId,
    eventType: "safety.evidence_object_viewed",
    subjectType: "evidence",
    subjectId: evidenceId,
    ip: input.ip,
    userAgent: input.userAgent,
    eventData: { accessReason, caseId, objectIndex }
  });
  return { objectKey };
}

export async function decideAdminCase(client, input = {}) {
  const caseId = requiredIdentifier(input.caseId, "案件 ID");
  const expectedVersion = requiredDateString(input.expectedVersion, "案件版本");
  const reason = requiredText(input.reason, "处理理由", 1000);
  const decision = requiredText(input.decision, "处理动作", 80);
  if (!HUMAN_DECISIONS.has(decision)) {
    throw adminError(400, "admin_decision_invalid", "处理动作无效");
  }
  const safetyCase = await lockAdminCase(client, caseId);
  if (safetyCase.updated_at.toISOString() !== expectedVersion) {
    throw adminError(409, "case_changed", "案件已经变化，请刷新后重试");
  }
  const isAppealDecision = decision === "uphold_appeal" || decision === "overturn_appeal";
  if (safetyCase.status === "appealed" && !isAppealDecision) {
    throw adminError(409, "admin_appeal_decision_required", "申诉案件必须先处理申诉结果");
  }
  if (safetyCase.status !== "appealed" && isAppealDecision) {
    throw adminError(409, "admin_appeal_not_pending", "案件当前不在申诉处理中");
  }
  const syncEvents = [];
  let closesReports = true;
  if (decision === "no_action") {
    await setCaseResolution(client, caseId, "resolved_no_action", false);
    syncEvents.push(...await createSafetyCaseSyncEvents(client, {
      caseId,
      ownerId: await loadCaseOwnerId(client, safetyCase)
    }));
  } else if (decision === "temporary_hide") {
    const actionType = temporaryActionType(safetyCase.subject_type);
    const applied = await applySafetyAction(client, {
      caseId,
      idempotencyKey: `admin-decision:${caseId}:${expectedVersion}`,
      actionType,
      targetType: safetyCase.subject_type,
      targetId: safetyCase.subject_id,
      actorType: "admin",
      actorId: input.adminUserId,
      reason
    });
    syncEvents.push(...applied.syncEvents);
    await setCaseResolution(client, caseId, "resolved_actioned", true);
  } else if (decision === "request_correction") {
    if (!["post", "collection"].includes(safetyCase.subject_type)) {
      throw adminError(400, "admin_decision_invalid", "该案件主体不支持内容整改");
    }
    const correctionDueAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const applied = await applySafetyAction(client, {
      caseId,
      idempotencyKey: `admin-decision:${caseId}:${expectedVersion}`,
      actionType: "request_correction",
      targetType: safetyCase.subject_type,
      targetId: safetyCase.subject_id,
      actorType: "admin",
      actorId: input.adminUserId,
      reason,
      correctionDueAt
    });
    syncEvents.push(...applied.syncEvents);
    await client.query(
      "UPDATE safety_cases SET manual_hold = true, updated_at = now() WHERE id = $1",
      [caseId]
    );
    closesReports = false;
  } else if (decision === "permanent_remove") {
    const removed = await applyPermanentRemoval(client, {
      safetyCase,
      idempotencyKey: `admin-decision:${caseId}:${expectedVersion}`,
      actorId: input.adminUserId,
      reason
    });
    syncEvents.push(...removed.syncEvents);
    await setCaseResolution(client, caseId, "resolved_actioned", true);
  } else if (decision === "approve_revision") {
    if (!["post", "collection"].includes(safetyCase.subject_type)) {
      throw adminError(400, "admin_decision_invalid", "该案件主体不支持整改版本");
    }
    const { rows: revisions } = await client.query(
      `SELECT id FROM content_revisions
       WHERE case_id = $1 AND status = 'approved'
       ORDER BY revision_number DESC, created_at DESC, id DESC
       LIMIT 1`,
      [caseId]
    );
    if (!revisions[0]) {
      throw adminError(409, "admin_revision_not_ready", "没有可发布的已通过整改版本");
    }
    const published = await publishApprovedRevision(client, revisions[0].id, {
      actorType: "admin",
      actorId: input.adminUserId,
      reason
    });
    syncEvents.push(...published.syncEvents);
    closesReports = published.restored;
  } else if (decision === "restore") {
    syncEvents.push(...await restoreAppliedCaseActions(client, {
      safetyCase,
      actorId: input.adminUserId,
      reason
    }));
    await setCaseResolution(client, caseId, "resolved_restored", false);
  } else if (decision === "uphold_appeal" || decision === "overturn_appeal") {
    const appeal = await settlePendingAppeal(client, {
      caseId,
      decision,
      actorId: input.adminUserId,
      reason
    });
    if (decision === "overturn_appeal") {
      syncEvents.push(...await rollbackAppealedDecision(client, {
        appeal,
        actorId: input.adminUserId,
        reason
      }));
      closesReports = await applyAppealOverturnCaseState(client, caseId);
    } else {
      syncEvents.push(...await createSafetyCaseSyncEvents(client, {
        caseId,
        ownerId: appeal.owner_id
      }));
      await setCaseResolution(client, caseId, "resolved_actioned", true);
    }
  }
  if (closesReports) await closeCaseReports(client, caseId);
  await client.query(
    `INSERT INTO safety_case_events (case_id, actor_type, actor_id, event_type, event_data)
     VALUES ($1, 'admin', $2, 'admin_decision_applied', $3::jsonb)`,
    [caseId, input.adminUserId, JSON.stringify({ decision, reason })]
  );
  await recordAdminAuditEvent(client, {
    adminUserId: input.adminUserId,
    deviceId: input.deviceId,
    sessionId: input.sessionId,
    eventType: "safety.case_decided",
    subjectType: "safety_case",
    subjectId: caseId,
    ip: input.ip,
    userAgent: input.userAgent,
    eventData: { decision, reason }
  });
  return {
    case: await loadAdminCaseDetail(client, caseId),
    syncEvents
  };
}

async function rollbackAppealedDecision(client, { appeal, actorId, reason }) {
  const { rows } = await client.query(
    `SELECT * FROM safety_actions
     WHERE id = $1 AND case_id = $2
     FOR UPDATE`,
    [appeal.decision_action_id, appeal.case_id]
  );
  const action = rows[0];
  if (!action || action.execution_status !== "applied") {
    throw adminError(409, "admin_appeal_decision_changed", "申诉对应的处理动作已经变化");
  }
  if (action.action_type === "permanent_remove") {
    const rolledBack = await rollbackPermanentRemoval(client, { action, actorId, reason });
    return rolledBack.syncEvents;
  }
  if (!REVERSIBLE_AUTOMATIC_ACTIONS.has(action.action_type)) {
    throw adminError(409, "admin_appeal_decision_invalid", "申诉对应的处理动作不支持撤销");
  }
  const rolledBack = await rollbackSafetyAction(client, {
    actionId: action.id,
    actorType: "admin",
    actorId,
    reason
  });
  return rolledBack.syncEvents;
}

async function applyAppealOverturnCaseState(client, caseId) {
  const { rows } = await client.query(
    `SELECT action_type, after_snapshot
     FROM safety_actions
     WHERE case_id = $1 AND execution_status = 'applied'
     ORDER BY applied_at DESC NULLS LAST, created_at DESC, id DESC`,
    [caseId]
  );
  const punitive = rows.find((action) =>
    !["notify_owner", "request_correction"].includes(action.action_type));
  if (punitive) {
    await setCaseResolution(client, caseId, "resolved_actioned", true);
    return true;
  }
  const correction = rows.find((action) => action.action_type === "request_correction");
  if (correction) {
    await client.query(
      `UPDATE safety_cases
       SET status = 'awaiting_correction', manual_hold = true,
           correction_due_at = ($2::jsonb ->> 'correction_due_at')::timestamptz,
           resolved_at = NULL, updated_at = now()
       WHERE id = $1`,
      [caseId, JSON.stringify(correction.after_snapshot || {})]
    );
    return false;
  }
  await setCaseResolution(client, caseId, "resolved_restored", false);
  return true;
}

async function restoreAppliedCaseActions(client, { safetyCase, actorId, reason }) {
  const reversibleActions = [...REVERSIBLE_AUTOMATIC_ACTIONS, "permanent_remove"];
  const { rows: actions } = await client.query(
    `SELECT * FROM safety_actions
     WHERE case_id = $1 AND execution_status = 'applied'
       AND action_type = ANY($2::text[])
     ORDER BY applied_at DESC NULLS LAST, created_at DESC, id DESC
     FOR UPDATE`,
    [safetyCase.id, reversibleActions]
  );
  const syncEvents = [];
  for (const action of actions) {
    const rolledBack = action.action_type === "permanent_remove"
      ? await rollbackPermanentRemoval(client, { action, actorId, reason })
      : await rollbackSafetyAction(client, {
          actionId: action.id,
          actorType: "admin",
          actorId,
          reason
        });
    syncEvents.push(...rolledBack.syncEvents);
  }
  if (!actions.length) {
    syncEvents.push(...await createSafetyCaseSyncEvents(client, {
      caseId: safetyCase.id,
      ownerId: await loadCaseOwnerId(client, safetyCase)
    }));
  }
  return syncEvents;
}

async function settlePendingAppeal(client, { caseId, decision, actorId, reason }) {
  const { rows } = await client.query(
    `SELECT * FROM safety_appeals
     WHERE case_id = $1 AND status = 'pending'
     ORDER BY created_at DESC, id DESC
     LIMIT 1
     FOR UPDATE`,
    [caseId]
  );
  const appeal = rows[0];
  if (!appeal) throw adminError(409, "admin_appeal_not_pending", "没有待处理的申诉");
  const status = decision === "uphold_appeal" ? "upheld" : "overturned";
  const updated = await client.query(
    `UPDATE safety_appeals
     SET status = $2, handled_by = $3, handled_reason = $4, handled_at = now()
     WHERE id = $1
     RETURNING *`,
    [appeal.id, status, actorId, reason]
  );
  return updated.rows[0];
}

async function applyPermanentRemoval(client, { safetyCase, idempotencyKey, actorId, reason }) {
  const target = permanentRemovalTarget(safetyCase.subject_type);
  const { rows } = await client.query(
    `SELECT id, ${target.ownerColumn} AS owner_id, safety_status
     FROM ${target.table} WHERE id = $1 FOR UPDATE`,
    [safetyCase.subject_id]
  );
  const row = rows[0];
  if (!row) throw adminError(404, "admin_case_target_not_found", "案件主体不存在");
  await client.query(
    `UPDATE ${target.table} SET safety_status = 'removed' WHERE id = $1`,
    [safetyCase.subject_id]
  );
  const actionId = `sa-${randomUUID()}`;
  await client.query(
    `INSERT INTO safety_actions (
       id, case_id, idempotency_key, action_type, target_type, target_id,
       actor_type, actor_id, reason, execution_status, before_snapshot, after_snapshot, applied_at
     ) VALUES ($1, $2, $3, 'permanent_remove', $4, $5, 'admin', $6, $7,
               'applied', $8::jsonb, $9::jsonb, now())`,
    [
      actionId,
      safetyCase.id,
      idempotencyKey,
      safetyCase.subject_type,
      safetyCase.subject_id,
      actorId,
      reason,
      JSON.stringify({ safety_status: row.safety_status }),
      JSON.stringify({ safety_status: "removed" })
    ]
  );
  await client.query(
    `INSERT INTO safety_case_events (case_id, actor_type, actor_id, event_type, event_data)
     VALUES ($1, 'admin', $2, 'safety_action_applied', $3::jsonb)`,
    [safetyCase.id, actorId, JSON.stringify({
      actionId,
      actionType: "permanent_remove",
      targetType: safetyCase.subject_type,
      targetId: safetyCase.subject_id
    })]
  );
  return {
    syncEvents: await createSafetyCaseSyncEvents(client, {
      caseId: safetyCase.id,
      ownerId: row.owner_id
    })
  };
}

async function rollbackPermanentRemoval(client, { action, actorId, reason }) {
  const target = permanentRemovalTarget(action.target_type);
  const selected = await client.query(
    `SELECT id FROM ${target.table} WHERE id = $1 FOR UPDATE`,
    [action.target_id]
  );
  if (!selected.rows[0]) {
    throw adminError(409, "admin_case_target_changed", "案件主体已经变化，无法恢复");
  }
  const { rows: siblingActions } = await client.query(
    `SELECT 1 FROM safety_actions
     WHERE id <> $1 AND target_type = $2 AND target_id = $3
       AND action_type = 'permanent_remove' AND execution_status = 'applied'
     LIMIT 1`,
    [action.id, action.target_type, action.target_id]
  );
  if (!siblingActions[0]) {
    const baseline = ["active", "hidden", "suspended", "removed"].includes(action.before_snapshot?.safety_status)
      ? action.before_snapshot.safety_status
      : "active";
    await client.query(
      `UPDATE ${target.table} SET safety_status = $2 WHERE id = $1`,
      [action.target_id, baseline]
    );
  }
  await client.query(
    `UPDATE safety_actions
     SET execution_status = 'rolled_back', rolled_back_at = now()
     WHERE id = $1`,
    [action.id]
  );
  await client.query(
    `INSERT INTO safety_case_events (case_id, actor_type, actor_id, event_type, event_data)
     VALUES ($1, 'admin', $2, 'safety_action_rolled_back', $3::jsonb)`,
    [action.case_id, actorId, JSON.stringify({
      actionId: action.id,
      actionType: action.action_type,
      targetType: action.target_type,
      targetId: action.target_id,
      reason
    })]
  );
  const { rows } = await client.query(
    `SELECT ${target.ownerColumn} AS owner_id FROM ${target.table} WHERE id = $1`,
    [action.target_id]
  );
  return {
    syncEvents: await createSafetyCaseSyncEvents(client, {
      caseId: action.case_id,
      ownerId: rows[0]?.owner_id
    })
  };
}

function permanentRemovalTarget(subjectType) {
  const target = {
    post: { table: "posts", ownerColumn: "author_id" },
    collection: { table: "group_collections", ownerColumn: "owner_id" }
  }[subjectType];
  if (!target) {
    throw adminError(400, "admin_decision_invalid", "该案件主体不支持永久移除");
  }
  return target;
}

export async function setAdminUserRestriction(client, input = {}) {
  const caseId = requiredIdentifier(input.caseId, "案件 ID");
  const userId = requiredIdentifier(input.userID, "用户 ID");
  const expectedVersion = requiredDateString(input.expectedVersion, "案件版本");
  const reason = requiredText(input.reason, "处理理由", 1000);
  if (typeof input.restricted !== "boolean") {
    throw adminError(400, "admin_request_invalid", "账号限制状态无效");
  }
  const safetyCase = await lockAdminCase(client, caseId);
  if (safetyCase.updated_at.toISOString() !== expectedVersion) {
    throw adminError(409, "case_changed", "案件已经变化，请刷新后重试");
  }
  const relatedOwnerId = await loadCaseOwnerId(client, safetyCase, { required: true });
  if (userId !== relatedOwnerId) {
    throw adminError(400, "admin_case_user_mismatch", "账号与案件主体不匹配");
  }
  const userResult = await client.query(
    "SELECT id, is_restricted, can_show_contact FROM users WHERE id = $1 FOR UPDATE",
    [userId]
  );
  const user = userResult.rows[0];
  if (!user) throw adminError(404, "admin_user_not_found", "用户不存在");
  if (!input.restricted) {
    const { rows: restrictions } = await client.query(
      `SELECT id, case_id FROM safety_actions
       WHERE target_type = 'user' AND target_id = $1
         AND action_type = 'restrict_user' AND execution_status = 'applied'
       ORDER BY applied_at, created_at, id
       FOR UPDATE`,
      [userId]
    );
    if (restrictions.some((restriction) => restriction.case_id !== caseId)) {
      throw adminError(409, "admin_user_still_restricted", "账号仍受其他安全案件限制");
    }
    if (restrictions.length) {
      await client.query(
        `UPDATE safety_actions
         SET execution_status = 'rolled_back', rolled_back_at = now()
         WHERE id = ANY($1::text[])`,
        [restrictions.map((restriction) => restriction.id)]
      );
    }
  }
  await client.query(
    "UPDATE users SET is_restricted = $2, can_show_contact = $3, updated_at = now() WHERE id = $1",
    [userId, input.restricted, !input.restricted]
  );
  const actionType = input.restricted ? "restrict_user" : "restore_user";
  await client.query(
    `INSERT INTO safety_actions (
       id, case_id, idempotency_key, action_type, target_type, target_id,
       actor_type, actor_id, reason, execution_status, before_snapshot, after_snapshot, applied_at
     ) VALUES ($1, $2, $3, $4, 'user', $5, 'admin', $6, $7, 'applied', $8::jsonb, $9::jsonb, now())`,
    [
      `sa-${randomUUID()}`,
      caseId,
      `admin-user-restriction:${caseId}:${expectedVersion}`,
      actionType,
      userId,
      input.adminUserId,
      reason,
      JSON.stringify({ is_restricted: user.is_restricted, can_show_contact: user.can_show_contact }),
      JSON.stringify({ is_restricted: input.restricted, can_show_contact: !input.restricted })
    ]
  );
  await setCaseResolution(
    client,
    caseId,
    input.restricted ? "resolved_actioned" : "resolved_restored",
    input.restricted
  );
  await closeCaseReports(client, caseId);
  await client.query(
    `INSERT INTO safety_case_events (case_id, actor_type, actor_id, event_type, event_data)
     VALUES ($1, 'admin', $2, 'admin_user_restriction_changed', $3::jsonb)`,
    [caseId, input.adminUserId, JSON.stringify({ restricted: input.restricted, reason, userId })]
  );
  await recordAdminAuditEvent(client, {
    adminUserId: input.adminUserId,
    deviceId: input.deviceId,
    sessionId: input.sessionId,
    eventType: "safety.user_restriction_changed",
    subjectType: "user",
    subjectId: userId,
    ip: input.ip,
    userAgent: input.userAgent,
    eventData: { caseId, restricted: input.restricted, reason }
  });
  return {
    case: await loadAdminCaseDetail(client, caseId),
    syncEvents: await createSafetyCaseSyncEvents(client, { caseId, ownerId: userId })
  };
}

async function setCaseResolution(client, caseId, status, manualHold) {
  await client.query(
    `UPDATE safety_cases
     SET status = $2, resolved_at = now(), correction_due_at = NULL,
         manual_hold = $3, updated_at = now()
     WHERE id = $1`,
    [caseId, status, manualHold]
  );
}

async function lockAdminCase(client, caseId) {
  const metadata = await client.query(
    "SELECT id, subject_type, subject_id FROM safety_cases WHERE id = $1",
    [caseId]
  );
  if (!metadata.rows[0]) throw adminError(404, "admin_case_not_found", "安全案件不存在");
  await lockSafetyTarget(
    client,
    metadata.rows[0].subject_type,
    metadata.rows[0].subject_id
  );
  const selected = await client.query(
    "SELECT * FROM safety_cases WHERE id = $1 FOR UPDATE",
    [caseId]
  );
  const safetyCase = selected.rows[0];
  if (!safetyCase) throw adminError(404, "admin_case_not_found", "安全案件不存在");
  if (safetyCase.subject_type !== metadata.rows[0].subject_type ||
      safetyCase.subject_id !== metadata.rows[0].subject_id) {
    throw adminError(409, "admin_case_target_changed", "案件主体已经变化，请刷新后重试");
  }
  return safetyCase;
}

async function closeCaseReports(client, caseId) {
  await client.query(
    "UPDATE reports SET status = 'closed', handled_at = COALESCE(handled_at, now()), updated_at = now() WHERE case_id = $1 AND status = 'pending'",
    [caseId]
  );
}

function temporaryActionType(subjectType) {
  const actionType = {
    post: "hide_post",
    comment: "hide_comment",
    direct_message: "hide_message",
    collection: "suspend_collection"
  }[subjectType];
  if (!actionType) throw adminError(400, "admin_decision_invalid", "该案件不支持暂时隐藏");
  return actionType;
}

async function loadCaseOwnerId(client, safetyCase, { required = false } = {}) {
  if (safetyCase.subject_type === "user") return safetyCase.subject_id;
  const source = {
    post: { table: "posts", owner: "author_id" },
    comment: { table: "comments", owner: "author_id" },
    direct_message: { table: "direct_messages", owner: "sender_id" },
    collection: { table: "group_collections", owner: "owner_id" }
  }[safetyCase.subject_type];
  if (!source) throw adminError(400, "admin_case_target_invalid", "案件主体不受支持");
  const { rows } = await client.query(
    `SELECT ${source.owner} AS owner_id FROM ${source.table} WHERE id = $1`,
    [safetyCase.subject_id]
  );
  if (!rows[0]?.owner_id && required) {
    throw adminError(404, "admin_case_target_not_found", "案件主体不存在");
  }
  return rows[0]?.owner_id || null;
}

const caseListSelect = `
  SELECT sc.*,
         CASE sc.subject_type
           WHEN 'post' THEN COALESCE((SELECT post.title FROM posts post WHERE post.id = sc.subject_id), sc.subject_id)
           WHEN 'collection' THEN COALESCE((SELECT collection.name FROM group_collections collection WHERE collection.id = sc.subject_id), sc.subject_id)
           WHEN 'comment' THEN COALESCE((SELECT left(comment.body, 120) FROM comments comment WHERE comment.id = sc.subject_id), sc.subject_id)
           WHEN 'user' THEN COALESCE((SELECT account.nickname FROM users account WHERE account.id = sc.subject_id), sc.subject_id)
           WHEN 'direct_message' THEN '私信证据'
           ELSE sc.subject_id
         END AS subject_title,
         CASE sc.subject_type
           WHEN 'post' THEN (SELECT post.author_id FROM posts post WHERE post.id = sc.subject_id)
           WHEN 'collection' THEN (SELECT collection.owner_id FROM group_collections collection WHERE collection.id = sc.subject_id)
           WHEN 'comment' THEN (SELECT comment.author_id FROM comments comment WHERE comment.id = sc.subject_id)
           WHEN 'direct_message' THEN (SELECT message.sender_id FROM direct_messages message WHERE message.id = sc.subject_id)
           WHEN 'user' THEN sc.subject_id
           ELSE NULL
         END AS subject_owner_id,
         report_totals.report_count,
         report_totals.independent_reporter_count
  FROM safety_cases sc
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS report_count,
           count(DISTINCT report.reporter_id)::int AS independent_reporter_count
    FROM reports report
    WHERE report.case_id = sc.id
  ) report_totals ON true`;

async function loadQueueCounts(client) {
  const { rows } = await client.query(
    `SELECT
       count(*) FILTER (WHERE status = 'manual_review')::int AS manual_review,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM safety_actions action
         WHERE action.case_id = safety_cases.id
           AND action.actor_type IN ('system', 'ai')
           AND action.execution_status = 'applied'
       ))::int AS auto_action,
       count(*) FILTER (WHERE status = 'awaiting_correction')::int AS awaiting_correction,
       count(*) FILTER (WHERE status = 'appealed')::int AS appealed,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM safety_jobs job
         WHERE job.case_id = safety_cases.id
           AND job.status = 'failed'
           AND job.job_type = 'analyze_case'
       ))::int AS ai_failed,
       count(*) FILTER (
         WHERE correction_due_at < now()
           AND status NOT IN ('resolved_no_action', 'resolved_restored', 'resolved_actioned')
       )::int AS overdue
     FROM safety_cases`
  );
  return rows[0];
}

function normalizeListQuery(query) {
  const status = optionalEnum(query.status, CASE_STATUSES, "案件状态");
  const subjectType = optionalEnum(query.subjectType, new Set(SAFETY_TARGET_TYPES), "目标类型");
  const category = optionalEnum(query.category, new Set(SAFETY_REASON_CODES), "案件分类");
  const riskLevel = optionalEnum(query.riskLevel, RISK_LEVELS, "风险等级");
  const sort = optionalEnum(query.sort, SORTS, "排序方式") || "urgent";
  const limit = boundedInteger(query.limit, 50, 1, 100, "分页数量");
  const offset = decodeCursor(query.cursor);
  return { status, subjectType, category, riskLevel, sort, limit, offset };
}

function sortClause(sort) {
  if (sort === "oldest") return "sc.created_at ASC, sc.id ASC";
  if (sort === "newest") return "sc.updated_at DESC, sc.id DESC";
  if (sort === "deadline") return "sc.correction_due_at ASC NULLS LAST, sc.updated_at ASC, sc.id ASC";
  return `CASE WHEN sc.status IN ('resolved_no_action', 'resolved_restored', 'resolved_actioned') THEN 1 ELSE 0 END ASC,
          CASE sc.risk_level
            WHEN 'urgent' THEN 5 WHEN 'high' THEN 4 WHEN 'medium' THEN 3
            WHEN 'low' THEN 2 ELSE 1 END DESC,
          sc.correction_due_at ASC NULLS LAST, sc.created_at ASC, sc.id ASC`;
}

function addFilter(predicates, params, column, value) {
  if (!value) return;
  params.push(value);
  predicates.push(`${column} = $${params.length}`);
}

function encodeCursor(offset) {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodeCursor(value) {
  if (value == null || value === "") return 0;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    if (!Number.isInteger(parsed.offset) || parsed.offset < 0 || parsed.offset > 1_000_000) throw new Error();
    return parsed.offset;
  } catch {
    throw adminError(400, "admin_cursor_invalid", "分页游标无效");
  }
}

function encodeAuditCursor(row) {
  return Buffer.from(JSON.stringify({
    createdAt: row.created_at.toISOString(),
    id: row.id
  }), "utf8").toString("base64url");
}

function decodeAuditCursor(value) {
  if (value == null || value === "") return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
        Object.keys(parsed).sort().join(",") !== "createdAt,id" ||
        typeof parsed.createdAt !== "string" || new Date(parsed.createdAt).toISOString() !== parsed.createdAt ||
        typeof parsed.id !== "string" || !/^[1-9]\d*$/u.test(parsed.id)) {
      throw new Error();
    }
    return parsed;
  } catch {
    throw adminError(400, "admin_cursor_invalid", "分页游标无效");
  }
}

function optionalAuditIdentifier(value, label) {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || !/^[a-z0-9_.-]{1,80}$/u.test(value)) {
    throw adminError(400, "admin_filter_invalid", `${label}无效`);
  }
  return value;
}

function optionalEnum(value, allowed, label) {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || !allowed.has(value)) {
    throw adminError(400, "admin_filter_invalid", `${label}无效`);
  }
  return value;
}

function boundedInteger(value, fallback, minimum, maximum, label) {
  if (value == null || value === "") return fallback;
  if (!/^\d+$/u.test(String(value))) throw adminError(400, "admin_filter_invalid", `${label}无效`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw adminError(400, "admin_filter_invalid", `${label}无效`);
  }
  return parsed;
}

function requiredIdentifier(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim() ||
      Array.from(value).length > 160 || /[\u0000\r\n]/u.test(value)) {
    throw adminError(400, "admin_request_invalid", `${label}无效`);
  }
  return value;
}

function requiredText(value, label, limit) {
  if (typeof value !== "string" || !value.trim()) {
    throw adminError(400, "admin_request_invalid", `${label}不能为空`);
  }
  const text = value.trim();
  if (Array.from(text).length > limit || /[\u0000]/u.test(text)) {
    throw adminError(400, "admin_request_invalid", `${label}无效`);
  }
  return text;
}

function requiredDateString(value, label) {
  const text = requiredText(value, label, 80);
  const date = new Date(text);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== text) {
    throw adminError(400, "admin_request_invalid", `${label}无效`);
  }
  return text;
}

function requiredObjectIndex(value) {
  if (!/^\d+$/u.test(String(value))) {
    throw adminError(400, "admin_request_invalid", "证据图片序号无效");
  }
  const index = Number(value);
  if (!Number.isSafeInteger(index) || index < 0 || index > 100) {
    throw adminError(400, "admin_request_invalid", "证据图片序号无效");
  }
  return index;
}

function directMessageWindow({ value, reporterIds, objectKeys, objectURL }) {
  const source = safeObject(value);
  const reporterLabels = new Map();
  for (const reporterId of reporterIds) {
    if (!reporterLabels.has(reporterId)) {
      reporterLabels.set(reporterId, `举报人 ${reporterLabels.size + 1}`);
    }
  }
  const participantLabels = new Map();
  const messages = Array.isArray(source.messages) ? source.messages.slice(0, 7) : [];
  return {
    messages: messages.map((message) => {
      const sanitized = sanitizeEvidenceValue(message);
      const senderId = typeof message?.senderId === "string" ? message.senderId : "";
      if (senderId && !reporterLabels.has(senderId) && !participantLabels.has(senderId)) {
        participantLabels.set(senderId, `对话参与者 ${participantLabels.size + 1}`);
      }
      const imageIndex = typeof message?.imageObjectKey === "string"
        ? objectKeys.indexOf(message.imageObjectKey)
        : -1;
      return {
        ...sanitized,
        senderLabel: reporterLabels.get(senderId) || participantLabels.get(senderId) || "对话参与者",
        imageURL: imageIndex >= 0 ? objectURL(imageIndex) : null,
        hasSharedProfile: Boolean(message?.sharedProfileUserId)
      };
    })
  };
}

function sanitizeEvidenceValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeEvidenceValue);
  if (!value || typeof value !== "object") return value;
  const forbidden = new Set(["authorid", "ownerid", "reporterid", "senderid"]);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => {
        const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/gu, "");
        return !normalized.includes("objectkey") &&
          !normalized.endsWith("userid") &&
          !forbidden.has(normalized);
      })
      .map(([key, nested]) => [key, sanitizeEvidenceValue(nested)])
  );
}

function evidenceObjectURL(caseId, evidenceId, index) {
  return `/admin/api/cases/${encodeURIComponent(caseId)}/evidence/${encodeURIComponent(evidenceId)}/objects/${index}`;
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

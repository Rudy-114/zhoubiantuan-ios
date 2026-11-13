import { recordAdminAuditEvent } from "../admin/auditService.js";
import { adminError } from "../admin/deviceService.js";
import {
  REVERSIBLE_AUTOMATIC_ACTIONS,
  createSafetyCaseSyncEvents,
  rollbackSafetyAction
} from "./actionService.js";
import { supportedInvalidContactActionTypes } from "./policyEngine.js";
import { lockSafetyTarget } from "./safetyTargetLock.js";

const INVALID_REASONS = new Set(["malicious", "coordinated", "mistaken_target", "other"]);
const TRANSACTION_PROBE = "report_abuse_service_transaction_probe";

export async function independentReporterCount(client, caseID, { now = new Date() } = {}) {
  requireClient(client);
  const caseId = requiredIdentifier(caseID, "案件 ID");
  const safeNow = validDate(now);
  const result = await client.query(
    `SELECT count(DISTINCT report.reporter_id)::int AS count
     FROM reports report
     JOIN users reporter ON reporter.id = report.reporter_id
     WHERE report.case_id = $1
       AND report.status IN ('pending', 'closed')
       AND report.created_at >= $2::timestamptz - interval '7 days'
       AND reporter.is_restricted = false`,
    [caseId, safeNow]
  );
  return result.rows[0]?.count || 0;
}

export async function loadReportCountingStatuses(client, caseID, { now = new Date() } = {}) {
  requireClient(client);
  const caseId = requiredIdentifier(caseID, "案件 ID");
  const safeNow = validDate(now);
  const result = await client.query(
    `SELECT report.id, report.reporter_id, report.reason_code, report.reported_field,
            report.detail, report.status, report.admin_result, report.created_at, report.updated_at,
            (
              report.status IN ('pending', 'closed')
              AND report.created_at >= $2::timestamptz - interval '7 days'
              AND reporter.is_restricted = false
              AND NOT EXISTS (
                SELECT 1
                FROM reports earlier
                WHERE earlier.case_id = report.case_id
                  AND earlier.reporter_id = report.reporter_id
                  AND earlier.status IN ('pending', 'closed')
                  AND earlier.created_at >= $2::timestamptz - interval '7 days'
                  AND (earlier.created_at, earlier.id) < (report.created_at, report.id)
              )
            ) AS counts_toward_threshold,
            CASE
              WHEN report.status = 'invalid' THEN 'invalid'
              WHEN report.status NOT IN ('pending', 'closed') THEN 'status_not_counted'
              WHEN report.created_at < $2::timestamptz - interval '7 days' THEN 'outside_window'
              WHEN reporter.is_restricted THEN 'reporter_restricted'
              WHEN EXISTS (
                SELECT 1
                FROM reports earlier
                WHERE earlier.case_id = report.case_id
                  AND earlier.reporter_id = report.reporter_id
                  AND earlier.status IN ('pending', 'closed')
                  AND earlier.created_at >= $2::timestamptz - interval '7 days'
                  AND (earlier.created_at, earlier.id) < (report.created_at, report.id)
              ) THEN 'duplicate_reporter'
              ELSE 'counted'
            END AS counting_reason
     FROM reports report
     JOIN users reporter ON reporter.id = report.reporter_id
     WHERE report.case_id = $1
     ORDER BY report.created_at, report.id`,
    [caseId, safeNow]
  );
  return result.rows;
}

export async function markReportInvalid(client, input = {}) {
  assertTransactionClient(client);
  await assertActiveTransaction(client);
  const normalized = normalizeInvalidation(input);
  const initial = await client.query(
    `SELECT report.id, report.case_id, safety_case.subject_type, safety_case.subject_id
     FROM reports report
     JOIN safety_cases safety_case ON safety_case.id = report.case_id
     WHERE report.id = $1 AND report.case_id = $2`,
    [normalized.reportId, normalized.caseId]
  );
  if (!initial.rows[0]) {
    throw adminError(404, "admin_report_not_found", "举报记录不存在");
  }
  await lockSafetyTarget(client, initial.rows[0].subject_type, initial.rows[0].subject_id);
  const caseResult = await client.query(
    "SELECT * FROM safety_cases WHERE id = $1 FOR UPDATE",
    [normalized.caseId]
  );
  const safetyCase = caseResult.rows[0];
  if (!safetyCase) throw adminError(404, "admin_case_not_found", "安全案件不存在");
  const reportResult = await client.query(
    "SELECT * FROM reports WHERE id = $1 AND case_id = $2 FOR UPDATE",
    [normalized.reportId, normalized.caseId]
  );
  const report = reportResult.rows[0];
  if (!report) throw adminError(404, "admin_report_not_found", "举报记录不存在");

  const adminResult = `report_invalid:${normalized.reason}`;
  if (report.status === "invalid") {
    if (report.admin_result !== adminResult) {
      throw adminError(409, "admin_report_already_invalid", "该举报已按其他原因标记无效");
    }
    return {
      unchanged: true,
      report,
      independentReporterCount: await independentReporterCount(client, normalized.caseId, { now: normalized.now }),
      rolledBackActionTypes: [],
      syncEvents: []
    };
  }
  if (safetyCase.updated_at.toISOString() !== normalized.expectedVersion) {
    throw adminError(409, "case_changed", "案件已经变化，请刷新后重试");
  }

  const updated = await client.query(
    `UPDATE reports
     SET status = 'invalid', admin_result = $3,
         handled_at = COALESCE(handled_at, $4), updated_at = $4
     WHERE id = $1 AND case_id = $2
     RETURNING *`,
    [normalized.reportId, normalized.caseId, adminResult, normalized.now]
  );
  const count = await independentReporterCount(client, normalized.caseId, { now: normalized.now });
  const desiredActions = desiredAutomaticActionTypes(safetyCase, count, normalized.now);
  const automaticActions = await client.query(
    `SELECT id, action_type
     FROM safety_actions
     WHERE case_id = $1
       AND actor_type IN ('system', 'ai')
       AND execution_status = 'applied'
       AND action_type = ANY($2::text[])
     ORDER BY applied_at DESC NULLS LAST, created_at DESC, id DESC`,
    [normalized.caseId, [...REVERSIBLE_AUTOMATIC_ACTIONS]]
  );
  const rolledBackActionTypes = [];
  for (const action of automaticActions.rows) {
    if (desiredActions.has(action.action_type)) continue;
    const rollback = await rollbackSafetyAction(client, {
      actionId: action.id,
      actorType: "admin",
      actorId: normalized.adminUserId,
      reason: `report_invalidated:${normalized.reason}`,
      emitSyncEvents: false
    });
    if (!rollback.unchanged) rolledBackActionTypes.push(action.action_type);
  }

  await client.query(
    "UPDATE safety_cases SET updated_at = $2 WHERE id = $1",
    [normalized.caseId, normalized.now]
  );
  await client.query(
    `INSERT INTO safety_case_events (
       case_id, actor_type, actor_id, event_type, event_data, created_at
     ) VALUES ($1, 'admin', $2, 'report_marked_invalid', $3::jsonb, $4)`,
    [
      normalized.caseId,
      normalized.adminUserId,
      JSON.stringify({
        reportId: normalized.reportId,
        reason: normalized.reason,
        independentReporterCount: count,
        rolledBackActionTypes
      }),
      normalized.now
    ]
  );
  await recordAdminAuditEvent(client, {
    adminUserId: normalized.adminUserId,
    deviceId: normalized.deviceId,
    sessionId: normalized.sessionId,
    eventType: "safety.report_invalidated",
    subjectType: "report",
    subjectId: normalized.reportId,
    ip: normalized.ip,
    userAgent: normalized.userAgent,
    eventData: {
      caseId: normalized.caseId,
      reason: normalized.reason,
      independentReporterCount: count,
      rolledBackActionTypes
    }
  });
  const ownerId = await loadCaseOwnerId(client, safetyCase);
  return {
    unchanged: false,
    report: updated.rows[0],
    independentReporterCount: count,
    rolledBackActionTypes,
    syncEvents: await createSafetyCaseSyncEvents(client, {
      caseId: normalized.caseId,
      ownerId
    })
  };
}

function desiredAutomaticActionTypes(safetyCase, count, now) {
  return new Set(supportedInvalidContactActionTypes({
    caseRecord: safetyCase,
    reportCounts: { independentReporterCount7d: count },
    now
  }));
}

async function loadCaseOwnerId(client, safetyCase) {
  const source = {
    post: { table: "posts", owner: "author_id" },
    comment: { table: "comments", owner: "author_id" },
    direct_message: { table: "direct_messages", owner: "sender_id" },
    collection: { table: "group_collections", owner: "owner_id" },
    user: { table: "users", owner: "id" }
  }[safetyCase.subject_type];
  if (!source) throw adminError(400, "admin_case_target_invalid", "案件主体不受支持");
  const result = await client.query(
    `SELECT ${source.owner} AS owner_id FROM ${source.table} WHERE id = $1`,
    [safetyCase.subject_id]
  );
  if (!result.rows[0]?.owner_id) {
    throw adminError(404, "admin_case_target_not_found", "案件主体不存在");
  }
  return result.rows[0].owner_id;
}

function normalizeInvalidation(input) {
  const reason = requiredIdentifier(input.reason, "无效原因");
  if (!INVALID_REASONS.has(reason)) {
    throw adminError(400, "admin_report_invalid_reason", "举报无效原因不正确");
  }
  if (input.confirmed !== true) {
    throw adminError(400, "admin_report_confirmation_required", "请确认只标记当前举报");
  }
  return {
    caseId: requiredIdentifier(input.caseId, "案件 ID"),
    reportId: requiredIdentifier(input.reportId, "举报 ID"),
    reason,
    expectedVersion: requiredDateString(input.expectedVersion, "案件版本"),
    adminUserId: requiredIdentifier(input.adminUserId, "管理员 ID"),
    deviceId: optionalIdentifier(input.deviceId),
    sessionId: optionalIdentifier(input.sessionId),
    ip: typeof input.ip === "string" ? input.ip : "",
    userAgent: typeof input.userAgent === "string" ? input.userAgent : "",
    now: validDate(input.now ?? new Date())
  };
}

function requiredDateString(value, label) {
  if (typeof value !== "string" || !value) {
    throw adminError(400, "admin_request_invalid", `${label}无效`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    throw adminError(400, "admin_request_invalid", `${label}无效`);
  }
  return value;
}

function requiredIdentifier(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim() ||
      Array.from(value).length > 160 || /[\u0000\r\n]/u.test(value)) {
    throw adminError(400, "admin_request_invalid", `${label}无效`);
  }
  return value;
}

function optionalIdentifier(value) {
  if (value == null || value === "") return null;
  return requiredIdentifier(value, "标识");
}

function validDate(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("now must be a valid date");
  return date;
}

function requireClient(client) {
  if (!client || typeof client.query !== "function") {
    throw new TypeError("report abuse operations require a database client");
  }
}

function assertTransactionClient(client) {
  if (!client || typeof client.query !== "function" || typeof client.release !== "function") {
    throw new TypeError("markReportInvalid requires a transaction-scoped pg PoolClient");
  }
}

async function assertActiveTransaction(client) {
  try {
    await client.query(`SAVEPOINT ${TRANSACTION_PROBE}`);
    await client.query(`RELEASE SAVEPOINT ${TRANSACTION_PROBE}`);
  } catch (error) {
    const developerError = new TypeError("markReportInvalid requires an active transaction");
    developerError.cause = error;
    throw developerError;
  }
}

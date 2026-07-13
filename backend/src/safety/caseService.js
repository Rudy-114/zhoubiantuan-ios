import { randomUUID } from "node:crypto";
import { assertOwnedObjectKeys } from "../moderation/index.js";
import { createSyncEvent } from "../sync.js";
import { badRequest } from "../validators.js";
import { captureSourceEvidence } from "./evidenceService.js";
import { claimReportUploadsForAttachment } from "./reportUploadCleanup.js";
import { normalizeReportInput } from "./reportValidation.js";
import { resolveReportSubject } from "./subjectResolver.js";

const TERMINAL_CASE_STATUSES = new Set(["resolved_no_action", "resolved_restored", "resolved_actioned"]);

export async function submitSafetyReport(client, { reporterId, body } = {}) {
  const reporterID = requiredReporterID(reporterId);
  const input = normalizeReportInput(body);
  await lockReporterRequest(client, reporterID, input.clientRequestId);

  const exactReport = await findReportByRequest(client, reporterID, input.clientRequestId);
  if (exactReport) return unchanged(exactReport);
  const exactEvidence = await findEvidenceByRequest(client, reporterID, input.clientRequestId);
  if (exactEvidence) return unchanged(exactEvidence);

  const subject = await resolveReportSubject(client, {
    ...input,
    reporterId: reporterID
  });
  const sourceEvidence = await captureSourceEvidence(client, {
    reporterId: reporterID,
    sourceType: input.sourceType,
    sourceId: input.sourceId
  });
  const reportObjectKeys = assertOwnedObjectKeys(reporterID, input.objectKeys, ["report"]);
  await claimReportUploadsForAttachment(client, { ownerUserID: reporterID, objectKeys: reportObjectKeys });
  const objectKeys = mergeObjectKeys(sourceEvidence.objectKeys, reportObjectKeys);
  let safetyCase = await findOrCreateOpenCase(client, subject, input.reasonCode);
  await closeNonAggregatingPendingReports(client, reporterID, subject, input.reasonCode);
  safetyCase = await lockOpenCaseByID(client, safetyCase.id);
  if (!safetyCase) {
    safetyCase = await findOrCreateOpenCase(client, subject, input.reasonCode);
    await closeNonAggregatingPendingReports(client, reporterID, subject, input.reasonCode);
  }
  let pendingReport = await findPendingReport(client, reporterID, safetyCase.id, input.reasonCode);

  if (pendingReport) {
    return addSourceSupplement(client, {
      report: pendingReport,
      reporterID,
      input,
      sourceEvidence,
      objectKeys
    });
  }

  const insertedReport = await insertReport(client, {
    reporterID,
    input,
    subject,
    caseID: safetyCase.id
  });
  if (!insertedReport) {
    const racedExact = await findReportByRequest(client, reporterID, input.clientRequestId);
    if (racedExact) return unchanged(racedExact);

    pendingReport = await findPendingReport(client, reporterID, safetyCase.id, input.reasonCode);
    if (pendingReport) {
      return addSourceSupplement(client, {
        report: pendingReport,
        reporterID,
        input,
        sourceEvidence,
        objectKeys
      });
    }
    throw new Error("Unable to resolve safety report uniqueness conflict");
  }

  await insertEvidence(client, {
    caseID: safetyCase.id,
    reportID: insertedReport.id,
    clientRequestID: input.clientRequestId,
    evidenceType: sourceEvidence.evidenceType,
    textSnapshot: sourceEvidence.textSnapshot,
    structuredSnapshot: {
      source: sourceEvidence.structuredSnapshot,
      report: {
        reasonCode: input.reasonCode,
        reportedField: input.reportedField,
        detail: input.detail,
        supplemental: false
      }
    },
    objectKeys,
    contextStartMessageID: sourceEvidence.contextStartMessageId,
    contextEndMessageID: sourceEvidence.contextEndMessageId,
    retentionDeleteAt: sourceEvidence.retentionDeleteAt
  });
  await createCaseEvent(client, {
    caseID: safetyCase.id,
    reporterID,
    eventType: "report_received",
    eventData: { reportID: insertedReport.id, reasonCode: input.reasonCode }
  });
  await client.query(
    `INSERT INTO safety_jobs (job_type, case_id, unique_key, payload)
     VALUES ('case_received', $1, $2, $3::jsonb)
     ON CONFLICT (unique_key) DO NOTHING`,
    [safetyCase.id, `case_received:${insertedReport.id}`, JSON.stringify({ reportID: insertedReport.id })]
  );
  const syncEvent = await createSyncEvent(client, {
    userId: reporterID,
    eventType: "safety.report.updated",
    entityType: "safety_case",
    entityId: safetyCase.id
  });

  return { report: await loadReportByID(client, insertedReport.id), created: true, supplemented: false, duplicate: false, syncEvents: [syncEvent] };
}

export async function supplementSafetyReport(client, { reportId, reporterId, body } = {}) {
  const reporterID = requiredReporterID(reporterId);
  const input = normalizeSupplementInput(body);
  await lockReporterRequest(client, reporterID, input.clientRequestId);
  const report = await loadReportByID(client, reportId);
  if (!report) throw httpError(404, "举报记录不存在");
  if (report.reporter_id !== reporterID) throw httpError(403, "无权补充该举报");

  const priorReport = await findReportByRequest(client, reporterID, input.clientRequestId);
  if (priorReport) {
    if (priorReport.id === report.id) return unchanged(report);
    throw badRequest("请求 ID 已被使用");
  }
  const priorEvidence = await findEvidenceByRequest(client, reporterID, input.clientRequestId);
  if (priorEvidence) {
    if (priorEvidence.id === report.id) return unchanged(report);
    throw badRequest("请求 ID 已被使用");
  }
  if (report.status !== "pending" || TERMINAL_CASE_STATUSES.has(report.case_status)) {
    throw httpError(409, "举报已经结束，不能补充证据");
  }

  const objectKeys = assertOwnedObjectKeys(reporterID, input.objectKeys, ["report"]);
  await claimReportUploadsForAttachment(client, { ownerUserID: reporterID, objectKeys });
  const inserted = await insertEvidence(client, {
    caseID: report.case_id,
    reportID: report.id,
    clientRequestID: input.clientRequestId,
    evidenceType: "report_supplement",
    textSnapshot: input.detail,
    structuredSnapshot: { supplemental: true, detail: input.detail },
    objectKeys,
    contextStartMessageID: null,
    contextEndMessageID: null,
    retentionDeleteAt: null
  });
  if (!inserted) return unchanged(report);

  await client.query("UPDATE reports SET updated_at = now() WHERE id = $1", [report.id]);
  await createCaseEvent(client, {
    caseID: report.case_id,
    reporterID,
    eventType: "report_supplemented",
    eventData: { reportID: report.id }
  });
  const syncEvent = await createSyncEvent(client, {
    userId: reporterID,
    eventType: "safety.report.updated",
    entityType: "safety_case",
    entityId: report.case_id
  });
  return { report: await loadReportByID(client, report.id), created: false, supplemented: true, duplicate: false, syncEvents: [syncEvent] };
}

function normalizeSupplementInput(body = {}) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw badRequest("请求体必须是对象");
  const keys = Object.keys(body);
  if (keys.some((key) => !["clientRequestID", "detail", "objectKeys"].includes(key))) {
    throw badRequest("补充证据字段不正确");
  }
  const clientRequestId = requiredBoundedString(body.clientRequestID, "请求 ID", 128);
  const detail = optionalBoundedString(body.detail, "详细说明", 1000);
  const objectKeys = normalizedObjectKeys(body.objectKeys);
  if (!detail && !objectKeys.length) throw badRequest("请填写详细说明或上传证据");
  return { clientRequestId, detail, objectKeys };
}

async function addSourceSupplement(client, { report, reporterID, input, sourceEvidence, objectKeys }) {
  const inserted = await insertEvidence(client, {
    caseID: report.case_id,
    reportID: report.id,
    clientRequestID: input.clientRequestId,
    evidenceType: "report_supplement",
    textSnapshot: input.detail,
    structuredSnapshot: {
      supplemental: true,
      sourceEvidenceType: sourceEvidence.evidenceType,
      source: sourceEvidence.structuredSnapshot,
      reasonCode: input.reasonCode,
      reportedField: input.reportedField,
      detail: input.detail
    },
    objectKeys,
    contextStartMessageID: sourceEvidence.contextStartMessageId,
    contextEndMessageID: sourceEvidence.contextEndMessageId,
    retentionDeleteAt: sourceEvidence.retentionDeleteAt
  });
  if (!inserted) return unchanged(report);

  await client.query("UPDATE reports SET updated_at = now() WHERE id = $1", [report.id]);
  await createCaseEvent(client, {
    caseID: report.case_id,
    reporterID,
    eventType: "report_supplemented",
    eventData: { reportID: report.id, reasonCode: input.reasonCode }
  });
  const syncEvent = await createSyncEvent(client, {
    userId: reporterID,
    eventType: "safety.report.updated",
    entityType: "safety_case",
    entityId: report.case_id
  });
  return { report: await loadReportByID(client, report.id), created: false, supplemented: true, duplicate: true, syncEvents: [syncEvent] };
}

async function findOrCreateOpenCase(client, subject, category) {
  const existing = await findOpenCase(client, subject, category);
  if (existing) return existing;

  const { rows } = await client.query(
    `INSERT INTO safety_cases (id, subject_type, subject_id, category, impact_scope)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [`sc-${randomUUID()}`, subject.subjectType, subject.subjectId, category, subject.impactScope]
  );
  if (rows[0]) return rows[0];

  const raced = await findOpenCase(client, subject, category);
  if (raced) return raced;
  throw new Error("Unable to create safety case");
}

async function findOpenCase(client, subject, category) {
  const { rows } = await client.query(
    `SELECT *
     FROM safety_cases
     WHERE subject_type = $1
       AND subject_id = $2
       AND category = $3
       AND status NOT IN ('appealed', 'resolved_no_action', 'resolved_restored', 'resolved_actioned')
     LIMIT 1
     FOR UPDATE`,
    [subject.subjectType, subject.subjectId, category]
  );
  return rows[0] || null;
}

async function lockOpenCaseByID(client, caseID) {
  const { rows } = await client.query(
    `SELECT *
     FROM safety_cases
     WHERE id = $1
       AND status NOT IN ('appealed', 'resolved_no_action', 'resolved_restored', 'resolved_actioned')
     FOR UPDATE`,
    [caseID]
  );
  return rows[0] || null;
}

async function closeNonAggregatingPendingReports(client, reporterID, subject, reasonCode) {
  await client.query(
    `UPDATE reports r
     SET status = 'closed', updated_at = now()
     FROM safety_cases sc
     WHERE r.case_id = sc.id
       AND r.reporter_id = $1
       AND r.subject_type = $2
       AND r.subject_id = $3
       AND r.reason_code = $4
       AND r.status = 'pending'
       AND sc.status IN ('appealed', 'resolved_no_action', 'resolved_restored', 'resolved_actioned')`,
    [reporterID, subject.subjectType, subject.subjectId, reasonCode]
  );
}

async function findPendingReport(client, reporterID, caseID, reasonCode) {
  const { rows } = await client.query(
    `${reportSelect}
     WHERE r.reporter_id = $1
       AND r.case_id = $2
       AND r.reason_code = $3
       AND r.status = 'pending'
     LIMIT 1`,
    [reporterID, caseID, reasonCode]
  );
  return rows[0] || null;
}

async function insertReport(client, { reporterID, input, subject, caseID }) {
  const { rows } = await client.query(
    `INSERT INTO reports (
       id, target_type, target_id, reason, detail, reporter_id, status,
       client_request_id, case_id, source_type, source_id, subject_type, subject_id, reason_code, reported_field
     ) VALUES (
       $1, $2, $3, $4, $5, $6, 'pending',
       $7, $8, $9, $10, $11, $12, $13, $14
     )
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      `rp-${randomUUID()}`,
      input.sourceType,
      input.sourceId,
      input.reasonCode,
      input.detail,
      reporterID,
      input.clientRequestId,
      caseID,
      input.sourceType,
      input.sourceId,
      subject.subjectType,
      subject.subjectId,
      input.reasonCode,
      input.reportedField
    ]
  );
  return rows[0] || null;
}

async function insertEvidence(client, input) {
  const { rows } = await client.query(
    `INSERT INTO safety_evidence (
       id, case_id, report_id, client_request_id, evidence_type, text_snapshot, structured_snapshot,
       object_keys, context_start_message_id, context_end_message_id, retention_delete_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7::jsonb,
       $8, $9, $10, $11
     )
     ON CONFLICT (report_id, client_request_id)
       WHERE report_id IS NOT NULL AND client_request_id IS NOT NULL
       DO NOTHING
     RETURNING *`,
    [
      `se-${randomUUID()}`,
      input.caseID,
      input.reportID,
      input.clientRequestID,
      input.evidenceType,
      input.textSnapshot,
      JSON.stringify(input.structuredSnapshot),
      input.objectKeys,
      input.contextStartMessageID,
      input.contextEndMessageID,
      input.retentionDeleteAt
    ]
  );
  return rows[0] || null;
}

async function createCaseEvent(client, { caseID, reporterID, eventType, eventData }) {
  await client.query(
    `INSERT INTO safety_case_events (case_id, actor_type, actor_id, event_type, event_data)
     VALUES ($1, 'reporter', $2, $3, $4::jsonb)`,
    [caseID, reporterID, eventType, JSON.stringify(eventData)]
  );
}

async function findReportByRequest(client, reporterID, clientRequestID) {
  const { rows } = await client.query(
    `${reportSelect}
     WHERE r.reporter_id = $1 AND r.client_request_id = $2
     LIMIT 1`,
    [reporterID, clientRequestID]
  );
  return rows[0] || null;
}

async function findEvidenceByRequest(client, reporterID, clientRequestID) {
  const { rows } = await client.query(
    `${reportSelect}
     JOIN safety_evidence e ON e.report_id = r.id
     WHERE r.reporter_id = $1 AND e.client_request_id = $2
     LIMIT 1`,
    [reporterID, clientRequestID]
  );
  return rows[0] || null;
}

async function lockReporterRequest(client, reporterID, clientRequestID) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, $2::bigint))",
    [`${reporterID}:${clientRequestID}`, "0"]
  );
}

async function loadReportByID(client, reportID) {
  const { rows } = await client.query(`${reportSelect} WHERE r.id = $1 LIMIT 1`, [reportID]);
  return rows[0] || null;
}

const reportSelect = `SELECT r.*, sc.status AS case_status
  FROM reports r
  LEFT JOIN safety_cases sc ON sc.id = r.case_id`;

function requiredReporterID(value) {
  if (typeof value !== "string" || !value.trim()) throw badRequest("举报人无效");
  return value.trim();
}

function requiredBoundedString(value, label, limit) {
  if (typeof value !== "string") throw badRequest(`${label}必须是字符串`);
  const text = value.trim();
  if (!text) throw badRequest(`${label}不能为空`);
  if (Array.from(text).length > limit) throw badRequest(`${label}不能超过 ${limit} 个字符`);
  return text;
}

function optionalBoundedString(value, label, limit) {
  if (value == null) return "";
  if (typeof value !== "string") throw badRequest(`${label}必须是字符串`);
  const text = value.trim();
  if (Array.from(text).length > limit) throw badRequest(`${label}不能超过 ${limit} 个字符`);
  return text;
}

function normalizedObjectKeys(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw badRequest("证据必须是数组");
  if (value.length > 6) throw badRequest("证据最多上传 6 项");
  const result = [];
  const seen = new Set();
  for (const valueItem of value) {
    if (typeof valueItem !== "string") throw badRequest("证据必须是字符串");
    const key = valueItem.trim();
    if (!key) throw badRequest("证据不能为空");
    if (!seen.has(key)) {
      seen.add(key);
      result.push(key);
    }
  }
  return result;
}

function mergeObjectKeys(...groups) {
  return [...new Set(groups.flat().filter((key) => typeof key === "string" && key))];
}

function unchanged(report) {
  return { report, created: false, supplemented: false, duplicate: true, syncEvents: [] };
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const REVIEWING_CASE_STATUSES = new Set([
  "triaging",
  "monitoring",
  "manual_review",
  "awaiting_correction",
  "rechecking",
  "appealed"
]);

export function safetyReportToClient(row = {}) {
  const sourceType = row.source_type || row.target_type || "";
  const sourceID = row.source_id || row.target_id || "";
  const subjectType = row.subject_type || row.target_type || sourceType;
  const subjectID = row.subject_id || row.target_id || sourceID;

  return {
    id: row.id || "",
    caseID: row.case_id || "",
    sourceType,
    sourceID,
    subjectType,
    subjectID,
    reasonCode: row.reason_code || "other",
    reportedField: row.reported_field || "content",
    detail: row.detail || "",
    status: publicReportStatus(row.case_status, row.status),
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at || row.created_at)
  };
}

export function safetyReportToBootstrapClient(row = {}, reporterID = "") {
  const report = safetyReportToClient(row);
  return {
    ...report,
    target: { type: report.sourceType, id: report.sourceID },
    reason: typeof row.reason === "string" && row.reason.trim() ? row.reason : report.reasonCode,
    reporterID,
    adminResult: null,
    handledAt: null
  };
}

function publicReportStatus(caseStatus, reportStatus) {
  if (caseStatus === "received") return "received";
  if (REVIEWING_CASE_STATUSES.has(caseStatus)) return "reviewing";
  if (caseStatus === "resolved_no_action") return "no_violation";
  if (caseStatus === "resolved_restored" || caseStatus === "resolved_actioned") return "handled";

  if (reportStatus === "pending") return "received";
  if (reportStatus === "closed") return "handled";
  return "reviewing";
}

function isoDate(value) {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function adminCaseListItem(row) {
  const updatedAt = isoDate(row.updated_at);
  return {
    id: row.id,
    subjectType: row.subject_type,
    subjectID: row.subject_id,
    subjectTitle: row.subject_title || row.subject_id,
    category: row.category,
    impactScope: row.impact_scope,
    status: row.status,
    riskLevel: row.risk_level,
    reportCount: Number(row.report_count || 0),
    independentReporterCount: Number(row.independent_reporter_count || 0),
    correctionDueAt: isoDate(row.correction_due_at),
    manualHold: Boolean(row.manual_hold),
    version: updatedAt,
    updatedAt
  };
}

export function adminCaseDetail({
  row,
  reports = [],
  evidence = [],
  events = [],
  actions = [],
  revisions = [],
  appeal = null,
  relatedCases = []
}) {
  const reporterLabels = stableReporterLabels(reports);
  return {
    ...adminCaseListItem(row),
    subjectOwnerID: row.subject_owner_id || null,
    aiRecommendation: safeObject(row.ai_recommendation),
    reports: reports.map((report) => ({
      id: report.id,
      reporterLabel: reporterLabels.get(report.reporter_id),
      reasonCode: report.reason_code,
      reportedField: report.reported_field,
      hasDetail: Boolean(report.detail),
      status: report.status,
      countsTowardThreshold: Boolean(report.counts_toward_threshold),
      countingReason: report.counting_reason || "status_not_counted",
      invalidReason: invalidReportReason(report.admin_result),
      createdAt: isoDate(report.created_at),
      updatedAt: isoDate(report.updated_at)
    })),
    evidence: evidence.map((item) => ({
      id: item.id,
      type: item.evidence_type,
      hasText: Boolean(item.has_text),
      hasStructuredData: Boolean(item.has_structured_data),
      objectCount: Number(item.object_count || 0),
      contextStartMessageID: item.context_start_message_id || null,
      contextEndMessageID: item.context_end_message_id || null,
      redactedAt: isoDate(item.redacted_at),
      createdAt: isoDate(item.created_at)
    })),
    events: events.map((event) => ({
      id: String(event.id),
      actorType: event.actor_type,
      actorLabel: event.actor_type === "reporter"
        ? reporterLabels.get(event.actor_id) || "举报人"
        : event.actor_id || event.actor_type,
      type: event.event_type,
      data: safeObject(event.event_data),
      createdAt: isoDate(event.created_at)
    })),
    actions: actions.map((action) => ({
      id: action.id,
      type: action.action_type,
      targetType: action.target_type,
      targetID: action.target_id,
      actorType: action.actor_type,
      reason: action.reason,
      status: action.execution_status,
      appliedAt: isoDate(action.applied_at),
      rolledBackAt: isoDate(action.rolled_back_at),
      createdAt: isoDate(action.created_at)
    })),
    revisions: revisions.map((revision) => ({
      id: revision.id,
      number: Number(revision.revision_number),
      status: revision.status,
      snapshot: revisionSnapshot(revision.snapshot),
      objectCount: Number(revision.object_count || 0),
      reviewSummary: safeObject(revision.review_summary),
      reviewedAt: isoDate(revision.reviewed_at),
      publishedAt: isoDate(revision.published_at),
      createdAt: isoDate(revision.created_at)
    })),
    appeal: appeal ? {
      id: appeal.id,
      decisionActionID: appeal.decision_action_id,
      hasDetail: Boolean(appeal.detail),
      status: appeal.status,
      handledReason: appeal.handled_reason || "",
      handledAt: isoDate(appeal.handled_at),
      createdAt: isoDate(appeal.created_at)
    } : null,
    relatedCases: relatedCases.map(adminCaseListItem)
  };
}

function invalidReportReason(value) {
  const match = /^report_invalid:(malicious|coordinated|mistaken_target|other)$/u.exec(value || "");
  return match?.[1] || null;
}

function stableReporterLabels(reports) {
  const labels = new Map();
  for (const report of reports) {
    if (!labels.has(report.reporter_id)) {
      labels.set(report.reporter_id, `举报人 ${labels.size + 1}`);
    }
  }
  return labels;
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stripObjectKeys(value) {
  if (Array.isArray(value)) return value.map(stripObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !normalizeKey(key).includes("objectkey"))
      .map(([key, nested]) => [key, stripObjectKeys(nested)])
  );
}

function revisionSnapshot(value) {
  const source = safeObject(value);
  return {
    ...stripObjectKeys(source),
    imageURLs: Array.isArray(source.imageObjectKeys)
      ? source.imageObjectKeys.map(sameOriginAssetURL)
      : [],
    previewImageURLs: Array.isArray(source.previewImageObjectKeys)
      ? source.previewImageObjectKeys.map(sameOriginAssetURL)
      : []
  };
}

function sameOriginAssetURL(objectKey) {
  const encoded = String(objectKey)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `/admin/api/assets/${encoded}`;
}

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/gu, "");
}

function isoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

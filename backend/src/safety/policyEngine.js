import { validateQwenCaseResult } from "./schemas/qwenCaseResult.js";

const CONTENT_HIDE_BY_SUBJECT = Object.freeze({
  post: "hide_post",
  comment: "hide_comment",
  direct_message: "hide_message"
});

const TERMINAL_CASE_STATUSES = new Set([
  "resolved_no_action",
  "resolved_restored",
  "resolved_actioned"
]);

export function evaluateSafetyPolicy(input = {}) {
  if (input.mode === "off" || !input.qwenResult) return manual("ai_off_or_unavailable");
  if (!new Set(["shadow", "enforce"]).has(input.mode)) return manual("invalid_mode");

  const caseRecord = safeObject(input.caseRecord);
  if (!validCaseRecord(caseRecord)) return manual("invalid_case_record");
  if (caseRecord.manual_hold || caseRecord.status === "appealed") return manual("manual_hold");
  if (TERMINAL_CASE_STATUSES.has(caseRecord.status)) return manual("case_not_open");

  let qwenResult;
  try {
    qwenResult = validateQwenCaseResult(input.qwenResult);
  } catch {
    return manual("invalid_provider_result");
  }

  if (qwenResult.subjectType !== caseRecord.subject_type ||
      qwenResult.impactScope !== caseRecord.impact_scope) {
    return manual("scope_expansion_rejected");
  }
  if (caseRecord.subject_type === "user") return manual("account_action_human_only");
  if (input.hasValidRevision === true) {
    const revisionSafe = qwenResult.category === caseRecord.category &&
      qwenResult.riskLevel === "none" && qwenResult.recommendedAction === "no_action" &&
      qwenResult.requiresHuman === false && qwenResult.evidence.length > 0 &&
      isHardSafetyPass(input.hardSignal);
    if (!revisionSafe) return manual("revision_requires_human");
    return decision({
      nextStatus: "manual_review",
      proposedActions: [],
      requiresHuman: false,
      reasonCodes: ["revision_safe_to_publish"]
    });
  }
  if (caseRecord.category === "copyright_or_stolen_media") return manual("copyright_human_only");

  if (caseRecord.category === "invalid_contact") {
    if (qwenResult.category !== "invalid_contact") return manual("provider_category_mismatch");
    return invalidContactPolicy(input, caseRecord);
  }

  const actionType = CONTENT_HIDE_BY_SUBJECT[caseRecord.subject_type];
  if (!actionType) return manual("subject_action_human_only");
  if (qwenResult.category !== caseRecord.category) return manual("provider_category_mismatch");

  if (caseRecord.category === "sexual_or_illegal" &&
      ["high", "urgent"].includes(qwenResult.riskLevel) && isHighHardSignal(input.hardSignal)) {
    return decision({
      nextStatus: "manual_review",
      proposedActions: [contentAction(actionType, caseRecord)],
      requiresHuman: true,
      reasonCodes: ["hard_sexual_or_illegal"]
    });
  }

  if (caseRecord.category === "suspected_scam" &&
      ["high", "urgent"].includes(qwenResult.riskLevel) &&
      qwenResult.confidence >= 0.95 && isHighHardSignal(input.hardSignal)) {
    return decision({
      nextStatus: "manual_review",
      proposedActions: [contentAction(actionType, caseRecord)],
      requiresHuman: true,
      reasonCodes: ["hard_suspected_scam"]
    });
  }

  return manual("policy_no_automatic_match");
}

export function supportedInvalidContactActionTypes(input = {}) {
  const caseRecord = safeObject(input.caseRecord);
  if (caseRecord.category !== "invalid_contact" ||
      caseRecord.subject_type !== "collection" || caseRecord.impact_scope !== "collection") {
    return [];
  }
  const count = independentReporterCount7d(input.reportCounts);
  if (count < 1) return [];
  const supported = ["request_correction"];
  if (count >= 2) supported.push("hide_collection_contact");
  const now = policyNow(input.now);
  const dueAt = dateOrNull(caseRecord.correction_due_at);
  if (caseRecord.status === "awaiting_correction" && now && dueAt && dueAt.getTime() <= now.getTime()) {
    supported.push("suspend_collection");
  }
  return supported;
}

function invalidContactPolicy(input, caseRecord) {
  if (caseRecord.subject_type !== "collection" || caseRecord.impact_scope !== "collection") {
    return manual("invalid_contact_scope_human_only");
  }
  const now = policyNow(input.now);
  if (!now) return manual("invalid_policy_time");
  const count = independentReporterCount7d(input.reportCounts);
  if (count < 1) return manual("invalid_report_counts");

  if (caseRecord.status === "awaiting_correction") {
    const dueAt = dateOrNull(caseRecord.correction_due_at);
    if (!dueAt) return manual("invalid_correction_deadline");
    if (dueAt.getTime() <= now.getTime()) {
      if (input.hasValidRevision === true) return manual("valid_revision_human_review");
      return decision({
        nextStatus: "manual_review",
        proposedActions: [action("suspend_collection", caseRecord)],
        requiresHuman: true,
        reasonCodes: ["invalid_contact_correction_expired"]
      });
    }
    return decision({
      nextStatus: "awaiting_correction",
      proposedActions: count >= 2 ? [action("hide_collection_contact", caseRecord)] : [],
      requiresHuman: false,
      reasonCodes: [count >= 2 ? "invalid_contact_repeated" : "correction_pending"]
    });
  }

  const correctionDueAt = new Date(now.getTime() + (24 * 60 * 60 * 1_000)).toISOString();
  const proposedActions = [
    { ...action("request_correction", caseRecord), correctionDueAt }
  ];
  if (count >= 2) proposedActions.push(action("hide_collection_contact", caseRecord));
  return decision({
    nextStatus: "awaiting_correction",
    proposedActions,
    requiresHuman: false,
    reasonCodes: [count >= 2 ? "invalid_contact_repeated" : "invalid_contact_first_report"]
  });
}

function independentReporterCount7d(value) {
  const counts = safeObject(value);
  const count = counts.independentReporterCount7d ?? counts.independent_reporter_count_7d;
  return Number.isSafeInteger(count) && count >= 0 ? count : -1;
}

function isHighHardSignal(value) {
  const signal = safeObject(value);
  const summary = safeObject(signal.rawSummary || signal.raw_summary);
  const highRisk = signal.riskLevel === "high" || signal.riskLevel === "urgent" ||
    signal.risk_level === "high" || signal.risk_level === "urgent";
  const blocked = signal.outcome === "block" || signal.hasHighRisk === true ||
    signal.has_high_risk === true || summary.hasHighRisk === true || summary.has_high_risk === true;
  return highRisk && blocked;
}

function isHardSafetyPass(value) {
  const signal = safeObject(value);
  const hardSafety = safeObject(signal.hardSafety || signal.hard_safety);
  return signal.outcome === "pass" && (signal.riskLevel === "none" || signal.risk_level === "none") &&
    hardSafety.provider === "aliyun" && hardSafety.passed === true;
}

function validCaseRecord(value) {
  return typeof value.subject_type === "string" && value.subject_type &&
    typeof value.subject_id === "string" && value.subject_id &&
    typeof value.impact_scope === "string" && value.impact_scope &&
    typeof value.category === "string" && value.category &&
    typeof value.status === "string" && value.status;
}

function contentAction(actionType, caseRecord) {
  return action(actionType, caseRecord);
}

function action(actionType, caseRecord) {
  return {
    actionType,
    targetType: caseRecord.subject_type,
    targetId: caseRecord.subject_id
  };
}

function manual(reasonCode) {
  return decision({
    nextStatus: "manual_review",
    proposedActions: [],
    requiresHuman: true,
    reasonCodes: [reasonCode]
  });
}

function decision(value) {
  return deepFreeze({
    nextStatus: value.nextStatus,
    proposedActions: value.proposedActions,
    requiresHuman: value.requiresHuman,
    reasonCodes: value.reasonCodes
  });
}

function policyNow(value) {
  const date = value == null ? new Date() : value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

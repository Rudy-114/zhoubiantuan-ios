export const moderationOutcomes = {
  pass: "pass",
  review: "review",
  block: "block"
};

export function normalizeModerationResult(result = {}) {
  const outcome = [moderationOutcomes.pass, moderationOutcomes.review, moderationOutcomes.block].includes(result.outcome)
    ? result.outcome
    : moderationOutcomes.review;
  return {
    outcome,
    status: outcome === moderationOutcomes.pass ? "active" : outcome === moderationOutcomes.block ? "rejected" : "review",
    riskLevel: result.riskLevel || (outcome === moderationOutcomes.block ? "high" : outcome === moderationOutcomes.review ? "medium" : "none"),
    source: result.source || "systemRule",
    reason: result.reason || defaultReason(outcome),
    rawSummary: result.rawSummary || {}
  };
}

export function combineModerationResults(results) {
  const normalized = results.map(normalizeModerationResult);
  const blocked = normalized.find((result) => result.outcome === moderationOutcomes.block);
  if (blocked) return blocked;
  const review = normalized.find((result) => result.outcome === moderationOutcomes.review);
  if (review) return review;
  return normalizeModerationResult({ outcome: moderationOutcomes.pass, reason: "审核通过" });
}

export function moderationErrorResult(error, source = "systemRule") {
  return normalizeModerationResult({
    outcome: moderationOutcomes.review,
    riskLevel: "medium",
    source,
    reason: "审核服务暂时不可用，已转入人工审核",
    rawSummary: {
      error: error?.message || String(error || "unknown")
    }
  });
}

function defaultReason(outcome) {
  if (outcome === moderationOutcomes.block) return "内容未通过审核";
  if (outcome === moderationOutcomes.review) return "内容已提交人工审核";
  return "审核通过";
}

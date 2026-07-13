export function contentActionToClient(row) {
  return {
    caseID: row.case_id,
    targetType: row.subject_type,
    targetID: row.subject_id,
    targetTitle: row.target_title,
    category: row.category,
    status: row.status,
    affectedFields: row.affected_fields || [],
    reason: row.revision_status === "rejected" && row.revision_reason
      ? row.revision_reason
      : row.owner_reason || "内容需要整改",
    currentRestriction: row.current_restriction || "",
    correctionDueAt: row.correction_due_at?.toISOString() || null,
    canSubmitRevision: row.status === "awaiting_correction",
    canAppeal: Boolean(row.can_appeal),
    revisionStatus: row.revision_status || null,
    updatedAt: row.updated_at.toISOString()
  };
}

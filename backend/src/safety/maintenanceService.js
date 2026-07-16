import { createSyncEventsForUsers } from "../sync.js";
import { applySafetyAction } from "./actionService.js";
import { enqueueSafetyJob as enqueueSafetyJobDefault } from "./jobQueue.js";
import { loadRetainedSafetyObjectKeys } from "./objectRetention.js";

const MAINTENANCE_BATCH_SIZE = 100;

export async function processCorrectionDeadlines(client, { now = new Date() } = {}) {
  const maintenanceNow = requiredDate(now, "now");
  const { rows } = await client.query(
    `SELECT sc.id, sc.subject_type, sc.subject_id
     FROM safety_cases sc
     WHERE sc.category = 'invalid_contact'
       AND sc.subject_type = 'collection'
       AND sc.status = 'awaiting_correction'
       AND sc.correction_due_at <= $1
       AND NOT EXISTS (
         SELECT 1
         FROM content_revisions revision
         WHERE revision.case_id = sc.id
           AND revision.status IN ('pending', 'reviewing', 'approved')
       )
       AND NOT EXISTS (
         SELECT 1
         FROM safety_actions action
         WHERE action.idempotency_key = 'deadline:suspend_collection:' || sc.id
       )
     ORDER BY sc.correction_due_at, sc.id
     FOR UPDATE OF sc SKIP LOCKED
     LIMIT $2`,
    [maintenanceNow, MAINTENANCE_BATCH_SIZE]
  );

  for (const safetyCase of rows) {
    await applySafetyAction(client, {
      caseId: safetyCase.id,
      idempotencyKey: `deadline:suspend_collection:${safetyCase.id}`,
      actionType: "suspend_collection",
      targetType: safetyCase.subject_type,
      targetId: safetyCase.subject_id,
      actorType: "system",
      reason: "correction_deadline_expired"
    });
  }
  return { processed: rows.length };
}

export async function closeLowRiskCases(client, { now = new Date() } = {}) {
  const maintenanceNow = requiredDate(now, "now");
  const { rows } = await client.query(
    `SELECT sc.id,
            ARRAY(
              SELECT DISTINCT report.reporter_id
              FROM reports report
              WHERE report.case_id = sc.id
              ORDER BY report.reporter_id
            ) AS reporter_ids
     FROM safety_cases sc
     WHERE sc.status = 'monitoring'
       AND sc.risk_level IN ('none', 'low')
       AND sc.manual_hold = false
       AND sc.updated_at <= $1::timestamptz - interval '7 days'
       AND NOT EXISTS (
         SELECT 1
         FROM reports report
         WHERE report.case_id = sc.id
           AND report.status <> 'invalid'
           AND report.created_at > $1::timestamptz - interval '7 days'
       )
       AND NOT EXISTS (
         SELECT 1
         FROM safety_actions action
         WHERE action.case_id = sc.id
           AND action.execution_status = 'applied'
       )
       AND NOT EXISTS (
         SELECT 1
         FROM safety_ai_runs run
         WHERE run.case_id = sc.id
           AND run.hard_signal <> '{}'::jsonb
           AND NOT (
             run.hard_signal->>'outcome' = 'pass'
             AND COALESCE(run.hard_signal->>'riskLevel', run.hard_signal->>'risk_level') = 'none'
             AND COALESCE(
               run.hard_signal->>'hasHighRisk',
               run.hard_signal->>'has_high_risk',
               run.hard_signal->'rawSummary'->>'hasHighRisk',
               run.hard_signal->'raw_summary'->>'has_high_risk',
               'false'
             ) <> 'true'
           )
       )
     ORDER BY sc.updated_at, sc.id
     FOR UPDATE OF sc SKIP LOCKED
     LIMIT $2`,
    [maintenanceNow, MAINTENANCE_BATCH_SIZE]
  );

  const syncEvents = [];
  for (const safetyCase of rows) {
    await client.query(
      `UPDATE safety_cases
       SET status = 'resolved_no_action', resolved_at = $2,
           correction_due_at = NULL, updated_at = $2
       WHERE id = $1`,
      [safetyCase.id, maintenanceNow]
    );
    await client.query(
      `UPDATE reports
       SET status = 'closed', handled_at = COALESCE(handled_at, $2), updated_at = $2
       WHERE case_id = $1 AND status = 'pending'`,
      [safetyCase.id, maintenanceNow]
    );
    await client.query(
      `INSERT INTO safety_case_events (case_id, actor_type, event_type, event_data, created_at)
       VALUES ($1, 'system', 'maintenance_low_risk_closed', '{}', $2)`,
      [safetyCase.id, maintenanceNow]
    );
    syncEvents.push(...await createSyncEventsForUsers(client, {
      userIds: safetyCase.reporter_ids,
      eventType: "safety.report.updated",
      entityType: "safety_case",
      entityId: safetyCase.id
    }));
  }
  return { processed: rows.length, syncEvents };
}

export async function clearExpiredEvidence(client, {
  now = new Date(),
  enqueueSafetyJob = enqueueSafetyJobDefault
} = {}) {
  const maintenanceNow = requiredDate(now, "now");
  const { rows } = await client.query(
    `WITH candidates AS MATERIALIZED (
       SELECT evidence.id, evidence.case_id, evidence.object_keys
       FROM safety_evidence evidence
       JOIN safety_cases sc ON sc.id = evidence.case_id
       WHERE sc.subject_type = 'direct_message'
         AND sc.status IN ('resolved_no_action', 'resolved_restored', 'resolved_actioned')
         AND sc.resolved_at <= $1::timestamptz - interval '180 days'
         AND evidence.redacted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM safety_appeals appeal
           WHERE appeal.case_id = sc.id AND appeal.status = 'pending'
         )
       ORDER BY sc.resolved_at, evidence.id
       FOR UPDATE OF evidence SKIP LOCKED
       LIMIT $2
     )
     UPDATE safety_evidence evidence
     SET text_snapshot = '',
         structured_snapshot = jsonb_build_object('redacted', true, 'reason', 'retention_expired'),
         object_keys = ARRAY[]::text[],
         redacted_at = $1
     FROM candidates
     WHERE evidence.id = candidates.id
     RETURNING evidence.id, candidates.case_id, candidates.object_keys`,
    [maintenanceNow, MAINTENANCE_BATCH_SIZE]
  );
  const candidateKeys = [...new Set(rows.flatMap((row) => row.object_keys || []))];
  const retainedKeys = await loadRetainedSafetyObjectKeys(client, candidateKeys);
  const deletionRows = rows.map((row) => ({
    ...row,
    object_keys: (row.object_keys || []).filter((objectKey) => !retainedKeys.has(objectKey))
  }));
  for (const row of deletionRows) {
    if (!row.object_keys?.length) continue;
    await enqueueSafetyJob(client, {
      type: "delete_retained_evidence_objects",
      caseId: row.case_id,
      uniqueKey: `delete_retained_evidence_objects:${row.id}`,
      payload: { objectKeys: row.object_keys },
      maxAttempts: 20
    });
  }
  const caseIds = [...new Set(rows.map((row) => row.case_id))];
  if (caseIds.length) {
    await client.query(
      "UPDATE safety_ai_runs SET raw_response = '' WHERE case_id = ANY($1::text[])",
      [caseIds]
    );
  }
  const objectKeys = [...new Set(deletionRows.flatMap((row) => row.object_keys || []))].sort();
  return { processed: rows.length, objectKeys };
}

export async function deidentifyExpiredAudit(client, { now = new Date() } = {}) {
  const maintenanceNow = requiredDate(now, "now");
  const { rows } = await client.query(
    `SELECT audit.id
     FROM admin_audit_events audit
     WHERE audit.created_at <= $1::timestamptz - interval '2 years'
       AND NOT EXISTS (
         SELECT 1
         FROM safety_cases sc
         WHERE (
           sc.id = audit.subject_id
           OR sc.id = audit.event_data->>'caseId'
           OR EXISTS (
             SELECT 1 FROM safety_ai_runs run
             WHERE run.id = audit.subject_id AND run.case_id = sc.id
           )
         )
           AND (
             sc.status NOT IN ('resolved_no_action', 'resolved_restored', 'resolved_actioned')
             OR EXISTS (
               SELECT 1 FROM safety_appeals appeal
               WHERE appeal.case_id = sc.id AND appeal.status = 'pending'
             )
           )
       )
       AND (
         audit.admin_user_id IS NOT NULL
         OR audit.device_id IS NOT NULL
         OR audit.session_id IS NOT NULL
         OR audit.subject_id IS NOT NULL
         OR audit.ip_hash <> ''
         OR audit.user_agent_summary <> ''
         OR audit.event_data - 'outcome' <> '{}'::jsonb
         OR audit.created_at <> date_trunc('month', audit.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
       )
     ORDER BY audit.created_at, audit.id
     FOR UPDATE OF audit SKIP LOCKED
     LIMIT $2`,
    [maintenanceNow, MAINTENANCE_BATCH_SIZE]
  );
  const ids = rows.map((row) => row.id);
  if (!ids.length) return { deidentified: 0, deleted: 0 };

  const deleted = await client.query(
    `DELETE FROM admin_audit_events
     WHERE id = ANY($1::bigint[])
       AND event_type ~ '^admin\\..*_failed$'`,
    [ids]
  );
  const deidentified = await client.query(
    `UPDATE admin_audit_events
     SET admin_user_id = NULL,
         device_id = NULL,
         session_id = NULL,
         subject_id = NULL,
         ip_hash = '',
         user_agent_summary = '',
         event_data = CASE
           WHEN event_data ? 'outcome' THEN jsonb_build_object('outcome', event_data->'outcome')
           WHEN event_data ? 'decision' THEN jsonb_build_object('outcome', event_data->'decision')
           WHEN event_data ? 'restricted' THEN jsonb_build_object('outcome', event_data->'restricted')
           ELSE '{}'::jsonb
         END,
         created_at = date_trunc('month', created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
     WHERE id = ANY($1::bigint[])
     RETURNING id`,
    [ids]
  );
  return { deidentified: deidentified.rowCount, deleted: deleted.rowCount };
}

function requiredDate(value, name) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${name} must be a valid date`);
  return date;
}

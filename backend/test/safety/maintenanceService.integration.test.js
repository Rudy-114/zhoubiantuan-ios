import assert from "node:assert/strict";
import test from "node:test";
import { pool as applicationPool, withTransaction } from "../../src/db.js";
import {
  createMaintenanceJobHandlers,
  MAINTENANCE_JOB_TYPES,
  startSafetyMaintenanceScheduler
} from "../../src/safety/jobWorker.js";
import { claimSafetyJobs, completeSafetyJob } from "../../src/safety/jobQueue.js";
import {
  clearExpiredEvidence,
  closeLowRiskCases,
  deidentifyExpiredAudit,
  processCorrectionDeadlines
} from "../../src/safety/maintenanceService.js";
import { closeDatabase, pool, resetDatabase } from "../helpers/database.js";

const NOW = new Date("2026-07-20T08:00:00.000Z");

test.beforeEach(resetDatabase);
test.after(async () => {
  await Promise.all([closeDatabase(), applicationPool.end()]);
});

test("overdue invalid-contact correction suspends its collection exactly once", async () => {
  await seedCollectionCase({
    caseId: "case-overdue",
    status: "awaiting_correction",
    correctionDueAt: NOW
  });

  const first = await withTransaction((client) => processCorrectionDeadlines(client, { now: NOW }));
  const second = await withTransaction((client) => processCorrectionDeadlines(client, { now: NOW }));

  assert.deepEqual(first, { processed: 1 });
  assert.deepEqual(second, { processed: 0 });
  assert.equal((await pool.query(
    "SELECT safety_status FROM group_collections WHERE id = 'collection-maintenance'"
  )).rows[0].safety_status, "suspended");
  const actions = await pool.query(
    `SELECT idempotency_key, action_type, execution_status
     FROM safety_actions
     WHERE idempotency_key = 'deadline:suspend_collection:case-overdue'`
  );
  assert.deepEqual(actions.rows, [{
    idempotency_key: "deadline:suspend_collection:case-overdue",
    action_type: "suspend_collection",
    execution_status: "applied"
  }]);
});

test("overdue correction with a pending revision does not suspend the collection", async () => {
  await seedCollectionCase({
    caseId: "case-pending-revision",
    status: "awaiting_correction",
    correctionDueAt: NOW
  });
  await pool.query(
    `INSERT INTO content_revisions (
       id, case_id, target_type, target_id, owner_id, revision_number, snapshot, status
     ) VALUES (
       'revision-pending', 'case-pending-revision', 'collection', 'collection-maintenance',
       'owner-maintenance', 1, '{}', 'pending'
     )`
  );

  const result = await withTransaction((client) => processCorrectionDeadlines(client, { now: NOW }));

  assert.deepEqual(result, { processed: 0 });
  assert.equal((await pool.query(
    "SELECT safety_status FROM group_collections WHERE id = 'collection-maintenance'"
  )).rows[0].safety_status, "active");
  assert.equal((await pool.query(
    "SELECT count(*)::int AS count FROM safety_actions WHERE idempotency_key = 'deadline:suspend_collection:case-pending-revision'"
  )).rows[0].count, 0);
});

test("quiet low-risk monitoring case resolves once after seven days", async () => {
  await seedLowRiskCase();
  await pool.query("INSERT INTO users (id, nickname) VALUES ('reporter-low-risk-second', 'Reporter 2')");
  await pool.query(
    `INSERT INTO reports (
       id, target_type, target_id, reason, reporter_id, status, client_request_id,
       case_id, source_type, source_id, subject_type, subject_id, reason_code,
       reported_field, created_at, updated_at
     ) VALUES (
       'report-low-risk-second', 'post', 'post-low-risk', 'other',
       'reporter-low-risk-second', 'pending', 'request-low-risk-second',
       'case-low-risk', 'post', 'post-low-risk', 'post', 'post-low-risk',
       'other', 'content', $1, $1
     )`,
    [new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000)]
  );

  const first = await withTransaction((client) => closeLowRiskCases(client, { now: NOW }));
  const second = await withTransaction((client) => closeLowRiskCases(client, { now: NOW }));

  assert.equal(first.processed, 1);
  assert.deepEqual(first.syncEvents.map(({ id: _id, createdAt: _createdAt, ...event }) => event), [
    {
      userID: "reporter-low-risk",
      eventType: "safety.report.updated",
      entityType: "safety_case",
      entityID: "case-low-risk",
      threadID: null
    },
    {
      userID: "reporter-low-risk-second",
      eventType: "safety.report.updated",
      entityType: "safety_case",
      entityID: "case-low-risk",
      threadID: null
    }
  ]);
  assert.deepEqual(second, { processed: 0, syncEvents: [] });
  const safetyCase = await pool.query(
    "SELECT status, resolved_at FROM safety_cases WHERE id = 'case-low-risk'"
  );
  assert.equal(safetyCase.rows[0].status, "resolved_no_action");
  assert.equal(safetyCase.rows[0].resolved_at.toISOString(), NOW.toISOString());
  assert.equal((await pool.query(
    "SELECT status FROM reports WHERE id = 'report-low-risk'"
  )).rows[0].status, "closed");
  assert.equal((await pool.query(
    "SELECT count(*)::int AS count FROM safety_case_events WHERE case_id = 'case-low-risk' AND event_type = 'maintenance_low_risk_closed'"
  )).rows[0].count, 1);
  assert.deepEqual((await pool.query(
    `SELECT user_id, event_type, entity_type, entity_id
     FROM sync_events
     ORDER BY user_id`
  )).rows, [
    {
      user_id: "reporter-low-risk",
      event_type: "safety.report.updated",
      entity_type: "safety_case",
      entity_id: "case-low-risk"
    },
    {
      user_id: "reporter-low-risk-second",
      event_type: "safety.report.updated",
      entity_type: "safety_case",
      entity_id: "case-low-risk"
    }
  ]);
});

test("recent reports, hard signals, manual holds, and active actions keep monitoring open", async () => {
  await seedLowRiskUsers();
  for (const suffix of ["recent", "hard", "hold", "action"]) {
    await insertLowRiskCase({ suffix });
  }
  await pool.query("INSERT INTO users (id, nickname) VALUES ('reporter-recent-second', 'Reporter 2')");
  await pool.query(
    `INSERT INTO reports (
       id, target_type, target_id, reason, reporter_id, status, client_request_id,
       case_id, source_type, source_id, subject_type, subject_id, reason_code,
       reported_field, created_at, updated_at
     ) VALUES (
       'report-recent-second', 'post', 'post-recent', 'other', 'reporter-recent-second',
       'pending', 'request-recent-second', 'case-recent', 'post', 'post-recent',
       'post', 'post-recent', 'other', 'content', $1, $1
     )`,
    [new Date(NOW.getTime() - 24 * 60 * 60 * 1000)]
  );
  await pool.query(
    `INSERT INTO safety_ai_runs (
       id, case_id, model_version, prompt_version, policy_version, evidence_hash,
       mode, status, hard_signal
     ) VALUES (
       'run-hard', 'case-hard', 'model', 'prompt', 'policy', 'hard-evidence',
       'shadow', 'completed', '{"riskLevel":"medium","outcome":"review"}'
     )`
  );
  await pool.query("UPDATE safety_cases SET manual_hold = true WHERE id = 'case-hold'");
  await pool.query(
    `INSERT INTO safety_actions (
       id, case_id, idempotency_key, action_type, target_type, target_id,
       actor_type, reason, execution_status, applied_at
     ) VALUES (
       'action-active', 'case-action', 'active:case-action', 'notify_owner',
       'post', 'post-action', 'system', 'still active', 'applied', $1
     )`,
    [NOW]
  );

  const result = await withTransaction((client) => closeLowRiskCases(client, { now: NOW }));

  assert.deepEqual(result, { processed: 0, syncEvents: [] });
  const statuses = await pool.query(
    "SELECT id, status FROM safety_cases ORDER BY id"
  );
  assert.deepEqual(statuses.rows, [
    { id: "case-action", status: "monitoring" },
    { id: "case-hard", status: "monitoring" },
    { id: "case-hold", status: "monitoring" },
    { id: "case-recent", status: "monitoring" }
  ]);
});

test("clears closed direct-message evidence at 180 days but preserves protected cases", async () => {
  const activeSourceKey = "message/retention-sender/2026-01-01/still-live.jpg";
  await seedMessageRetentionCase({
    suffix: "expired",
    status: "resolved_no_action",
    resolvedAt: new Date(NOW.getTime() - 180 * 24 * 60 * 60 * 1000)
  });
  await pool.query(
    `INSERT INTO users (id, nickname) VALUES
       ('retention-sender', 'Sender'), ('retention-recipient', 'Recipient')`
  );
  await pool.query(
    `INSERT INTO message_threads (id, buyer_user_id, publisher_user_id)
     VALUES ('retention-thread', 'retention-sender', 'retention-recipient')`
  );
  await pool.query(
    `INSERT INTO direct_messages (id, thread_id, sender_id, image_object_key)
     VALUES ('message-expired', 'retention-thread', 'retention-sender', $1)`,
    [activeSourceKey]
  );
  await pool.query(
    `UPDATE safety_evidence
     SET object_keys = array_append(object_keys, $1)
     WHERE id = 'evidence-message-expired'`,
    [activeSourceKey]
  );
  await seedMessageRetentionCase({
    suffix: "179-days",
    status: "resolved_no_action",
    resolvedAt: new Date(NOW.getTime() - 179 * 24 * 60 * 60 * 1000)
  });
  await seedMessageRetentionCase({
    suffix: "appealed",
    status: "appealed",
    resolvedAt: new Date(NOW.getTime() - 200 * 24 * 60 * 60 * 1000)
  });
  await seedMessageRetentionCase({
    suffix: "open",
    status: "manual_review",
    resolvedAt: new Date(NOW.getTime() - 200 * 24 * 60 * 60 * 1000)
  });
  await seedMessageRetentionCase({
    suffix: "pending-appeal",
    status: "resolved_actioned",
    resolvedAt: new Date(NOW.getTime() - 200 * 24 * 60 * 60 * 1000)
  });
  await seedPendingMessageAppeal();

  const first = await withTransaction((client) => clearExpiredEvidence(client, { now: NOW }));
  const second = await withTransaction((client) => clearExpiredEvidence(client, { now: NOW }));

  assert.deepEqual(first, {
    processed: 1,
    objectKeys: ["report/message-expired-1.jpg", "report/message-expired-2.jpg"]
  });
  assert.deepEqual(second, { processed: 0, objectKeys: [] });
  const evidence = await pool.query(
    `SELECT case_id, text_snapshot, structured_snapshot, object_keys,
            redacted_at IS NOT NULL AS redacted
     FROM safety_evidence
     ORDER BY case_id`
  );
  assert.deepEqual(evidence.rows, [
    {
      case_id: "case-message-179-days",
      text_snapshot: "private 179-days",
      structured_snapshot: { messages: ["private 179-days"] },
      object_keys: ["report/message-179-days-1.jpg", "report/message-179-days-2.jpg"],
      redacted: false
    },
    {
      case_id: "case-message-appealed",
      text_snapshot: "private appealed",
      structured_snapshot: { messages: ["private appealed"] },
      object_keys: ["report/message-appealed-1.jpg", "report/message-appealed-2.jpg"],
      redacted: false
    },
    {
      case_id: "case-message-expired",
      text_snapshot: "",
      structured_snapshot: { redacted: true, reason: "retention_expired" },
      object_keys: [],
      redacted: true
    },
    {
      case_id: "case-message-open",
      text_snapshot: "private open",
      structured_snapshot: { messages: ["private open"] },
      object_keys: ["report/message-open-1.jpg", "report/message-open-2.jpg"],
      redacted: false
    },
    {
      case_id: "case-message-pending-appeal",
      text_snapshot: "private pending-appeal",
      structured_snapshot: { messages: ["private pending-appeal"] },
      object_keys: ["report/message-pending-appeal-1.jpg", "report/message-pending-appeal-2.jpg"],
      redacted: false
    }
  ]);
  const runs = await pool.query("SELECT case_id, raw_response FROM safety_ai_runs ORDER BY case_id");
  assert.deepEqual(runs.rows, [
    { case_id: "case-message-179-days", raw_response: "raw 179-days" },
    { case_id: "case-message-appealed", raw_response: "raw appealed" },
    { case_id: "case-message-expired", raw_response: "" },
    { case_id: "case-message-open", raw_response: "raw open" },
    { case_id: "case-message-pending-appeal", raw_response: "raw pending-appeal" }
  ]);
  const deletionJobs = await pool.query(
    `SELECT job_type, unique_key, payload, status, max_attempts
     FROM safety_jobs
     WHERE job_type = 'delete_retained_evidence_objects'`
  );
  assert.deepEqual(deletionJobs.rows, [{
    job_type: "delete_retained_evidence_objects",
    unique_key: "delete_retained_evidence_objects:evidence-message-expired",
    payload: {
      objectKeys: ["report/message-expired-1.jpg", "report/message-expired-2.jpg"]
    },
    status: "pending",
    max_attempts: 20
  }]);
  const [claimedDeletion] = await claimSafetyJobs({ limit: 1, workerId: "retention-delete" });
  assert.equal(claimedDeletion.job_type, "delete_retained_evidence_objects");
  const completedDeletion = await completeSafetyJob({
    jobId: claimedDeletion.id,
    workerId: "retention-delete",
    leaseAttempt: claimedDeletion.attempts
  });
  assert.deepEqual(completedDeletion.payload, {});
});

test("deidentifies two-year audit metadata while preserving unresolved and appealed cases", async () => {
  await seedAdminAuditRetention();

  const first = await withTransaction((client) => deidentifyExpiredAudit(client, { now: NOW }));
  const second = await withTransaction((client) => deidentifyExpiredAudit(client, { now: NOW }));

  assert.deepEqual(first, { deidentified: 1, deleted: 1 });
  assert.deepEqual(second, { deidentified: 0, deleted: 0 });
  const audits = await pool.query(
    `SELECT event_type, admin_user_id, device_id, session_id, subject_type, subject_id,
            ip_hash, user_agent_summary, event_data, created_at
     FROM admin_audit_events
     ORDER BY event_type`
  );
  assert.deepEqual(audits.rows, [
    {
      event_type: "safety.case_decided",
      admin_user_id: null,
      device_id: null,
      session_id: null,
      subject_type: "safety_case",
      subject_id: null,
      ip_hash: "",
      user_agent_summary: "",
      event_data: { outcome: "no_action" },
      created_at: new Date("2024-07-01T00:00:00.000Z")
    },
    {
      event_type: "safety.case_pending_appeal",
      admin_user_id: "admin-maintenance",
      device_id: "device-maintenance",
      session_id: "session-maintenance",
      subject_type: "safety_case",
      subject_id: "case-audit-appeal",
      ip_hash: "ip-pending",
      user_agent_summary: "Chrome / macOS",
      event_data: { decision: "temporary_hide", reason: "pending appeal" },
      created_at: new Date("2024-07-20T08:00:00.000Z")
    },
    {
      event_type: "safety.case_recent",
      admin_user_id: "admin-maintenance",
      device_id: "device-maintenance",
      session_id: "session-maintenance",
      subject_type: "safety_case",
      subject_id: "case-audit-resolved",
      ip_hash: "ip-recent",
      user_agent_summary: "Chrome / macOS",
      event_data: { decision: "no_action", reason: "recent" },
      created_at: new Date("2026-07-19T08:00:00.000Z")
    },
    {
      event_type: "safety.case_unresolved",
      admin_user_id: "admin-maintenance",
      device_id: "device-maintenance",
      session_id: "session-maintenance",
      subject_type: "safety_case",
      subject_id: "case-audit-open",
      ip_hash: "ip-open",
      user_agent_summary: "Chrome / macOS",
      event_data: { decision: "manual_review", reason: "open" },
      created_at: new Date("2024-07-20T08:00:00.000Z")
    }
  ]);
});

test("hourly maintenance jobs stay unique across concurrent PostgreSQL schedulers", async () => {
  const intervalCallbacks = [];
  const schedulerInput = {
    withTransaction,
    now: () => NOW,
    setInterval(callback) {
      intervalCallbacks.push(callback);
      return intervalCallbacks.length;
    },
    clearInterval() {},
    eventLogger: { error() {} }
  };
  const first = startSafetyMaintenanceScheduler(schedulerInput);
  const second = startSafetyMaintenanceScheduler(schedulerInput);

  await Promise.all([first.ready, second.ready]);
  await Promise.all([first.stop(), second.stop()]);

  const jobs = await pool.query(
    `SELECT job_type, unique_key
     FROM safety_jobs
     WHERE job_type = ANY($1::text[])
     ORDER BY job_type`,
    [MAINTENANCE_JOB_TYPES]
  );
  assert.equal(jobs.rows.length, MAINTENANCE_JOB_TYPES.length);
  assert.deepEqual(jobs.rows.map((row) => row.unique_key).sort(),
    MAINTENANCE_JOB_TYPES.map((type) => `${type}:2026-07-20T08`).sort());
});

test("PostgreSQL advisory lock allows only one concurrent handler per maintenance type", async () => {
  const started = deferred();
  const release = deferred();
  let operationCalls = 0;
  const handlers = createMaintenanceJobHandlers({
    withTransaction,
    processCorrectionDeadlines: async () => {
      operationCalls += 1;
      started.resolve();
      await release.promise;
      return { processed: 1 };
    },
    closeLowRiskCases: async () => ({ processed: 0 }),
    clearExpiredEvidence: async () => ({ processed: 0, objectKeys: [] }),
    deidentifyExpiredAudit: async () => ({ deidentified: 0, deleted: 0 }),
    notifySyncEvents: async () => {},
    eventLogger: { error() {} }
  });

  const first = handlers.maintenance_correction_deadlines({});
  await started.promise;
  await assert.rejects(
    handlers.maintenance_correction_deadlines({}),
    /maintenance lock is busy/
  );
  release.resolve();
  assert.deepEqual(await first, { processed: 1 });
  assert.equal(operationCalls, 1);
});

async function seedCollectionCase({ caseId, status, correctionDueAt }) {
  await pool.query("INSERT INTO users (id, nickname) VALUES ('owner-maintenance', 'Owner')");
  await pool.query(
    `INSERT INTO group_collections (id, owner_id, name, deadline)
     VALUES ('collection-maintenance', 'owner-maintenance', 'Collection', $1)`,
    [NOW]
  );
  await pool.query(
    `INSERT INTO safety_cases (
       id, subject_type, subject_id, category, impact_scope, status, correction_due_at, manual_hold
     ) VALUES ($1, 'collection', 'collection-maintenance', 'invalid_contact', 'collection', $2, $3, true)`,
    [caseId, status, correctionDueAt]
  );
  await pool.query(
    `INSERT INTO safety_actions (
       id, case_id, idempotency_key, action_type, target_type, target_id,
       actor_type, reason, execution_status, before_snapshot, after_snapshot, applied_at
     ) VALUES (
       'action-correction', $1, 'correction:request:' || $1, 'request_correction',
       'collection', 'collection-maintenance', 'system', 'invalid contact correction', 'applied',
       '{"status":"monitoring","correction_due_at":null,"action_chain_id":"chain-correction"}',
       jsonb_build_object(
         'status', 'awaiting_correction',
         'correction_due_at', $2::text,
         'action_chain_id', 'chain-correction'
       ),
       $2::timestamptz
     )`,
    [caseId, correctionDueAt]
  );
}

async function seedLowRiskCase() {
  await seedLowRiskUsers();
  await insertLowRiskCase({ suffix: "low-risk" });
}

async function seedLowRiskUsers() {
  await pool.query(
    `INSERT INTO users (id, nickname) VALUES
       ('owner-low-risk', 'Owner'),
       ('reporter-low-risk', 'Reporter')`
  );
}

async function insertLowRiskCase({ suffix }) {
  const createdAt = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO posts (id, author_id, title, deadline)
     VALUES ($1, 'owner-low-risk', 'Post', $2)`,
    [`post-${suffix}`, NOW]
  );
  await pool.query(
    `INSERT INTO safety_cases (
       id, subject_type, subject_id, category, impact_scope, status, risk_level,
       created_at, updated_at
     ) VALUES (
       $1, 'post', $2, 'other', 'post', 'monitoring', 'low',
       $3, $3
     )`,
    [`case-${suffix}`, `post-${suffix}`, createdAt]
  );
  await pool.query(
    `INSERT INTO reports (
       id, target_type, target_id, reason, reporter_id, status, client_request_id,
       case_id, source_type, source_id, subject_type, subject_id, reason_code,
       reported_field, created_at, updated_at
     ) VALUES (
       $1, 'post', $2, 'other', 'reporter-low-risk', 'pending',
       $3, $4, 'post', $2, 'post', $2, 'other', 'content', $5, $5
     )`,
    [`report-${suffix}`, `post-${suffix}`, `request-${suffix}`, `case-${suffix}`, createdAt]
  );
}

async function seedMessageRetentionCase({ suffix, status, resolvedAt }) {
  await pool.query(
    `INSERT INTO safety_cases (
       id, subject_type, subject_id, category, impact_scope, status, resolved_at,
       created_at, updated_at
     ) VALUES (
       $1, 'direct_message', $2, 'direct_message_risk', 'direct_message', $3, $4, $4, $4
     )`,
    [`case-message-${suffix}`, `message-${suffix}`, status, resolvedAt]
  );
  await pool.query(
    `INSERT INTO safety_evidence (
       id, case_id, evidence_type, text_snapshot, structured_snapshot, object_keys, created_at
     ) VALUES (
       $1, $2, 'source_snapshot', $3, jsonb_build_object('messages', jsonb_build_array($3::text)),
       $4, $5
     )`,
    [
      `evidence-message-${suffix}`,
      `case-message-${suffix}`,
      `private ${suffix}`,
      [`report/message-${suffix}-1.jpg`, `report/message-${suffix}-2.jpg`],
      resolvedAt
    ]
  );
  await pool.query(
    `INSERT INTO safety_ai_runs (
       id, case_id, model_version, prompt_version, policy_version, evidence_hash,
       mode, status, raw_response, created_at
     ) VALUES ($1, $2, 'model', 'prompt', 'policy', $3, 'shadow', 'completed', $4, $5)`,
    [`run-message-${suffix}`, `case-message-${suffix}`, `evidence-${suffix}`, `raw ${suffix}`, resolvedAt]
  );
}

async function seedPendingMessageAppeal() {
  await pool.query("INSERT INTO users (id, nickname) VALUES ('owner-message-appeal', 'Owner')");
  await pool.query(
    `INSERT INTO safety_actions (
       id, case_id, idempotency_key, action_type, target_type, target_id,
       actor_type, reason, execution_status, applied_at
     ) VALUES (
       'action-message-appeal', 'case-message-pending-appeal', 'message:appeal',
       'hide_message', 'direct_message', 'message-pending-appeal', 'admin',
       'appealed message action', 'applied', $1
     )`,
    [new Date(NOW.getTime() - 200 * 24 * 60 * 60 * 1000)]
  );
  await pool.query(
    `INSERT INTO safety_appeals (
       id, case_id, decision_action_id, owner_id, detail, status, created_at
     ) VALUES (
       'appeal-message-pending', 'case-message-pending-appeal', 'action-message-appeal',
       'owner-message-appeal', 'pending appeal', 'pending', $1
     )`,
    [new Date(NOW.getTime() - 199 * 24 * 60 * 60 * 1000)]
  );
}

async function seedAdminAuditRetention() {
  const auditBoundary = new Date("2024-07-20T08:00:00.000Z");
  await pool.query("INSERT INTO users (id, nickname) VALUES ('owner-audit', 'Owner')");
  await pool.query(
    `INSERT INTO admin_users (id, username, username_normalized, password_hash)
     VALUES ('admin-maintenance', 'Admin', 'admin', 'hash')`
  );
  await pool.query(
    `INSERT INTO admin_devices (
       id, admin_user_id, display_name, public_key_jwk, fingerprint_hash, is_root
     ) VALUES ('device-maintenance', 'admin-maintenance', 'Root', '{}', 'fingerprint', true)`
  );
  await pool.query(
    `INSERT INTO admin_sessions (
       id, admin_user_id, device_id, token_hash, csrf_hash,
       idle_expires_at, absolute_expires_at
     ) VALUES (
       'session-maintenance', 'admin-maintenance', 'device-maintenance', 'token', 'csrf',
       $1, $1
     )`,
    [new Date(NOW.getTime() + 24 * 60 * 60 * 1000)]
  );
  await pool.query(
    `INSERT INTO safety_cases (
       id, subject_type, subject_id, category, impact_scope, status, resolved_at
     ) VALUES
       ('case-audit-resolved', 'post', 'post-audit-resolved', 'other', 'post', 'resolved_no_action', $1),
       ('case-audit-open', 'post', 'post-audit-open', 'other', 'post', 'manual_review', NULL),
       ('case-audit-appeal', 'post', 'post-audit-appeal', 'other', 'post', 'resolved_actioned', $1)`,
    [auditBoundary]
  );
  await pool.query(
    `INSERT INTO safety_actions (
       id, case_id, idempotency_key, action_type, target_type, target_id,
       actor_type, reason, execution_status, applied_at
     ) VALUES (
       'action-audit-appeal', 'case-audit-appeal', 'audit:appeal', 'hide_post',
       'post', 'post-audit-appeal', 'admin', 'appealed action', 'applied', $1
     )`,
    [auditBoundary]
  );
  await pool.query(
    `INSERT INTO safety_appeals (
       id, case_id, decision_action_id, owner_id, detail, status, created_at
     ) VALUES (
       'appeal-audit', 'case-audit-appeal', 'action-audit-appeal', 'owner-audit',
       'pending appeal', 'pending', $1
     )`,
    [auditBoundary]
  );
  const auditRows = [
    ["admin.login_failed", null, null, "ip-failure", { outcome: "invalid_credentials" }, auditBoundary],
    ["safety.case_decided", "safety_case", "case-audit-resolved", "ip-resolved", { decision: "no_action", reason: "resolved" }, auditBoundary],
    ["safety.case_unresolved", "safety_case", "case-audit-open", "ip-open", { decision: "manual_review", reason: "open" }, auditBoundary],
    ["safety.case_pending_appeal", "safety_case", "case-audit-appeal", "ip-pending", { decision: "temporary_hide", reason: "pending appeal" }, auditBoundary],
    ["safety.case_recent", "safety_case", "case-audit-resolved", "ip-recent", { decision: "no_action", reason: "recent" }, "2026-07-19T08:00:00.000Z"]
  ];
  for (const [eventType, subjectType, subjectId, ipHash, eventData, createdAt] of auditRows) {
    await pool.query(
      `INSERT INTO admin_audit_events (
         admin_user_id, device_id, session_id, event_type, subject_type, subject_id,
         ip_hash, user_agent_summary, event_data, created_at
       ) VALUES (
         'admin-maintenance', 'device-maintenance', 'session-maintenance', $1, $2, $3,
         $4, 'Chrome / macOS', $5::jsonb, $6
       )`,
      [eventType, subjectType, subjectId, ipHash, JSON.stringify(eventData), createdAt]
    );
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((fulfill) => { resolve = fulfill; });
  return { promise, resolve };
}

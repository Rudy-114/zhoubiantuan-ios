import assert from "node:assert/strict";
import test from "node:test";
import { applySafetyAction } from "../../src/safety/actionService.js";
import {
  independentReporterCount,
  loadReportCountingStatuses,
  markReportInvalid
} from "../../src/safety/reportAbuseService.js";
import { closeDatabase, pool, resetDatabase } from "../helpers/database.js";

const NOW = new Date("2026-07-16T08:00:00.000Z");

test.beforeEach(async () => {
  await resetDatabase();
  await seedReportAbuseFixture();
});
test.after(closeDatabase);

test("counts distinct recent valid unrestricted reporters and keeps every clue visible", async () => {
  const count = await transaction((client) => independentReporterCount(client, "case-abuse", { now: NOW }));
  assert.equal(count, 2);

  const reports = await transaction((client) => loadReportCountingStatuses(client, "case-abuse", { now: NOW }));
  const statuses = reports.map((report) => ({
    id: report.id,
    counts: report.counts_toward_threshold,
    reason: report.counting_reason
  })).sort((left, right) => left.id.localeCompare(right.id));
  const expected = [
    { id: "report-count-a", counts: true, reason: "counted" },
    { id: "report-count-a-retry", counts: false, reason: "duplicate_reporter" },
    { id: "report-count-b", counts: true, reason: "counted" },
    { id: "report-restricted", counts: false, reason: "reporter_restricted" },
    { id: "report-invalid", counts: false, reason: "invalid" },
    { id: "report-old", counts: false, reason: "outside_window" }
  ].sort((left, right) => left.id.localeCompare(right.id));
  assert.deepEqual(statuses, expected);
  assert.equal((await pool.query(
    "SELECT count(*)::int AS count FROM safety_evidence WHERE report_id = 'report-count-a'"
  )).rows[0].count, 2);
});

test("invalidates one clue, preserves evidence, and rolls back only unsupported automatic effects", async () => {
  await seedAutomaticInvalidContactActions();
  const expectedVersion = (await pool.query(
    "SELECT updated_at FROM safety_cases WHERE id = 'case-abuse'"
  )).rows[0].updated_at.toISOString();

  const result = await transaction((client) => markReportInvalid(client, {
    caseId: "case-abuse",
    reportId: "report-count-b",
    reason: "malicious",
    confirmed: true,
    expectedVersion,
    adminUserId: "admin-abuse",
    now: NOW
  }));

  assert.equal(result.unchanged, false);
  assert.equal(result.independentReporterCount, 1);
  assert.deepEqual(result.rolledBackActionTypes, ["hide_collection_contact"]);
  assert.deepEqual((await pool.query(
    "SELECT status, admin_result FROM reports WHERE id = 'report-count-b'"
  )).rows[0], {
    status: "invalid",
    admin_result: "report_invalid:malicious"
  });
  assert.equal((await pool.query(
    "SELECT count(*)::int AS count FROM safety_evidence WHERE report_id = 'report-count-b'"
  )).rows[0].count, 1);
  assert.deepEqual((await pool.query(
    "SELECT contact_visibility FROM group_collections WHERE id = 'collection-abuse'"
  )).rows[0], { contact_visibility: "active" });
  assert.deepEqual((await pool.query(
    "SELECT status, correction_due_at FROM safety_cases WHERE id = 'case-abuse'"
  )).rows[0], {
    status: "awaiting_correction",
    correction_due_at: new Date("2026-07-17T08:00:00.000Z")
  });
  assert.equal((await pool.query(
    "SELECT execution_status FROM safety_actions WHERE idempotency_key = 'ai-abuse-correction'"
  )).rows[0].execution_status, "applied");
  assert.equal((await pool.query(
    "SELECT count(*)::int AS count FROM safety_case_events WHERE event_type = 'report_marked_invalid'"
  )).rows[0].count, 1);
  assert.equal((await pool.query(
    "SELECT count(*)::int AS count FROM admin_audit_events WHERE event_type = 'safety.report_invalidated'"
  )).rows[0].count, 1);

  const repeat = await transaction((client) => markReportInvalid(client, {
    caseId: "case-abuse",
    reportId: "report-count-b",
    reason: "malicious",
    confirmed: true,
    expectedVersion,
    adminUserId: "admin-abuse",
    now: NOW
  }));
  assert.equal(repeat.unchanged, true);
  assert.equal((await pool.query(
    "SELECT count(*)::int AS count FROM safety_case_events WHERE event_type = 'report_marked_invalid'"
  )).rows[0].count, 1);
});

test("never rolls back a human action when a report is invalidated", async () => {
  await transaction((client) => applySafetyAction(client, {
    caseId: "case-abuse",
    idempotencyKey: "admin-abuse-hide",
    actionType: "hide_collection_contact",
    targetType: "collection",
    targetId: "collection-abuse",
    actorType: "admin",
    actorId: "admin-abuse",
    reason: "Human-reviewed restriction"
  }));
  const expectedVersion = (await pool.query(
    "SELECT updated_at FROM safety_cases WHERE id = 'case-abuse'"
  )).rows[0].updated_at.toISOString();

  const result = await transaction((client) => markReportInvalid(client, {
    caseId: "case-abuse",
    reportId: "report-count-b",
    reason: "mistaken_target",
    confirmed: true,
    expectedVersion,
    adminUserId: "admin-abuse",
    now: NOW
  }));

  assert.deepEqual(result.rolledBackActionTypes, []);
  assert.deepEqual((await pool.query(
    "SELECT actor_type, execution_status FROM safety_actions WHERE idempotency_key = 'admin-abuse-hide'"
  )).rows[0], { actor_type: "admin", execution_status: "applied" });
  assert.equal((await pool.query(
    "SELECT contact_visibility FROM group_collections WHERE id = 'collection-abuse'"
  )).rows[0].contact_visibility, "hidden");
});

test("rolls back an AI hide whose completed run still contains the invalidated clue", async () => {
  await seedStalePostRun();
  const expectedVersion = (await pool.query(
    "SELECT updated_at FROM safety_cases WHERE id = 'case-abuse-post'"
  )).rows[0].updated_at.toISOString();

  const result = await transaction((client) => markReportInvalid(client, {
    caseId: "case-abuse-post",
    reportId: "report-abuse-post",
    reason: "mistaken_target",
    confirmed: true,
    expectedVersion,
    adminUserId: "admin-abuse",
    now: NOW
  }));

  assert.deepEqual(result.rolledBackActionTypes, ["hide_post"]);
  assert.equal((await pool.query(
    "SELECT safety_status FROM posts WHERE id = 'post-abuse'"
  )).rows[0].safety_status, "active");
  assert.equal((await pool.query(
    "SELECT execution_status FROM safety_actions WHERE idempotency_key = 'ai-abuse-post-hide'"
  )).rows[0].execution_status, "rolled_back");
});

async function seedReportAbuseFixture() {
  await pool.query(
    `INSERT INTO admin_users (id, username, username_normalized, password_hash)
     VALUES ('admin-abuse', 'AbuseAdmin', 'abuseadmin', 'unused-test-hash')`
  );
  await pool.query(
    `INSERT INTO users (id, nickname, is_restricted) VALUES
       ('owner-abuse', 'Owner', false),
       ('reporter-a', 'Reporter A', false),
       ('reporter-b', 'Reporter B', false),
       ('reporter-restricted', 'Restricted reporter', true),
       ('reporter-invalid', 'Invalid reporter', false),
       ('reporter-old', 'Old reporter', false)`
  );
  await pool.query(
    `INSERT INTO group_collections (id, owner_id, name, deadline)
     VALUES ('collection-abuse', 'owner-abuse', 'Abuse count collection', $1)`,
    [new Date("2026-08-01T00:00:00.000Z")]
  );
  await pool.query(
    `INSERT INTO safety_cases (
       id, subject_type, subject_id, category, impact_scope, status, updated_at
     ) VALUES (
       'case-abuse', 'collection', 'collection-abuse', 'invalid_contact',
       'collection', 'monitoring', $1
     )`,
    [NOW]
  );
  await pool.query(
    `INSERT INTO reports (
       id, target_type, target_id, reason, detail, reporter_id, status,
       client_request_id, case_id, source_type, source_id, subject_type,
       subject_id, reason_code, reported_field, created_at, updated_at
     ) VALUES
       ('report-count-a', 'collection', 'collection-abuse', 'invalid_contact', '', 'reporter-a', 'pending',
        'request-count-a', 'case-abuse', 'collection', 'collection-abuse', 'collection',
        'collection-abuse', 'invalid_contact', 'contact_wechat', $1::timestamptz - interval '1 day', $1),
       ('report-count-a-retry', 'collection', 'collection-abuse', 'invalid_contact', '', 'reporter-a', 'closed',
        'request-count-a-retry', 'case-abuse', 'collection', 'collection-abuse', 'collection',
        'collection-abuse', 'invalid_contact', 'contact_wechat', $1::timestamptz - interval '12 hours', $1),
       ('report-count-b', 'collection', 'collection-abuse', 'invalid_contact', '', 'reporter-b', 'closed',
        'request-count-b', 'case-abuse', 'collection', 'collection-abuse', 'collection',
        'collection-abuse', 'invalid_contact', 'contact_wechat', $1::timestamptz - interval '2 days', $1),
       ('report-restricted', 'collection', 'collection-abuse', 'invalid_contact', '', 'reporter-restricted', 'pending',
        'request-restricted', 'case-abuse', 'collection', 'collection-abuse', 'collection',
        'collection-abuse', 'invalid_contact', 'contact_wechat', $1::timestamptz - interval '3 days', $1),
       ('report-invalid', 'collection', 'collection-abuse', 'invalid_contact', '', 'reporter-invalid', 'invalid',
        'request-invalid', 'case-abuse', 'collection', 'collection-abuse', 'collection',
        'collection-abuse', 'invalid_contact', 'contact_wechat', $1::timestamptz - interval '4 days', $1),
       ('report-old', 'collection', 'collection-abuse', 'invalid_contact', '', 'reporter-old', 'pending',
        'request-old', 'case-abuse', 'collection', 'collection-abuse', 'collection',
        'collection-abuse', 'invalid_contact', 'contact_wechat', $1::timestamptz - interval '8 days', $1)`,
    [NOW]
  );
  await pool.query(
    `INSERT INTO safety_evidence (
       id, case_id, report_id, client_request_id, evidence_type,
       text_snapshot, structured_snapshot, created_at
     ) VALUES
       ('evidence-count-a', 'case-abuse', 'report-count-a', 'evidence-count-a',
        'collection', 'primary clue', '{}'::jsonb, $1),
       ('evidence-count-a-supplement', 'case-abuse', 'report-count-a', 'evidence-count-a-supplement',
        'report_supplement', 'supplement', '{}'::jsonb, $1),
       ('evidence-count-b', 'case-abuse', 'report-count-b', 'evidence-count-b',
        'collection', 'second clue', '{}'::jsonb, $1)`,
    [NOW]
  );
}

async function seedAutomaticInvalidContactActions() {
  await transaction(async (client) => {
    await applySafetyAction(client, {
      caseId: "case-abuse",
      idempotencyKey: "ai-abuse-hide",
      actionType: "hide_collection_contact",
      targetType: "collection",
      targetId: "collection-abuse",
      actorType: "ai",
      actorId: "policy:safety-policy-v1",
      reason: "two independent reports"
    });
    await applySafetyAction(client, {
      caseId: "case-abuse",
      idempotencyKey: "ai-abuse-correction",
      actionType: "request_correction",
      targetType: "collection",
      targetId: "collection-abuse",
      actorType: "ai",
      actorId: "policy:safety-policy-v1",
      reason: "two independent reports",
      correctionDueAt: new Date("2026-07-17T08:00:00.000Z")
    });
  });
}

async function seedStalePostRun() {
  await pool.query(
    `INSERT INTO users (id, nickname) VALUES
       ('owner-abuse-post', 'Post owner'),
       ('reporter-abuse-post', 'Post reporter')`
  );
  await pool.query(
    `INSERT INTO posts (id, author_id, title, description, deadline)
     VALUES ('post-abuse', 'owner-abuse-post', 'Reported post', 'Post body', $1)` ,
    [new Date("2026-08-01T00:00:00.000Z")]
  );
  await pool.query(
    `INSERT INTO safety_cases (
       id, subject_type, subject_id, category, impact_scope, status, updated_at
     ) VALUES (
       'case-abuse-post', 'post', 'post-abuse', 'suspected_scam', 'post', 'manual_review', $1
     )`,
    [NOW]
  );
  await pool.query(
    `INSERT INTO reports (
       id, target_type, target_id, reason, detail, reporter_id, status,
       client_request_id, case_id, source_type, source_id, subject_type,
       subject_id, reason_code, reported_field, created_at, updated_at
     ) VALUES (
       'report-abuse-post', 'post', 'post-abuse', 'suspected_scam', 'Only clue',
       'reporter-abuse-post', 'pending', 'request-abuse-post', 'case-abuse-post',
       'post', 'post-abuse', 'post', 'post-abuse', 'suspected_scam', 'content', $1, $1
     )`,
    [NOW]
  );
  await pool.query(
    `INSERT INTO safety_ai_runs (
       id, case_id, model_version, prompt_version, policy_version, evidence_hash,
       is_synthetic, mode, status, hard_signal, parsed_result, completed_at
     )
     SELECT 'run-abuse-post', id, model_version, prompt_version, policy_version,
            'stale-report-evidence', false, 'enforce', 'completed', $2::jsonb, $3::jsonb, $1
     FROM safety_cases WHERE id = 'case-abuse-post'`,
    [
      NOW,
      JSON.stringify({ outcome: "block", riskLevel: "high" }),
      JSON.stringify({
        category: "suspected_scam",
        subjectType: "post",
        impactScope: "post",
        riskLevel: "high",
        confidence: 0.99,
        evidence: [{ source: "report_detail", fact: "Only clue looked risky." }],
        recommendedAction: "hide_content_temporarily",
        requiresHuman: true,
        summary: "The only report looked risky."
      })
    ]
  );
  await transaction((client) => applySafetyAction(client, {
    caseId: "case-abuse-post",
    idempotencyKey: "ai-abuse-post-hide",
    actionType: "hide_post",
    targetType: "post",
    targetId: "post-abuse",
    actorType: "ai",
    actorId: "policy:safety-policy-v1",
    reason: "stale completed run"
  }));
}

async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

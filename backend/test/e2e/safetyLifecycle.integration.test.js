import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSafetyCase } from "../../src/safety/aiService.js";
import { applySafetyAction } from "../../src/safety/actionService.js";
import { clearExpiredEvidence, processCorrectionDeadlines } from "../../src/safety/maintenanceService.js";
import { reviewContentRevision } from "../../src/safety/revisionReview.js";
import { closeDatabase, pool, resetDatabase } from "../helpers/database.js";
import {
  ACTORS,
  E2E_AI_CONFIG,
  E2E_NOW,
  TARGETS,
  adminCase,
  adminDecision,
  passModeration,
  qwenProvider,
  qwenResult,
  requestJSON,
  seedLifecycleActors,
  transaction,
  waitFor,
  withE2ESafetyRuntime,
  withE2EServer
} from "./helpers.js";

test.beforeEach(resetDatabase);
test.after(closeDatabase);

test("runs the complete post, collection-contact, and private-message safety lifecycle", async () => {
  const admin = await seedLifecycleActors();
  await withE2ESafetyRuntime(
    (baseUrl) => runPostLifecycle(baseUrl, admin),
    {
      analyzeCase: ({ caseId, mode, aiConfig, automaticActionsEnabled }) => analyzeSafetyCase({
        caseId,
        mode,
        aiConfig,
        automaticActionsEnabled,
        withTransaction: transaction,
        moderation: async () => ({
          outcome: "block",
          status: "rejected",
          riskLevel: "high",
          source: "mockAliyun",
          reason: "Synthetic hard-safety signal"
        }),
        providerFactory: () => qwenProvider(qwenResult({
          category: "suspected_scam",
          riskLevel: "high",
          confidence: 0.99,
          recommendedAction: "hide_content_temporarily"
        })),
        now: E2E_NOW
      })
    }
  );
  await withE2EServer(async (baseUrl) => {
    await runCollectionLifecycle(baseUrl, admin);
    await runPrivateMessageLifecycle(baseUrl, admin);
  });
});

async function runPostLifecycle(baseUrl, admin) {
  const report = await requestJSON(baseUrl, "/api/reports", {
    method: "POST",
    userID: ACTORS.reporterA,
    body: {
      clientRequestID: "e2e-post-report",
      sourceType: "post",
      sourceID: TARGETS.cleanPost,
      reasonCode: "suspected_scam",
      reportedField: "content",
      detail: "Synthetic post image/content concern"
    }
  });
  assert.equal(report.status, 201);
  const caseID = report.body.report.caseID;

  await waitFor(async () => {
    const jobs = await pool.query(
      `SELECT count(*)::int AS count FROM safety_jobs
       WHERE case_id = $1 AND job_type IN ('case_received', 'analyze_case')
         AND status = 'completed'`,
      [caseID]
    );
    return jobs.rows[0].count === 2;
  });
  const shadow = await pool.query(
    `SELECT run.mode, run.status, run.proposed_actions,
            post.safety_status AS post_safety_status
     FROM safety_ai_runs run
     JOIN posts post ON post.id = $2
     WHERE run.case_id = $1`,
    [caseID, TARGETS.cleanPost]
  );
  assert.equal(shadow.rows[0].mode, "shadow");
  assert.equal(shadow.rows[0].status, "completed");
  assert.deepEqual(shadow.rows[0].proposed_actions.map((item) => item.actionType), ["hide_post"]);
  assert.equal(shadow.rows[0].post_safety_status, "active");

  const detail = await adminCase(baseUrl, caseID, admin);
  const hidden = await adminDecision(
    baseUrl,
    caseID,
    "temporary_hide",
    "Human review temporarily hides only this post",
    detail.version,
    admin
  );
  assert.equal(hidden.status, 200);
  assert.equal(hidden.body.case.status, "resolved_actioned");

  const postStates = await pool.query(
    `SELECT id, safety_status FROM posts
     WHERE id = ANY($1::text[]) ORDER BY id`,
    [[TARGETS.cleanPost, TARGETS.independentlyHiddenPost]]
  );
  assert.deepEqual(postStates.rows, [
    { id: TARGETS.cleanPost, safety_status: "hidden" },
    { id: TARGETS.independentlyHiddenPost, safety_status: "active" }
  ]);

  const reporterView = await requestJSON(baseUrl, "/api/me/reports", {
    userID: ACTORS.reporterA
  });
  assert.equal(reporterView.status, 200);
  assert.equal(reporterView.body.reports.find((item) => item.caseID === caseID).status, "handled");

  const correction = await adminDecision(
    baseUrl,
    caseID,
    "request_correction",
    "Owner must publish a corrected version",
    hidden.body.case.version,
    admin
  );
  assert.equal(correction.status, 200);
  assert.equal(correction.body.case.status, "awaiting_correction");

  const ownerActions = await requestJSON(baseUrl, "/api/me/content-actions", {
    userID: ACTORS.owner
  });
  const ownerAction = ownerActions.body.actions.find((item) => item.caseID === caseID);
  assert.equal(ownerAction.canSubmitRevision, true);
  assert.ok(ownerAction.correctionDueAt);

  const revision = await requestJSON(baseUrl, `/api/content-actions/${caseID}/revisions`, {
    method: "POST",
    userID: ACTORS.owner,
    body: {
      snapshot: {
        title: "Corrected post, same identity",
        groupType: "followGroup",
        isFormed: false,
        imageAspect: 1.08,
        description: "Corrected public content"
      }
    }
  });
  assert.equal(revision.status, 201);
  const revisionRow = await pool.query(
    "SELECT id FROM content_revisions WHERE case_id = $1",
    [caseID]
  );
  await transaction((client) => reviewContentRevision(client, {
    revisionId: revisionRow.rows[0].id,
    moderation: passModeration
  }));

  const ready = await adminCase(baseUrl, caseID, admin);
  const published = await adminDecision(
    baseUrl,
    caseID,
    "approve_revision",
    "Human approves the synthetic hard-safety pass",
    ready.version,
    admin
  );
  assert.equal(published.status, 200);
  assert.equal(published.body.case.status, "manual_review");
  const restored = await adminDecision(
    baseUrl,
    caseID,
    "restore",
    "Human explicitly restores the corrected post",
    published.body.case.version,
    admin
  );
  assert.equal(restored.status, 200);
  assert.equal(restored.body.case.status, "resolved_restored");

  const samePost = await pool.query(
    `SELECT post.id, post.title, post.safety_status,
            (SELECT count(*)::int FROM comments WHERE post_id = post.id) AS comments,
            (SELECT count(*)::int FROM post_likes WHERE post_id = post.id) AS likes,
            (SELECT count(*)::int FROM post_favorites WHERE post_id = post.id) AS favorites
     FROM posts post WHERE post.id = $1`,
    [TARGETS.cleanPost]
  );
  assert.deepEqual(samePost.rows[0], {
    id: TARGETS.cleanPost,
    title: "Corrected post, same identity",
    safety_status: "active",
    comments: 1,
    likes: 1,
    favorites: 1
  });
  const sync = await pool.query(
    `SELECT user_id, array_agg(DISTINCT event_type ORDER BY event_type) AS event_types
     FROM sync_events
     WHERE entity_id = $1 AND user_id = ANY($2::text[])
     GROUP BY user_id ORDER BY user_id`,
    [caseID, [ACTORS.owner, ACTORS.reporterA]]
  );
  assert.deepEqual(sync.rows, [
    {
      user_id: ACTORS.owner,
      event_types: ["safety.content_action.updated", "safety.report.updated"]
    },
    { user_id: ACTORS.reporterA, event_types: ["safety.report.updated"] }
  ]);
}

async function runCollectionLifecycle(baseUrl, admin) {
  const firstReport = await invalidContactReport(baseUrl, {
    reporterID: ACTORS.reporterA,
    requestID: "e2e-contact-report-a"
  });
  const caseID = firstReport.body.report.caseID;
  const firstAnalysis = await analyzeInvalidContact(caseID, E2E_NOW);
  assert.deepEqual(firstAnalysis.policy.proposedActions.map((item) => item.actionType), ["request_correction"]);
  let collection = await collectionState();
  assert.deepEqual(collection, { safety_status: "active", contact_visibility: "active" });

  const secondReport = await invalidContactReport(baseUrl, {
    reporterID: ACTORS.reporterB,
    requestID: "e2e-contact-report-b"
  });
  assert.equal(secondReport.body.report.caseID, caseID);
  const secondAnalysis = await analyzeInvalidContact(caseID, new Date(E2E_NOW.getTime() + 60_000));
  assert.deepEqual(secondAnalysis.policy.proposedActions.map((item) => item.actionType), ["hide_collection_contact"]);
  collection = await collectionState();
  assert.deepEqual(collection, { safety_status: "active", contact_visibility: "hidden" });
  assert.deepEqual(await childSafetyStates(), [
    { id: TARGETS.cleanPost, safety_status: "active" },
    { id: TARGETS.independentlyHiddenPost, safety_status: "active" }
  ]);

  await pool.query(
    `INSERT INTO safety_cases (id, subject_type, subject_id, category, impact_scope, status)
     VALUES ('e2e-independent-child-case', 'post', $1, 'harassment_or_abuse', 'post', 'received')`,
    [TARGETS.independentlyHiddenPost]
  );
  await transaction((client) => applySafetyAction(client, {
    caseId: "e2e-independent-child-case",
    idempotencyKey: "e2e-independent-child-hide",
    actionType: "hide_post",
    targetType: "post",
    targetId: TARGETS.independentlyHiddenPost,
    actorType: "system",
    reason: "independent_child_case"
  }));

  const deadline = await pool.query("SELECT correction_due_at FROM safety_cases WHERE id = $1", [caseID]);
  const maintenance = await transaction((client) => processCorrectionDeadlines(client, {
    now: new Date(deadline.rows[0].correction_due_at.getTime() + 1)
  }));
  assert.deepEqual(maintenance, { processed: 1 });
  collection = await collectionState();
  assert.deepEqual(collection, { safety_status: "suspended", contact_visibility: "hidden" });
  assert.deepEqual(await childSafetyStates(), [
    { id: TARGETS.cleanPost, safety_status: "active" },
    { id: TARGETS.independentlyHiddenPost, safety_status: "hidden" }
  ]);

  const revision = await requestJSON(baseUrl, `/api/content-actions/${caseID}/revisions`, {
    method: "POST",
    userID: ACTORS.owner,
    body: {
      snapshot: {
        name: "Corrected lifecycle collection",
        contactWechat: "correct-contact",
        contactQQ: "",
        contactGroupNumber: "",
        groupInfo: "Corrected group information",
        deadline: "2026-09-16T08:00:00.000Z",
        deadlineConfirmed: true,
        defaultNote: "Verified corrected contact"
      }
    }
  });
  assert.equal(revision.status, 201);
  const revisionRow = await pool.query(
    "SELECT id FROM content_revisions WHERE case_id = $1",
    [caseID]
  );
  await transaction((client) => reviewContentRevision(client, {
    revisionId: revisionRow.rows[0].id,
    moderation: passModeration
  }));
  const ready = await adminCase(baseUrl, caseID, admin);
  const published = await adminDecision(
    baseUrl,
    caseID,
    "approve_revision",
    "Human approves corrected collection contact",
    ready.version,
    admin
  );
  assert.equal(published.status, 200);
  assert.equal(published.body.case.status, "resolved_restored");
  collection = await collectionState();
  assert.deepEqual(collection, { safety_status: "active", contact_visibility: "active" });
  assert.deepEqual(await childSafetyStates(), [
    { id: TARGETS.cleanPost, safety_status: "active" },
    { id: TARGETS.independentlyHiddenPost, safety_status: "hidden" }
  ]);
}

async function runPrivateMessageLifecycle(baseUrl, admin) {
  const report = await requestJSON(baseUrl, "/api/reports", {
    method: "POST",
    userID: ACTORS.reporterA,
    body: {
      clientRequestID: "e2e-message-report",
      sourceType: "direct_message",
      sourceID: TARGETS.reportedMessage,
      reasonCode: "harassment_or_abuse",
      reportedField: "content",
      detail: "Synthetic incoming-message safety report"
    }
  });
  assert.equal(report.status, 201);
  const caseID = report.body.report.caseID;
  const blocked = await requestJSON(baseUrl, `/api/users/${ACTORS.messageSender}/block`, {
    method: "POST",
    userID: ACTORS.reporterA
  });
  assert.equal(blocked.status, 204);

  const evidence = await pool.query(
    `SELECT jsonb_array_length(structured_snapshot->'source'->'messages') AS message_count,
            context_start_message_id, context_end_message_id
     FROM safety_evidence WHERE case_id = $1`,
    [caseID]
  );
  assert.deepEqual(evidence.rows[0], {
    message_count: 7,
    context_start_message_id: "e2e-message-1",
    context_end_message_id: "e2e-message-7"
  });
  assert.equal((await pool.query(
    "SELECT count(*)::int AS count FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2",
    [ACTORS.reporterA, ACTORS.messageSender]
  )).rows[0].count, 1);

  const detail = await adminCase(baseUrl, caseID, admin);
  const hidden = await adminDecision(
    baseUrl,
    caseID,
    "temporary_hide",
    "Human temporarily hides the reported message",
    detail.version,
    admin
  );
  assert.equal(hidden.status, 200);
  assert.equal(hidden.body.case.status, "resolved_actioned");
  const message = await pool.query(
    "SELECT safety_status, revoked_at FROM direct_messages WHERE id = $1",
    [TARGETS.reportedMessage]
  );
  assert.deepEqual(message.rows[0], { safety_status: "hidden", revoked_at: null });

  const resolved = await pool.query("SELECT resolved_at FROM safety_cases WHERE id = $1", [caseID]);
  const retention = await transaction((client) => clearExpiredEvidence(client, {
    now: new Date(resolved.rows[0].resolved_at.getTime() + 180 * 24 * 60 * 60 * 1000 + 1_000)
  }));
  assert.equal(retention.processed, 1);
  const cleared = await pool.query(
    `SELECT text_snapshot, structured_snapshot, object_keys,
            redacted_at IS NOT NULL AS redacted
     FROM safety_evidence WHERE case_id = $1`,
    [caseID]
  );
  assert.deepEqual(cleared.rows[0], {
    text_snapshot: "",
    structured_snapshot: { redacted: true, reason: "retention_expired" },
    object_keys: [],
    redacted: true
  });
}

function invalidContactReport(baseUrl, { reporterID, requestID }) {
  return requestJSON(baseUrl, "/api/reports", {
    method: "POST",
    userID: reporterID,
    body: {
      clientRequestID: requestID,
      sourceType: "post",
      sourceID: TARGETS.cleanPost,
      reasonCode: "invalid_contact",
      reportedField: "contact_wechat",
      detail: `Synthetic invalid contact clue from ${reporterID}`
    }
  });
}

function analyzeInvalidContact(caseID, now) {
  return analyzeSafetyCase({
    caseId: caseID,
    mode: "enforce",
    automaticActionsEnabled: true,
    aiConfig: E2E_AI_CONFIG,
    withTransaction: transaction,
    moderation: passModeration,
    providerFactory: () => qwenProvider(qwenResult({
      category: "invalid_contact",
      subjectType: "collection",
      impactScope: "collection",
      riskLevel: "medium",
      confidence: 0.9,
      recommendedAction: "request_correction"
    })),
    assertEnforcementAllowed: async () => ({ passed: true }),
    now
  });
}

async function collectionState() {
  const { rows } = await pool.query(
    "SELECT safety_status, contact_visibility FROM group_collections WHERE id = $1",
    [TARGETS.collection]
  );
  return rows[0];
}

async function childSafetyStates() {
  const { rows } = await pool.query(
    "SELECT id, safety_status FROM posts WHERE collection_id = $1 ORDER BY id",
    [TARGETS.collection]
  );
  return rows;
}

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import express from "express";
import { WebSocket } from "ws";
import { signToken } from "../../src/auth.js";
import { createApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import { realtimeHub } from "../../src/realtime.js";
import * as appealService from "../../src/safety/appealService.js";
import { createSafetyRevisionRouter } from "../../src/safety/revisionRoutes.js";
import { closeDatabase, pool, resetDatabase } from "../helpers/database.js";

const { submitSafetyAppeal } = appealService;

test.beforeEach(async () => {
  await resetDatabase();
  await seedContentActionTargets();
});
test.after(closeDatabase);

test("owner content-action APIs require authentication", async () => {
  await withServer(async (baseUrl) => {
    for (const [method, path, body] of [
      ["GET", "/api/me/content-actions"],
      ["POST", "/api/content-actions/case-1/revisions", { snapshot: {} }],
      ["POST", "/api/content-actions/case-1/appeal", { detail: "Please review this decision." }]
    ]) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      assert.equal(response.status, 401, `${method} ${path}`);
      assert.deepEqual(await response.json(), { error: "需要登录" });
    }
  });
});

test("lists only owned post and collection actions with deterministic owner-safe fields", async () => {
  await seedContentActionListing();

  await withServer(async (baseUrl) => {
    const response = await get(baseUrl, "/api/me/content-actions", "u-owner");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      actions: [
        {
          caseID: "case-owned-post",
          targetType: "post",
          targetID: "post-owned",
          category: "suspected_scam",
          status: "awaiting_correction",
          affectedFields: ["content"],
          reason: "内容可能涉及交易欺诈，请按平台规则核实并整改",
          currentRestriction: "帖子当前已隐藏",
          correctionDueAt: "2026-07-18T04:00:00.000Z",
          canSubmitRevision: true,
          canAppeal: false,
          revisionStatus: "pending",
          updatedAt: "2026-07-13T04:00:00.000Z"
        },
        {
          caseID: "case-owned-collection",
          targetType: "collection",
          targetID: "collection-owned",
          category: "invalid_contact",
          status: "manual_review",
          affectedFields: ["contact_qq", "contact_wechat"],
          reason: "联系方式可能无效，请核实并更新相关信息",
          currentRestriction: "合集联系方式当前已隐藏",
          correctionDueAt: null,
          canSubmitRevision: false,
          canAppeal: false,
          revisionStatus: null,
          updatedAt: "2026-07-13T03:00:00.000Z"
        }
      ]
    });

    const expectedKeys = [
      "affectedFields", "canAppeal", "canSubmitRevision", "caseID", "category",
      "correctionDueAt", "currentRestriction", "reason", "revisionStatus", "status",
      "targetID", "targetType", "updatedAt"
    ];
    for (const action of response.body.actions) {
      assert.deepEqual(Object.keys(action).sort(), expectedKeys);
    }
    assertNoForbiddenKeys(response.body);
    const serialized = JSON.stringify(response.body);
    assert.equal(serialized.includes("case-owned-no-action"), false);
    for (const privateValue of [
      "u-reporter-secret", "u-reporter-secret-two", "rp-owned-post-a", "Reporter supplied private detail",
      "admin-secret", "Private admin reason", "Private model summary", "prompt-secret"
    ]) {
      assert.equal(serialized.includes(privateValue), false, privateValue);
    }
  });
});

test("lists restored content and derives restrictions from current target and parent state", async () => {
  await seedRestoredAndParentRestrictedActions();

  await withServer(async (baseUrl) => {
    const response = await get(baseUrl, "/api/me/content-actions", "u-owner");
    assert.equal(response.status, 200);
    const actions = Object.fromEntries(response.body.actions.map((action) => [action.caseID, action]));

    assert.deepEqual(actions["case-restored-post"], {
      caseID: "case-restored-post",
      targetType: "post",
      targetID: "post-restored",
      category: "other",
      status: "resolved_restored",
      affectedFields: ["content"],
      reason: "内容可能不符合平台规则，请核实并整改",
      currentRestriction: "",
      correctionDueAt: null,
      canSubmitRevision: false,
      canAppeal: false,
      revisionStatus: "published",
      updatedAt: "2026-07-13T06:00:00.000Z"
    });
    assert.deepEqual(actions["case-parent-restricted"], {
      caseID: "case-parent-restricted",
      targetType: "post",
      targetID: "post-parent-restricted",
      category: "other",
      status: "monitoring",
      affectedFields: ["content"],
      reason: "内容可能不符合平台规则，请核实并整改",
      currentRestriction: "帖子所属合集当前已暂停",
      correctionDueAt: null,
      canSubmitRevision: false,
      canAppeal: false,
      revisionStatus: null,
      updatedAt: "2026-07-13T05:00:00.000Z"
    });
    assertNoForbiddenKeys(response.body);
  });
});

test("marks only the latest currently eligible human final decision as appealable", async () => {
  await seedAppealEligibilityListing();

  await withServer(async (baseUrl) => {
    const response = await get(baseUrl, "/api/me/content-actions", "u-owner");
    assert.equal(response.status, 200);

    const eligibility = Object.fromEntries(
      response.body.actions.map((action) => [action.caseID, action.canAppeal])
    );
    assert.deepEqual(eligibility, {
      "case-appeal-ai": false,
      "case-appeal-correction": false,
      "case-appeal-eligible": true,
      "case-appeal-existing": false,
      "case-appeal-expired": false,
      "case-appeal-future": false,
      "case-appeal-mismatch": false,
      "case-appeal-wrong-state": false
    });
  });
});

test("uses an inclusive PostgreSQL appeal window at microsecond precision", async () => {
  assert.equal(typeof appealService.APPEAL_WINDOW_SQL, "string");
  const { rows } = await pool.query(
    `SELECT a.label, (${appealService.APPEAL_WINDOW_SQL}) AS is_open
     FROM (VALUES
       ('exact', transaction_timestamp() - interval '7 days'),
       ('expired', transaction_timestamp() - interval '7 days 1 microsecond'),
       ('future', transaction_timestamp() + interval '1 microsecond')
     ) AS a(label, applied_at)
     ORDER BY a.label`
  );
  assert.deepEqual(rows, [
    { label: "exact", is_open: true },
    { label: "expired", is_open: false },
    { label: "future", is_open: false }
  ]);
});

test("paginates owner cases without losing report, revision, or decision aggregates", async () => {
  await seedLargeOwnerActionListing();

  await withServer(async (baseUrl) => {
    const response = await get(baseUrl, "/api/me/content-actions", "u-owner");
    assert.equal(response.status, 200);
    assert.equal(response.body.actions.length, 100);
    assert.equal(response.body.actions[0].caseID, "case-bulk-104");
    assert.equal(response.body.actions[99].caseID, "case-bulk-005");
    assert.equal(response.body.actions.some((action) => action.caseID === "case-bulk-004"), false);
    assert.equal(typeof response.body.nextCursor, "string");

    assert.deepEqual(response.body.actions[0].affectedFields, ["content", "title"]);
    assert.equal(response.body.actions[0].revisionStatus, "published");
    const appealable = response.body.actions.find((action) => action.caseID === "case-bulk-103");
    assert.equal(appealable.canAppeal, true);

    await pool.query(
      "UPDATE safety_cases SET updated_at = '2026-07-14T00:00:00.000Z' WHERE id = 'case-bulk-004'"
    );

    const next = await get(
      baseUrl,
      `/api/me/content-actions?cursor=${encodeURIComponent(response.body.nextCursor)}`,
      "u-owner"
    );
    assert.equal(next.status, 200);
    assert.deepEqual(next.body.actions.map((action) => action.caseID), [
      "case-bulk-004", "case-bulk-003", "case-bulk-002", "case-bulk-001", "case-bulk-000"
    ]);
    assert.equal(Object.hasOwn(next.body, "nextCursor"), false);

    const allIDs = [...response.body.actions, ...next.body.actions].map((action) => action.caseID);
    assert.equal(allIDs.length, 105);
    assert.equal(new Set(allIDs).size, 105);
  });
});

test("submits an immutable revision and notifies its owner only after commit", async () => {
  await seedRevisionRouteCase();
  const before = await pool.query("SELECT * FROM posts WHERE id = 'post-owned'");
  const socket = new RecordingSocket(async () => {
    const { rows } = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM content_revisions WHERE case_id = 'case-revision-route') AS revisions,
         (SELECT count(*)::int FROM sync_events WHERE entity_id = 'case-revision-route') AS sync_events`
    );
    return rows[0];
  });
  realtimeHub.addConnection("u-owner", socket);

  try {
    await withServer(async (baseUrl) => {
      const response = await post(baseUrl, "/api/content-actions/case-revision-route/revisions", {
        snapshot: postCandidate({ title: "Corrected candidate title" })
      }, "u-owner");

      assert.equal(response.status, 201);
      assert.deepEqual(Object.keys(response.body), ["action"]);
      assert.deepEqual(response.body.action, {
        caseID: "case-revision-route",
        targetType: "post",
        targetID: "post-owned",
        category: "other",
        status: "rechecking",
        affectedFields: ["content"],
        reason: "内容可能不符合平台规则，请核实并整改",
        currentRestriction: "",
        correctionDueAt: "2026-07-20T04:00:00.000Z",
        canSubmitRevision: false,
        canAppeal: false,
        revisionStatus: "pending",
        updatedAt: response.body.action.updatedAt
      });
      assert.match(response.body.action.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
    });

    assert.deepEqual(await socket.committedState, { revisions: 1, sync_events: 1 });
    assert.equal(socket.messages.length, 1);
    assert.deepEqual(socket.messages[0], {
      type: "sync.available",
      cursor: socket.messages[0].cursor,
      eventType: "safety.content_action.updated",
      threadID: null
    });

    const revision = await pool.query(
      `SELECT cr.owner_id, cr.revision_number, cr.snapshot, cr.object_keys, cr.status,
              sc.status AS case_status,
              (SELECT count(*)::int FROM safety_jobs j WHERE j.unique_key = 'review_revision:' || cr.id) AS jobs,
              (SELECT count(*)::int FROM safety_case_events e
               WHERE e.case_id = cr.case_id AND e.event_type = 'revision.submitted') AS owner_events,
              (SELECT count(*)::int FROM sync_events se
               WHERE se.user_id = cr.owner_id AND se.event_type = 'safety.content_action.updated'
                 AND se.entity_type = 'safety_case' AND se.entity_id = cr.case_id) AS owner_syncs
       FROM content_revisions cr
       JOIN safety_cases sc ON sc.id = cr.case_id
       WHERE cr.case_id = 'case-revision-route'`
    );
    assert.deepEqual(revision.rows[0], {
      owner_id: "u-owner",
      revision_number: 1,
      snapshot: expectedPostCandidate({ title: "Corrected candidate title" }),
      object_keys: [],
      status: "pending",
      case_status: "rechecking",
      jobs: 1,
      owner_events: 1,
      owner_syncs: 1
    });
    const after = await pool.query("SELECT * FROM posts WHERE id = 'post-owned'");
    assert.deepEqual(after.rows[0], before.rows[0]);
  } finally {
    realtimeHub.removeConnection("u-owner", socket);
  }
});

test("rate limits repeated revision submissions before they enqueue more review work", async () => {
  await seedRevisionRouteCase();

  await withSafetyConfig({
    contentRevisionAccountMax24h: 1,
    contentRevisionIpMax24h: 100,
    contentRevisionBurstMaxMinute: 100
  }, () => withServer(async (baseUrl) => {
    const first = await post(baseUrl, "/api/content-actions/case-revision-route/revisions", {
      snapshot: postCandidate({ title: "First bounded candidate" })
    }, "u-owner");
    assert.equal(first.status, 201);

    const limited = await post(baseUrl, "/api/content-actions/case-revision-route/revisions", {
      snapshot: postCandidate({ title: "Second bounded candidate" })
    }, "u-owner");
    assert.equal(limited.status, 429);
    assert.equal(limited.body.code, "content_revision_rate_limited");
  }));

  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM content_revisions WHERE case_id = 'case-revision-route') AS revisions,
       (SELECT count(*)::int FROM safety_jobs WHERE case_id = 'case-revision-route') AS jobs`
  );
  assert.deepEqual(rows[0], { revisions: 1, jobs: 1 });
});

test("rejects invalid, non-owned, unsupported, and non-correction revision requests without side effects", async () => {
  await seedRevisionFailureCases();

  await withSafetyConfig({
    contentRevisionAccountMax24h: 100,
    contentRevisionIpMax24h: 100,
    contentRevisionBurstMaxMinute: 100
  }, () => withServer(async (baseUrl) => {
    for (const body of [
      [],
      {},
      { snapshot: postCandidate(), objectKeys: "report/u-owner/bad.jpg" },
      { snapshot: postCandidate(), extra: true },
      { snapshot: "not an object" }
    ]) {
      const response = await post(baseUrl, "/api/content-actions/case-revision-route/revisions", body, "u-owner");
      assert.equal(response.status, 400);
    }

    for (const caseID of ["case-revision-route", "case-revision-collection"]) {
      const response = await post(baseUrl, `/api/content-actions/${caseID}/revisions`, {
        snapshot: postCandidate()
      }, "u-other-owner");
      assert.equal(response.status, 403);
    }

    const unsupported = await post(baseUrl, "/api/content-actions/case-revision-comment/revisions", {
      snapshot: postCandidate()
    }, "u-owner");
    assert.equal(unsupported.status, 400);
    assert.equal(unsupported.body.code, "unsupported_revision_target");

    const wrongStatus = await post(baseUrl, "/api/content-actions/case-revision-manual/revisions", {
      snapshot: postCandidate()
    }, "u-owner");
    assert.equal(wrongStatus.status, 409);
    assert.equal(wrongStatus.body.code, "correction_not_requested");
  }));

  const counts = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM content_revisions) AS revisions,
       (SELECT count(*)::int FROM safety_jobs WHERE job_type = 'review_revision') AS jobs,
       (SELECT count(*)::int FROM safety_case_events WHERE event_type = 'revision.submitted') AS events,
       (SELECT count(*)::int FROM sync_events WHERE event_type = 'safety.content_action.updated') AS sync_events`
  );
  assert.deepEqual(counts.rows[0], { revisions: 0, jobs: 0, events: 0, sync_events: 0 });
});

test("rejects noncanonical and invalid case IDs before revision or appeal transactions mutate state", async () => {
  await seedRevisionRouteCase();
  await pool.query(
    `INSERT INTO posts (id, author_id, title, deadline)
     VALUES ('post-canonical-appeal', 'u-owner', 'Canonical appeal post', '2026-08-01T00:00:00.000Z')`
  );
  await seedAppealRouteCase({
    caseID: "case-canonical-appeal",
    targetID: "post-canonical-appeal",
    actionID: "action-canonical-appeal"
  });

  await withServer(async (baseUrl) => {
    for (const invalidCaseID of ["case-revision-route ", "case\u0000revision-route", "x".repeat(161)]) {
      const response = await post(baseUrl, `/api/content-actions/${encodeURIComponent(invalidCaseID)}/revisions`, {
        snapshot: postCandidate()
      }, "u-owner");
      assert.equal(response.status, 400, JSON.stringify(invalidCaseID));
      assert.equal(response.body.code, "invalid_content_action_case_id");
    }
    for (const invalidCaseID of ["case-canonical-appeal ", "case\u0000canonical-appeal", "x".repeat(161)]) {
      const response = await post(baseUrl, `/api/content-actions/${encodeURIComponent(invalidCaseID)}/appeal`, {
        detail: "Please review this decision."
      }, "u-owner");
      assert.equal(response.status, 400, JSON.stringify(invalidCaseID));
      assert.equal(response.body.code, "invalid_content_action_case_id");
    }
  });

  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM content_revisions) AS revisions,
       (SELECT count(*)::int FROM safety_appeals) AS appeals,
       (SELECT count(*)::int FROM sync_events WHERE event_type = 'safety.content_action.updated') AS sync_events,
       (SELECT status FROM safety_cases WHERE id = 'case-revision-route') AS revision_case_status,
       (SELECT status FROM safety_cases WHERE id = 'case-canonical-appeal') AS appeal_case_status`
  );
  assert.deepEqual(rows[0], {
    revisions: 0,
    appeals: 0,
    sync_events: 0,
    revision_case_status: "awaiting_correction",
    appeal_case_status: "resolved_actioned"
  });
});

test("rolls back revision intake and emits no realtime notification when owner sync fails", async () => {
  await seedRevisionRouteCase();
  await installFailingContentActionSyncTrigger();
  const socket = new RecordingSocket(async () => ({}));
  realtimeHub.addConnection("u-owner", socket);

  try {
    await withServer(async (baseUrl) => {
      const response = await post(baseUrl, "/api/content-actions/case-revision-route/revisions", {
        snapshot: postCandidate()
      }, "u-owner");
      assert.equal(response.status, 500);
    });

    assert.deepEqual(socket.messages, []);
    const state = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM content_revisions) AS revisions,
         (SELECT count(*)::int FROM safety_jobs WHERE job_type = 'review_revision') AS jobs,
         (SELECT count(*)::int FROM safety_case_events WHERE event_type = 'revision.submitted') AS events,
         (SELECT count(*)::int FROM sync_events WHERE event_type = 'safety.content_action.updated') AS sync_events,
         (SELECT status FROM safety_cases WHERE id = 'case-revision-route') AS case_status`
    );
    assert.deepEqual(state.rows[0], {
      revisions: 0,
      jobs: 0,
      events: 0,
      sync_events: 0,
      case_status: "awaiting_correction"
    });
  } finally {
    realtimeHub.removeConnection("u-owner", socket);
    await removeFailingContentActionSyncTrigger();
  }
});

test("keeps committed revision and appeal responses successful when post-commit notification fails", async () => {
  await seedRevisionRouteCase();
  await pool.query(
    `INSERT INTO posts (id, author_id, title, deadline)
     VALUES ('post-notifier-appeal', 'u-owner', 'Notifier appeal post', '2026-08-01T00:00:00.000Z')`
  );
  await seedAppealRouteCase({
    caseID: "case-notifier-appeal",
    targetID: "post-notifier-appeal",
    actionID: "action-notifier-appeal"
  });

  const committedNotifications = [];
  const logs = [];
  const responseBodies = [];
  const app = createRevisionTestApp({
    async notifySyncEvents(events) {
      const { rows } = await pool.query(
        `SELECT
           (SELECT count(*)::int FROM content_revisions WHERE case_id = 'case-revision-route') AS revisions,
           (SELECT count(*)::int FROM safety_appeals WHERE case_id = 'case-notifier-appeal') AS appeals,
           (SELECT count(*)::int FROM sync_events WHERE entity_id = $1) AS sync_events`,
        [events[0].entityID]
      );
      committedNotifications.push({ entityID: events[0].entityID, ...rows[0] });
      throw new Error("Authorization: Bearer raw-owner-notifier-secret");
    },
    eventLogger: {
      async error(event, fields) {
        logs.push({ event, fields });
        throw new Error("logger exposed raw-owner-logger-secret");
      }
    }
  });

  await withServer(async (baseUrl) => {
    const revision = await post(baseUrl, "/api/content-actions/case-revision-route/revisions", {
      snapshot: postCandidate({ title: "Committed despite notifier failure" })
    }, "u-owner");
    assert.equal(revision.status, 201);
    responseBodies.push(revision.body);

    const appeal = await post(baseUrl, "/api/content-actions/case-notifier-appeal/appeal", {
      detail: "Committed appeal despite notifier failure"
    }, "u-owner");
    assert.equal(appeal.status, 201);
    responseBodies.push(appeal.body);
  }, app);

  assert.deepEqual(committedNotifications, [
    { entityID: "case-revision-route", revisions: 1, appeals: 0, sync_events: 1 },
    { entityID: "case-notifier-appeal", revisions: 1, appeals: 1, sync_events: 1 }
  ]);
  assert.deepEqual(logs, [
    {
      event: "safety_routes.content_action_notify_failed",
      fields: { errorCode: "CONTENT_ACTION_NOTIFY_FAILED" }
    },
    {
      event: "safety_routes.content_action_notify_failed",
      fields: { errorCode: "CONTENT_ACTION_NOTIFY_FAILED" }
    }
  ]);
  assert.doesNotMatch(JSON.stringify(logs), /raw-owner-notifier-secret|Bearer/);
  assert.doesNotMatch(JSON.stringify(responseBodies), /raw-owner-logger-secret/);
});

test("submits one owner appeal with registered evidence and no decision or AI job", async () => {
  const objectKeys = [
    "report/u-owner/2026-07-13/appeal-one.jpg",
    "report/u-owner/2026-07-13/appeal-two.jpg"
  ];
  await seedAppealRouteCase();
  await seedRegisteredAppealUploads(objectKeys);
  const socket = new RecordingSocket(async () => {
    const { rows } = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM safety_appeals WHERE case_id = 'case-appeal-route') AS appeals,
         (SELECT status FROM safety_cases WHERE id = 'case-appeal-route') AS case_status,
         (SELECT count(*)::int FROM sync_events WHERE entity_id = 'case-appeal-route') AS sync_events`
    );
    return rows[0];
  });
  realtimeHub.addConnection("u-owner", socket);

  try {
    let response;
    await withServer(async (baseUrl) => {
      response = await post(baseUrl, "/api/content-actions/case-appeal-route/appeal", {
        detail: "  The final decision missed my supporting evidence. 申诉 😀  ",
        objectKeys
      }, "u-owner");
      assert.equal(response.status, 201);
      assert.deepEqual(response.body, {
        action: {
          caseID: "case-appeal-route",
          targetType: "post",
          targetID: "post-owned",
          category: "other",
          status: "appealed",
          affectedFields: ["content"],
          reason: "内容可能不符合平台规则，请核实并整改",
          currentRestriction: "帖子当前已隐藏",
          correctionDueAt: null,
          canSubmitRevision: false,
          canAppeal: false,
          revisionStatus: null,
          updatedAt: response.body.action.updatedAt
        }
      });
      assertNoForbiddenKeys(response.body);
    });

    assert.deepEqual(await socket.committedState, { appeals: 1, case_status: "appealed", sync_events: 1 });
    assert.equal(socket.messages.length, 1);
    assert.equal(socket.messages[0].eventType, "safety.content_action.updated");

    const appealState = await pool.query(
      `SELECT sa.id, sa.decision_action_id, sa.owner_id, sa.detail, sa.object_keys, sa.status,
              se.evidence_type, se.text_snapshot, se.structured_snapshot, se.object_keys AS evidence_object_keys,
              se.report_id, se.client_request_id,
              sc.status AS case_status, sc.manual_hold, sc.resolved_at,
              event.actor_type, event.actor_id, event.event_type, event.event_data,
              (SELECT count(*)::int FROM safety_jobs j
               WHERE j.case_id = sc.id AND j.job_type NOT IN ('cleanup_report_upload')) AS case_jobs,
              (SELECT count(*)::int FROM sync_events sync
               WHERE sync.user_id = sa.owner_id AND sync.event_type = 'safety.content_action.updated'
                 AND sync.entity_type = 'safety_case' AND sync.entity_id = sa.case_id) AS owner_syncs
       FROM safety_appeals sa
       JOIN safety_cases sc ON sc.id = sa.case_id
       JOIN safety_evidence se ON se.case_id = sa.case_id AND se.evidence_type = 'appeal'
       JOIN safety_case_events event ON event.case_id = sa.case_id AND event.event_type = 'appeal.submitted'
       WHERE sa.case_id = 'case-appeal-route'`
    );
    const row = appealState.rows[0];
    assert.match(row.id, /^sap-/);
    assert.deepEqual(row, {
      id: row.id,
      decision_action_id: "action-appeal-route",
      owner_id: "u-owner",
      detail: "The final decision missed my supporting evidence. 申诉 😀",
      object_keys: objectKeys,
      status: "pending",
      evidence_type: "appeal",
      text_snapshot: "The final decision missed my supporting evidence. 申诉 😀",
      structured_snapshot: { appealId: row.id, decisionActionId: "action-appeal-route" },
      evidence_object_keys: objectKeys,
      report_id: null,
      client_request_id: null,
      case_status: "appealed",
      manual_hold: true,
      resolved_at: null,
      actor_type: "owner",
      actor_id: "u-owner",
      event_type: "appeal.submitted",
      event_data: { appealId: row.id, decisionActionId: "action-appeal-route" },
      case_jobs: 0,
      owner_syncs: 1
    });
    assert.equal(JSON.stringify(row.event_data).includes("supporting evidence"), false);
    assert.equal(JSON.stringify(row.structured_snapshot).includes("supporting evidence"), false);
    const uploads = await pool.query(
      "SELECT object_key, state FROM report_uploads WHERE object_key = ANY($1::text[]) ORDER BY object_key",
      [objectKeys]
    );
    assert.deepEqual(uploads.rows, objectKeys.map((object_key) => ({ object_key, state: "attached" })));
  } finally {
    realtimeHub.removeConnection("u-owner", socket);
  }
});

test("appeal service requires an active PoolClient transaction and locks the target before rows", async () => {
  await seedAppealRouteCase();
  const fakeQueries = [];
  const fakeClient = {
    query(sql) {
      fakeQueries.push(String(sql));
      throw new Error("appeal business query should not run");
    }
  };
  for (const candidate of [pool, fakeClient]) {
    await assert.rejects(
      submitSafetyAppeal(candidate, appealSubmission()),
      (error) => error.name === "TypeError" && /transaction-scoped.*PoolClient/i.test(error.message)
    );
  }
  assert.deepEqual(fakeQueries, []);

  const noTransactionClient = await pool.connect();
  const noTransactionQueries = [];
  try {
    const proxy = clientProxy(noTransactionClient, noTransactionQueries);
    await assert.rejects(
      submitSafetyAppeal(proxy, appealSubmission()),
      (error) => error.name === "TypeError" && /active transaction/i.test(error.message)
    );
    assert.deepEqual(noTransactionQueries, ["SAVEPOINT submit_safety_appeal_probe"]);
  } finally {
    noTransactionClient.release();
  }

  const client = await pool.connect();
  const queries = [];
  try {
    await client.query("BEGIN");
    await submitSafetyAppeal(clientProxy(client, queries), appealSubmission());
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const metadataIndex = queries.findIndex((sql) => sql.includes("SELECT id, subject_type, subject_id FROM safety_cases"));
  const targetLockIndex = queries.findIndex((sql) => sql.includes("zbt:safety-target:"));
  const caseLockIndex = queries.findIndex((sql) => sql.includes("SELECT * FROM safety_cases") && sql.includes("FOR UPDATE"));
  const ownerLockIndex = queries.findIndex((sql) => sql.includes("FROM posts") && sql.includes("FOR UPDATE"));
  const decisionLockIndex = queries.findIndex((sql) => sql.includes("FROM safety_actions") && sql.includes("FOR UPDATE"));
  assert.ok(metadataIndex >= 0);
  assert.equal(queries[metadataIndex].includes("FOR UPDATE"), false);
  assert.ok(metadataIndex < targetLockIndex);
  assert.ok(targetLockIndex < caseLockIndex);
  assert.ok(caseLockIndex < ownerLockIndex);
  assert.ok(ownerLockIndex < decisionLockIndex);
});

test("appeal service accepts a decision applied exactly seven days before transaction time", async () => {
  await seedAppealRouteCase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE safety_actions
       SET applied_at = transaction_timestamp() - interval '7 days'
       WHERE id = $1`,
      ["action-appeal-route"]
    );

    const result = await submitSafetyAppeal(client, appealSubmission());
    await client.query("COMMIT");
    assert.equal(result.appeal.decision_action_id, "action-appeal-route");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const state = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM safety_appeals WHERE case_id = 'case-appeal-route') AS appeals,
       (SELECT count(*)::int FROM safety_jobs WHERE case_id = 'case-appeal-route') AS jobs,
       (SELECT status FROM safety_cases WHERE id = 'case-appeal-route') AS case_status`
  );
  assert.deepEqual(state.rows[0], { appeals: 1, jobs: 0, case_status: "appealed" });
});

test("accepts an appeal when a newer open case exists for the same subject and category", async () => {
  await seedAppealRouteCase();
  await pool.query(
    `INSERT INTO safety_cases (
       id, subject_type, subject_id, category, impact_scope, status
     ) VALUES (
       'case-appeal-route-newer', 'post', 'post-owned', 'other', 'post', 'manual_review'
     )`
  );

  await withServer(async (baseUrl) => {
    const response = await post(baseUrl, "/api/content-actions/case-appeal-route/appeal", {
      detail: "Please review the earlier final decision."
    }, "u-owner");

    assert.equal(response.status, 201);
    assert.equal(response.body.action.status, "appealed");
  });

  const { rows } = await pool.query(
    `SELECT id, status
     FROM safety_cases
     WHERE id IN ('case-appeal-route', 'case-appeal-route-newer')
     ORDER BY id`
  );
  assert.deepEqual(rows, [
    { id: "case-appeal-route", status: "appealed" },
    { id: "case-appeal-route-newer", status: "manual_review" }
  ]);
});

test("routes a new report to a new case while the prior decision is appealed", async () => {
  await seedAppealRouteCase({ actionType: "remove_post" });

  await withServer(async (baseUrl) => {
    const appeal = await post(baseUrl, "/api/content-actions/case-appeal-route/appeal", {
      detail: "Please review the earlier final decision."
    }, "u-owner");
    assert.equal(appeal.status, 201);

    const report = await post(baseUrl, "/api/reports", {
      clientRequestID: "report-during-appeal",
      sourceType: "post",
      sourceID: "post-owned",
      reasonCode: "other",
      reportedField: "content",
      detail: "This is a new event after the earlier decision."
    }, "u-reporter-secret");
    assert.equal(report.status, 201);
    assert.notEqual(report.body.report.caseID, "case-appeal-route");
  });

  const { rows } = await pool.query(
    `SELECT id, status
     FROM safety_cases
     WHERE subject_type = 'post' AND subject_id = 'post-owned' AND category = 'other'
     ORDER BY created_at, id`
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, "case-appeal-route");
  assert.equal(rows[0].status, "appealed");
  assert.equal(rows[1].status, "received");

  const reports = await pool.query(
    `SELECT case_id, status
     FROM reports
     WHERE reporter_id = 'u-reporter-secret' AND subject_type = 'post'
       AND subject_id = 'post-owned' AND reason_code = 'other'
     ORDER BY created_at, id`
  );
  assert.deepEqual(reports.rows, [
    { case_id: "case-appeal-route", status: "closed" },
    { case_id: rows[1].id, status: "pending" }
  ]);
});

test("rejects non-owned and ineligible appeals with controlled API codes and no new state", async () => {
  await seedAppealRejectionCases();

  await withServer(async (baseUrl) => {
    for (const caseID of ["case-appeal-route", "case-appeal-collection"]) {
      const response = await post(baseUrl, `/api/content-actions/${caseID}/appeal`, {
        detail: "Not my content"
      }, "u-other-owner");
      assert.equal(response.status, 403);
      assert.equal(response.body.code, "appeal_not_owner");
    }

    const cases = [
      ["case-appeal-unsupported", 400, "unsupported_appeal_target"],
      ["case-appeal-ai-only", 409, "appeal_not_available"],
      ["case-appeal-notify-only", 409, "appeal_not_available"],
      ["case-appeal-wrong-state", 409, "appeal_not_available"],
      ["case-appeal-expired", 409, "appeal_window_closed"],
      ["case-appeal-future", 409, "appeal_window_closed"],
      ["case-appeal-existing", 409, "appeal_already_submitted"],
      ["case-does-not-exist", 404, "safety_case_not_found"]
    ];
    for (const [caseID, status, code] of cases) {
      const response = await post(baseUrl, `/api/content-actions/${caseID}/appeal`, {
        detail: "Please review this final decision."
      }, "u-owner");
      assert.equal(response.status, status, caseID);
      assert.equal(response.body.code, code, caseID);
    }
  });

  const counts = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM safety_appeals) AS appeals,
       (SELECT count(*)::int FROM safety_evidence WHERE evidence_type = 'appeal') AS evidence,
       (SELECT count(*)::int FROM safety_case_events WHERE event_type = 'appeal.submitted') AS events,
       (SELECT count(*)::int FROM sync_events WHERE event_type = 'safety.content_action.updated') AS sync_events,
       (SELECT count(*)::int FROM safety_jobs) AS jobs`
  );
  assert.deepEqual(counts.rows[0], { appeals: 1, evidence: 0, events: 0, sync_events: 0, jobs: 0 });
});

test("enforces appeal detail and evidence bounds and accepts six registered owner uploads", async () => {
  await seedAppealRouteCase();
  await pool.query(
    `INSERT INTO posts (id, author_id, title, deadline)
     VALUES ('post-appeal-six-route', 'u-owner', 'Six evidence appeal', '2026-08-01T00:00:00.000Z')`
  );
  await seedAppealRouteCase({
    caseID: "case-appeal-six",
    targetID: "post-appeal-six-route",
    actionID: "action-appeal-six"
  });
  const sixObjectKeys = Array.from(
    { length: 6 },
    (_, index) => `report/u-owner/2026-07-13/appeal-evidence-${index}.jpg`
  );
  await seedRegisteredAppealUploads(sixObjectKeys);
  const wrongOwnerRegistration = "report/u-owner/2026-07-13/wrong-registration-owner.jpg";
  await seedRegisteredAppealUploads([wrongOwnerRegistration], "u-other-owner");

  await withServer(async (baseUrl) => {
    const invalidBodies = [
      [],
      {},
      { detail: "Valid detail", extra: true },
      { detail: 123 },
      { detail: "   " },
      { detail: "😀".repeat(1001) },
      { detail: "unsafe\u0000detail" },
      { detail: "Valid detail", objectKeys: null },
      { detail: "Valid detail", objectKeys: "not-an-array" },
      { detail: "Valid detail", objectKeys: Array.from({ length: 7 }, (_, index) => `report/u-owner/x-${index}`) },
      { detail: "Valid detail", objectKeys: [123] },
      { detail: "Valid detail", objectKeys: [""] },
      { detail: "Valid detail", objectKeys: ["report/u-owner/2026-07-13/bad\u0000key.jpg"] },
      { detail: "Valid detail", objectKeys: ["report/u-other-owner/2026-07-13/wrong-owner.jpg"] },
      { detail: "Valid detail", objectKeys: ["post/u-owner/2026-07-13/not-report.jpg"] },
      { detail: "Valid detail", objectKeys: ["report/u-owner/2026-07-13/../traversal.jpg"] },
      { detail: "Valid detail", objectKeys: [`report/u-owner/${"a".repeat(500)}`] }
    ];
    for (const body of invalidBodies) {
      const response = await post(baseUrl, "/api/content-actions/case-appeal-route/appeal", body, "u-owner");
      assert.equal(response.status, 400, JSON.stringify(body).slice(0, 120));
    }

    for (const objectKey of [
      "report/u-owner/2026-07-13/unregistered.jpg",
      wrongOwnerRegistration
    ]) {
      const response = await post(baseUrl, "/api/content-actions/case-appeal-route/appeal", {
        detail: "Valid detail",
        objectKeys: [objectKey]
      }, "u-owner");
      assert.equal(response.status, 409);
      assert.equal(response.body.code, "report_upload_unavailable");
    }

    const detail = `${"A".repeat(500)}\n${"B".repeat(499)}`;
    assert.equal(Array.from(detail).length, 1000);
    const accepted = await post(baseUrl, "/api/content-actions/case-appeal-six/appeal", {
      detail,
      objectKeys: sixObjectKeys
    }, "u-owner");
    assert.equal(accepted.status, 201);
  });

  const state = await pool.query(
    `SELECT sa.detail, sa.object_keys,
            (SELECT count(*)::int FROM safety_appeals WHERE case_id = 'case-appeal-route') AS rejected_case_appeals,
            (SELECT count(*)::int FROM report_uploads
             WHERE object_key = ANY($1::text[]) AND state = 'attached') AS attached_uploads,
            (SELECT state FROM report_uploads WHERE object_key = $2) AS wrong_owner_upload_state
     FROM safety_appeals sa
     WHERE sa.case_id = 'case-appeal-six'`,
    [sixObjectKeys, wrongOwnerRegistration]
  );
  assert.equal(Array.from(state.rows[0].detail).length, 1000);
  assert.equal(state.rows[0].detail.includes("\n"), true);
  assert.deepEqual(state.rows[0].object_keys, sixObjectKeys);
  assert.equal(state.rows[0].rejected_case_appeals, 0);
  assert.equal(state.rows[0].attached_uploads, 6);
  assert.equal(state.rows[0].wrong_owner_upload_state, "pending");
});

test("blocks a duplicate appeal transaction then returns one controlled conflict after commit", async () => {
  await seedAppealRouteCase();
  const firstClient = await pool.connect();
  const secondClient = await pool.connect();
  let secondOutcomePromise;

  try {
    await firstClient.query("BEGIN");
    await secondClient.query("BEGIN");
    await firstClient.query("SET LOCAL statement_timeout = '5000ms'");
    await secondClient.query("SET LOCAL statement_timeout = '5000ms'");
    const firstPID = (await firstClient.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const secondPID = (await secondClient.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;

    const firstResult = await submitSafetyAppeal(firstClient, appealSubmission({ detail: "Concurrent appeal A" }));
    secondOutcomePromise = submitSafetyAppeal(
      secondClient,
      appealSubmission({ detail: "Concurrent appeal B" })
    ).then(
      (value) => ({ status: "fulfilled", value }),
      (reason) => ({ status: "rejected", reason })
    );

    await waitForDatabaseBlock(secondPID, firstPID);
    await firstClient.query("COMMIT");
    assert.equal(firstResult.appeal.case_id, "case-appeal-route");

    const secondOutcome = await secondOutcomePromise;
    assert.equal(secondOutcome.status, "rejected");
    assert.equal(secondOutcome.reason.apiCode, "appeal_already_submitted");
    assert.notEqual(secondOutcome.reason.code, "40P01");
    await secondClient.query("ROLLBACK");
  } finally {
    await firstClient.query("ROLLBACK").catch(() => {});
    await secondClient.query("ROLLBACK").catch(() => {});
    firstClient.release();
    secondClient.release();
  }

  const state = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM safety_appeals WHERE case_id = 'case-appeal-route') AS appeals,
       (SELECT count(*)::int FROM safety_evidence
        WHERE case_id = 'case-appeal-route' AND evidence_type = 'appeal') AS evidence,
       (SELECT count(*)::int FROM safety_case_events
        WHERE case_id = 'case-appeal-route' AND event_type = 'appeal.submitted') AS events,
       (SELECT count(*)::int FROM sync_events
        WHERE entity_id = 'case-appeal-route' AND event_type = 'safety.content_action.updated') AS sync_events,
       (SELECT count(*)::int FROM safety_jobs WHERE case_id = 'case-appeal-route') AS jobs,
       (SELECT status FROM safety_cases WHERE id = 'case-appeal-route') AS case_status`
  );
  assert.deepEqual(state.rows[0], {
    appeals: 1,
    evidence: 1,
    events: 1,
    sync_events: 1,
    jobs: 0,
    case_status: "appealed"
  });
});

test("rolls back appeal state, evidence, and upload claim when owner sync fails", async () => {
  const objectKey = "report/u-owner/2026-07-13/appeal-rollback.jpg";
  await seedAppealRouteCase();
  await seedRegisteredAppealUploads([objectKey]);
  await installFailingContentActionSyncTrigger();
  const socket = new RecordingSocket(async () => ({}));
  realtimeHub.addConnection("u-owner", socket);

  try {
    await withServer(async (baseUrl) => {
      const response = await post(baseUrl, "/api/content-actions/case-appeal-route/appeal", {
        detail: "This transaction must roll back.",
        objectKeys: [objectKey]
      }, "u-owner");
      assert.equal(response.status, 500);
    });

    assert.deepEqual(socket.messages, []);
    const state = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM safety_appeals WHERE case_id = 'case-appeal-route') AS appeals,
         (SELECT count(*)::int FROM safety_evidence
          WHERE case_id = 'case-appeal-route' AND evidence_type = 'appeal') AS evidence,
         (SELECT count(*)::int FROM safety_case_events
          WHERE case_id = 'case-appeal-route' AND event_type = 'appeal.submitted') AS events,
         (SELECT count(*)::int FROM sync_events
          WHERE entity_id = 'case-appeal-route' AND event_type = 'safety.content_action.updated') AS sync_events,
         (SELECT count(*)::int FROM safety_jobs WHERE case_id = 'case-appeal-route') AS jobs,
         (SELECT status FROM safety_cases WHERE id = 'case-appeal-route') AS case_status,
         (SELECT manual_hold FROM safety_cases WHERE id = 'case-appeal-route') AS manual_hold,
         (SELECT resolved_at IS NOT NULL FROM safety_cases WHERE id = 'case-appeal-route') AS has_resolved_at,
         (SELECT state FROM report_uploads WHERE object_key = $1) AS upload_state`,
      [objectKey]
    );
    assert.deepEqual(state.rows[0], {
      appeals: 0,
      evidence: 0,
      events: 0,
      sync_events: 0,
      jobs: 0,
      case_status: "resolved_actioned",
      manual_hold: true,
      has_resolved_at: true,
      upload_state: "pending"
    });
  } finally {
    realtimeHub.removeConnection("u-owner", socket);
    await removeFailingContentActionSyncTrigger();
  }
});

async function withServer(callback, app = createApp()) {
  const server = app.listen(0);
  try {
    await onceListening(server);
    const { port } = server.address();
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function withSafetyConfig(overrides, callback) {
  const original = { ...config.safety };
  Object.assign(config.safety, overrides);
  try {
    return await callback();
  } finally {
    Object.assign(config.safety, original);
  }
}

function createRevisionTestApp(options) {
  const app = express();
  app.use(express.json());
  app.use("/api", createSafetyRevisionRouter(options));
  app.use((error, _req, res, _next) => {
    const body = { error: error.message || "服务暂时不可用" };
    if (error.apiCode) body.code = error.apiCode;
    res.status(error.status || 500).json(body);
  });
  return app;
}

function onceListening(server) {
  if (server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
}

async function get(baseUrl, path, userID) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${signToken({ id: userID, email: `${userID}@example.test` })}` }
  });
  return { status: response.status, body: await response.json() };
}

async function post(baseUrl, path, body, userID) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${signToken({ id: userID, email: `${userID}@example.test` })}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function seedContentActionTargets() {
  await pool.query(
    `INSERT INTO users (id, nickname)
     VALUES ('u-owner', 'Owner'), ('u-other-owner', 'Other owner'),
            ('u-reporter-secret', 'Private reporter'),
            ('u-reporter-secret-two', 'Private reporter two')`
  );
  await pool.query(
    `INSERT INTO group_collections (id, owner_id, name, deadline)
     VALUES
       ('collection-owned', 'u-owner', 'Owned collection', '2026-08-01T00:00:00.000Z'),
       ('collection-other', 'u-other-owner', 'Other collection', '2026-08-01T00:00:00.000Z')`
  );
  await pool.query(
    `INSERT INTO posts (id, author_id, collection_id, title, deadline)
     VALUES
       ('post-owned', 'u-owner', 'collection-owned', 'Owned post', '2026-08-01T00:00:00.000Z'),
       ('post-other', 'u-other-owner', 'collection-other', 'Other post', '2026-08-01T00:00:00.000Z')`
  );
  await pool.query(
    `INSERT INTO comments (id, post_id, author_id, body)
     VALUES ('comment-owned', 'post-owned', 'u-owner', 'Owned unsupported comment')`
  );
}

async function seedContentActionListing() {
  await pool.query("UPDATE posts SET safety_status = 'hidden' WHERE id = 'post-owned'");
  await pool.query("UPDATE group_collections SET contact_visibility = 'hidden' WHERE id = 'collection-owned'");
  await pool.query(
    `INSERT INTO safety_cases (
       id, subject_type, subject_id, category, impact_scope, status, correction_due_at,
       ai_recommendation, confidence, model_version, prompt_version, updated_at
     ) VALUES
       ('case-owned-post', 'post', 'post-owned', 'suspected_scam', 'post', 'awaiting_correction',
        '2026-07-18T04:00:00.000Z', '{"summary":"Private model summary"}', 0.9876,
        'model-secret', 'prompt-secret', '2026-07-13T04:00:00.000Z'),
       ('case-owned-collection', 'collection', 'collection-owned', 'invalid_contact', 'collection', 'manual_review',
        NULL, '{}', 0, '', '', '2026-07-13T03:00:00.000Z'),
       ('case-other-owner', 'post', 'post-other', 'suspected_scam', 'post', 'awaiting_correction',
        NULL, '{}', 0, '', '', '2026-07-13T05:00:00.000Z'),
       ('case-other-collection', 'collection', 'collection-other', 'invalid_contact', 'collection', 'awaiting_correction',
        NULL, '{}', 0, '', '', '2026-07-13T05:30:00.000Z'),
       ('case-unsupported', 'comment', 'comment-owned', 'harassment_or_abuse', 'comment', 'manual_review',
        NULL, '{}', 0, '', '', '2026-07-13T02:00:00.000Z'),
       ('case-not-owner-visible', 'post', 'post-owned', 'other', 'post', 'received',
        NULL, '{}', 0, '', '', '2026-07-13T01:00:00.000Z'),
       ('case-owned-no-action', 'post', 'post-owned', 'other', 'post', 'resolved_no_action',
        NULL, '{}', 0, '', '', '2026-07-13T06:00:00.000Z')`
  );
  await insertReport({
    id: "rp-owned-post-a", caseID: "case-owned-post", targetType: "post", targetID: "post-owned",
    reasonCode: "suspected_scam", reportedField: "content"
  });
  await insertReport({
    id: "rp-owned-post-b", caseID: "case-owned-post", targetType: "post", targetID: "post-owned",
    reasonCode: "suspected_scam", reportedField: "content", reporterID: "u-reporter-secret-two"
  });
  await insertReport({
    id: "rp-owned-collection-a", caseID: "case-owned-collection", targetType: "collection", targetID: "collection-owned",
    reasonCode: "invalid_contact", reportedField: "contact_wechat"
  });
  await insertReport({
    id: "rp-owned-collection-b", caseID: "case-owned-collection", targetType: "collection", targetID: "collection-owned",
    reasonCode: "invalid_contact", reportedField: "contact_qq", reporterID: "u-reporter-secret-two"
  });
  await insertReport({
    id: "rp-other", caseID: "case-other-owner", targetType: "post", targetID: "post-other",
    reasonCode: "suspected_scam", reportedField: "content"
  });
  await insertReport({
    id: "rp-other-collection", caseID: "case-other-collection", targetType: "collection", targetID: "collection-other",
    reasonCode: "invalid_contact", reportedField: "contact_wechat", reporterID: "u-reporter-secret-two"
  });
  await insertReport({
    id: "rp-owned-no-action", caseID: "case-owned-no-action", targetType: "post", targetID: "post-owned",
    reasonCode: "other", reportedField: "content"
  });

  await pool.query(
    `INSERT INTO safety_actions (
       id, case_id, idempotency_key, action_type, target_type, target_id, actor_type,
       actor_id, reason, execution_status, after_snapshot, applied_at, created_at
     ) VALUES
       ('action-owned-post', 'case-owned-post', 'owner-post-private', 'hide_post', 'post', 'post-owned',
        'admin', 'admin-secret', 'Private admin reason', 'applied', '{"private_note":"Private admin note"}',
        '2026-07-12T04:00:00.000Z', '2026-07-12T04:00:00.000Z'),
       ('action-owned-collection', 'case-owned-collection', 'owner-collection-private', 'hide_collection_contact',
        'collection', 'collection-owned', 'ai', 'ai-secret', 'Private AI reason', 'applied', '{}',
        '2026-07-12T03:00:00.000Z', '2026-07-12T03:00:00.000Z')`
  );
  await pool.query(
    `INSERT INTO content_revisions (
       id, case_id, target_type, target_id, owner_id, revision_number, snapshot, status, review_summary, created_at, updated_at
     ) VALUES
       ('revision-owned-post-1', 'case-owned-post', 'post', 'post-owned', 'u-owner', 1, '{}', 'rejected',
        '{"raw_summary":"Private revision summary"}', '2026-07-12T01:00:00.000Z', '2026-07-12T01:00:00.000Z'),
       ('revision-owned-post-2', 'case-owned-post', 'post', 'post-owned', 'u-owner', 2, '{}', 'pending',
        '{}', '2026-07-12T02:00:00.000Z', '2026-07-12T02:00:00.000Z')`
  );
}

async function seedRestoredAndParentRestrictedActions() {
  await pool.query(
    `INSERT INTO group_collections (id, owner_id, name, deadline, safety_status)
     VALUES ('collection-parent-restricted', 'u-owner', 'Restricted parent',
       '2026-08-01T00:00:00.000Z', 'suspended')`
  );
  await pool.query(
    `INSERT INTO posts (id, author_id, collection_id, title, deadline)
     VALUES
       ('post-restored', 'u-owner', NULL, 'Restored post', '2026-08-01T00:00:00.000Z'),
       ('post-parent-restricted', 'u-owner', 'collection-parent-restricted', 'Parent restricted post',
        '2026-08-01T00:00:00.000Z')`
  );
  await pool.query(
    `INSERT INTO safety_cases (
       id, subject_type, subject_id, category, impact_scope, status, updated_at
     ) VALUES
       ('case-restored-post', 'post', 'post-restored', 'other', 'post', 'resolved_restored',
        '2026-07-13T06:00:00.000Z'),
       ('case-parent-restricted', 'post', 'post-parent-restricted', 'other', 'post', 'monitoring',
        '2026-07-13T05:00:00.000Z')`
  );
  await insertReport({
    id: "rp-restored-post", caseID: "case-restored-post", targetType: "post", targetID: "post-restored",
    reasonCode: "other", reportedField: "content"
  });
  await insertReport({
    id: "rp-parent-restricted", caseID: "case-parent-restricted", targetType: "post",
    targetID: "post-parent-restricted", reasonCode: "other", reportedField: "content"
  });
  await pool.query(
    `INSERT INTO safety_actions (
       id, case_id, idempotency_key, action_type, target_type, target_id, actor_type,
       reason, execution_status, applied_at, created_at
     ) VALUES (
       'action-restored-stale', 'case-restored-post', 'restored-stale', 'hide_post', 'post', 'post-restored',
       'admin', 'Private stale reason', 'applied', '2026-07-12T06:00:00.000Z', '2026-07-12T06:00:00.000Z'
     )`
  );
  await pool.query(
    `INSERT INTO content_revisions (
       id, case_id, target_type, target_id, owner_id, revision_number, snapshot, status, created_at, updated_at
     ) VALUES (
       'revision-restored-published', 'case-restored-post', 'post', 'post-restored', 'u-owner', 1,
       '{}', 'published', '2026-07-13T04:00:00.000Z', '2026-07-13T04:00:00.000Z'
     )`
  );
}

async function seedLargeOwnerActionListing() {
  await pool.query(
    `INSERT INTO posts (id, author_id, title, deadline)
     SELECT 'post-bulk-' || lpad(n::text, 3, '0'), 'u-owner', 'Bulk post ' || n,
            '2026-08-01T00:00:00.000Z'::timestamptz
     FROM generate_series(0, 104) AS items(n)`
  );
  await pool.query(
    `INSERT INTO safety_cases (
       id, subject_type, subject_id, category, impact_scope, status, updated_at
     )
     SELECT 'case-bulk-' || lpad(n::text, 3, '0'), 'post',
            'post-bulk-' || lpad(n::text, 3, '0'), 'other', 'post',
            CASE WHEN n = 103 THEN 'resolved_actioned' ELSE 'manual_review' END,
            '2026-07-13T00:00:00.000Z'::timestamptz + n * interval '1 second'
     FROM generate_series(0, 104) AS items(n)`
  );
  await insertReport({
    id: "rp-bulk-104-content", caseID: "case-bulk-104", targetType: "post", targetID: "post-bulk-104",
    reasonCode: "other", reportedField: "content"
  });
  await insertReport({
    id: "rp-bulk-104-title", caseID: "case-bulk-104", targetType: "post", targetID: "post-bulk-104",
    reasonCode: "other", reportedField: "title", reporterID: "u-reporter-secret-two"
  });
  await pool.query(
    `INSERT INTO content_revisions (
       id, case_id, target_type, target_id, owner_id, revision_number, snapshot, status, created_at, updated_at
     ) VALUES
       ('revision-bulk-104-1', 'case-bulk-104', 'post', 'post-bulk-104', 'u-owner', 1,
        '{}', 'rejected', '2026-07-13T01:00:00.000Z', '2026-07-13T01:00:00.000Z'),
       ('revision-bulk-104-2', 'case-bulk-104', 'post', 'post-bulk-104', 'u-owner', 2,
        '{}', 'published', '2026-07-13T02:00:00.000Z', '2026-07-13T02:00:00.000Z')`
  );
  await pool.query(
    `INSERT INTO safety_actions (
       id, case_id, idempotency_key, action_type, target_type, target_id, actor_type,
       reason, execution_status, applied_at, created_at
     ) VALUES (
       'action-bulk-103', 'case-bulk-103', 'bulk-103', 'hide_post', 'post', 'post-bulk-103',
       'admin', 'private', 'applied', transaction_timestamp() - interval '1 day',
       transaction_timestamp() - interval '1 day'
     )`
  );
}

async function seedAppealEligibilityListing() {
  const names = ["eligible", "expired", "future", "ai", "correction", "existing", "wrong-state", "mismatch"];
  for (const name of names) {
    await pool.query(
      `INSERT INTO posts (id, author_id, title, deadline)
       VALUES ($1, 'u-owner', $2, '2026-08-01T00:00:00.000Z')`,
      [`post-appeal-${name}`, `Appeal ${name}`]
    );
  }
  await pool.query(
    `INSERT INTO safety_cases (
       id, subject_type, subject_id, category, impact_scope, status, manual_hold, updated_at
     ) VALUES
       ('case-appeal-eligible', 'post', 'post-appeal-eligible', 'other', 'post', 'resolved_actioned', true, now()),
       ('case-appeal-expired', 'post', 'post-appeal-expired', 'other', 'post', 'resolved_actioned', true, now()),
       ('case-appeal-future', 'post', 'post-appeal-future', 'other', 'post', 'resolved_actioned', true, now()),
       ('case-appeal-ai', 'post', 'post-appeal-ai', 'other', 'post', 'resolved_actioned', false, now()),
       ('case-appeal-correction', 'post', 'post-appeal-correction', 'other', 'post', 'resolved_actioned', true, now()),
       ('case-appeal-existing', 'post', 'post-appeal-existing', 'other', 'post', 'resolved_actioned', true, now()),
       ('case-appeal-wrong-state', 'post', 'post-appeal-wrong-state', 'other', 'post', 'manual_review', true, now()),
       ('case-appeal-mismatch', 'post', 'post-appeal-mismatch', 'other', 'post', 'resolved_actioned', true, now())`
  );
  await pool.query(
    `INSERT INTO safety_actions (
       id, case_id, idempotency_key, action_type, target_type, target_id, actor_type,
       reason, execution_status, applied_at, created_at
     ) VALUES
       ('action-appeal-eligible', 'case-appeal-eligible', 'appeal-eligible', 'hide_post', 'post', 'post-appeal-eligible',
        'admin', 'private', 'applied', now() - interval '6 days', now() - interval '6 days'),
       ('action-appeal-expired', 'case-appeal-expired', 'appeal-expired', 'hide_post', 'post', 'post-appeal-expired',
        'admin', 'private', 'applied', now() - interval '7 days 1 second', now() - interval '7 days 1 second'),
       ('action-appeal-future', 'case-appeal-future', 'appeal-future', 'hide_post', 'post', 'post-appeal-future',
        'admin', 'private', 'applied', now() + interval '1 second', now()),
       ('action-appeal-ai', 'case-appeal-ai', 'appeal-ai', 'hide_post', 'post', 'post-appeal-ai',
        'ai', 'private', 'applied', now() - interval '1 day', now() - interval '1 day'),
       ('action-appeal-correction', 'case-appeal-correction', 'appeal-correction', 'request_correction',
        'post', 'post-appeal-correction', 'admin', 'private', 'applied', now() - interval '1 day', now() - interval '1 day'),
       ('action-appeal-existing-a', 'case-appeal-existing', 'appeal-existing-a', 'hide_post', 'post', 'post-appeal-existing',
        'admin', 'private', 'applied', now() - interval '1 day', now() - interval '1 day'),
       ('action-appeal-existing-z', 'case-appeal-existing', 'appeal-existing-z', 'remove_post', 'post', 'post-appeal-existing',
        'admin', 'private', 'applied', now() - interval '1 day', now() - interval '1 day'),
       ('action-appeal-wrong-state', 'case-appeal-wrong-state', 'appeal-wrong-state', 'hide_post',
        'post', 'post-appeal-wrong-state', 'admin', 'private', 'applied', now() - interval '1 day', now() - interval '1 day'),
       ('action-appeal-mismatch', 'case-appeal-mismatch', 'appeal-mismatch', 'hide_post',
        'post', 'post-owned', 'admin', 'private', 'applied', now() - interval '1 day', now() - interval '1 day')`
  );
  await pool.query(
    `INSERT INTO safety_appeals (id, case_id, decision_action_id, owner_id, detail)
     VALUES ('appeal-existing', 'case-appeal-existing', 'action-appeal-existing-z', 'u-owner', 'Already appealed')`
  );
}

async function seedRevisionRouteCase() {
  await pool.query(
    `INSERT INTO safety_cases (
       id, subject_type, subject_id, category, impact_scope, status, correction_due_at, updated_at
     ) VALUES (
       'case-revision-route', 'post', 'post-owned', 'other', 'post', 'awaiting_correction',
       '2026-07-20T04:00:00.000Z', '2026-07-13T04:00:00.000Z'
     )`
  );
  await insertReport({
    id: "rp-revision-route", caseID: "case-revision-route", targetType: "post", targetID: "post-owned",
    reasonCode: "other", reportedField: "content"
  });
}

async function seedRevisionFailureCases() {
  await seedRevisionRouteCase();
  await pool.query(
    `INSERT INTO posts (id, author_id, title, deadline)
     VALUES ('post-revision-manual', 'u-owner', 'Manual review post', '2026-08-01T00:00:00.000Z')`
  );
  await pool.query(
    `INSERT INTO safety_cases (id, subject_type, subject_id, category, impact_scope, status)
     VALUES
       ('case-revision-collection', 'collection', 'collection-owned', 'other', 'collection', 'awaiting_correction'),
       ('case-revision-comment', 'comment', 'comment-owned', 'other', 'comment', 'awaiting_correction'),
       ('case-revision-manual', 'post', 'post-revision-manual', 'other', 'post', 'manual_review')`
  );
}

async function seedAppealRouteCase({
  caseID = "case-appeal-route",
  targetType = "post",
  targetID = "post-owned",
  actionID = "action-appeal-route",
  actionType = "hide_post",
  actorType = "admin",
  status = "resolved_actioned",
  appliedAtOffset = "-1 day"
} = {}) {
  await pool.query(
    `INSERT INTO safety_cases (
       id, subject_type, subject_id, category, impact_scope, status, manual_hold, resolved_at
     ) VALUES ($1, $2, $3, 'other', $2, $4, true, now())`,
    [caseID, targetType, targetID, status]
  );
  await insertReport({
    id: `rp-${caseID}`, caseID, targetType, targetID, reasonCode: "other", reportedField: "content"
  });
  await pool.query(
    `INSERT INTO safety_actions (
       id, case_id, idempotency_key, action_type, target_type, target_id, actor_type,
       actor_id, reason, execution_status, applied_at, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7,
       'private-admin-id', 'Private final decision reason', 'applied',
       statement_timestamp() + $8::interval, statement_timestamp() + $8::interval)`,
    [actionID, caseID, `key-${actionID}`, actionType, targetType, targetID, actorType, appliedAtOffset]
  );
  if (targetType === "post" && actionType === "hide_post") {
    await pool.query("UPDATE posts SET safety_status = 'hidden' WHERE id = $1", [targetID]);
  }
  if (targetType === "collection" && actionType === "hide_collection_contact") {
    await pool.query("UPDATE group_collections SET contact_visibility = 'hidden' WHERE id = $1", [targetID]);
  }
}

async function seedAppealRejectionCases() {
  await seedAppealRouteCase();
  await seedAppealRouteCase({
    caseID: "case-appeal-collection",
    targetType: "collection",
    targetID: "collection-owned",
    actionID: "action-appeal-collection",
    actionType: "hide_collection_contact"
  });
  await seedAppealRouteCase({
    caseID: "case-appeal-unsupported",
    targetType: "comment",
    targetID: "comment-owned",
    actionID: "action-appeal-unsupported",
    actionType: "hide_comment"
  });
  for (const name of ["ai-only", "notify-only", "wrong-state", "expired", "future", "existing"]) {
    await pool.query(
      `INSERT INTO posts (id, author_id, title, deadline)
       VALUES ($1, 'u-owner', $2, '2026-08-01T00:00:00.000Z')`,
      [`post-appeal-${name}-route`, `Appeal ${name}`]
    );
  }
  await seedAppealRouteCase({
    caseID: "case-appeal-ai-only",
    targetID: "post-appeal-ai-only-route",
    actionID: "action-appeal-ai-only",
    actorType: "ai"
  });
  await seedAppealRouteCase({
    caseID: "case-appeal-notify-only",
    targetID: "post-appeal-notify-only-route",
    actionID: "action-appeal-notify-only",
    actionType: "notify_owner"
  });
  await seedAppealRouteCase({
    caseID: "case-appeal-wrong-state",
    targetID: "post-appeal-wrong-state-route",
    actionID: "action-appeal-wrong-state-route",
    status: "manual_review"
  });
  await seedAppealRouteCase({
    caseID: "case-appeal-expired",
    targetID: "post-appeal-expired-route",
    actionID: "action-appeal-expired-route",
    appliedAtOffset: "-7 days -1 second"
  });
  await seedAppealRouteCase({
    caseID: "case-appeal-future",
    targetID: "post-appeal-future-route",
    actionID: "action-appeal-future-route",
    appliedAtOffset: "1 second"
  });
  await seedAppealRouteCase({
    caseID: "case-appeal-existing",
    targetID: "post-appeal-existing-route",
    actionID: "action-appeal-existing-route"
  });
  await pool.query(
    `INSERT INTO safety_appeals (id, case_id, decision_action_id, owner_id, detail)
     VALUES ('sap-existing-route', 'case-appeal-existing', 'action-appeal-existing-route', 'u-owner', 'Existing appeal')`
  );
}

async function seedRegisteredAppealUploads(objectKeys, ownerID = "u-owner") {
  for (const objectKey of objectKeys) {
    await pool.query(
      `INSERT INTO report_uploads (object_key, owner_user_id)
       VALUES ($1, $2)`,
      [objectKey, ownerID]
    );
  }
}

async function installFailingContentActionSyncTrigger() {
  await pool.query(
    `CREATE FUNCTION fail_content_action_sync() RETURNS trigger
     LANGUAGE plpgsql AS $$
     BEGIN
       IF NEW.event_type = 'safety.content_action.updated' THEN
         RAISE EXCEPTION 'injected content action sync failure';
       END IF;
       RETURN NEW;
     END;
     $$`
  );
  await pool.query(
    `CREATE TRIGGER fail_content_action_sync_trigger
     BEFORE INSERT ON sync_events
     FOR EACH ROW EXECUTE FUNCTION fail_content_action_sync()`
  );
}

async function removeFailingContentActionSyncTrigger() {
  await pool.query("DROP TRIGGER IF EXISTS fail_content_action_sync_trigger ON sync_events");
  await pool.query("DROP FUNCTION IF EXISTS fail_content_action_sync()");
}

function postCandidate(overrides = {}) {
  return {
    title: "Corrected title",
    groupType: "followGroup",
    isFormed: false,
    imageAspect: 1.08,
    ...overrides
  };
}

function expectedPostCandidate(overrides = {}) {
  return {
    title: "Corrected title",
    imageNames: [],
    imageObjectKeys: [],
    previewImageObjectKeys: [],
    groupType: "followGroup",
    categoryTags: [],
    fandomTags: [],
    price: "",
    deposit: "",
    condition: "",
    isFormed: false,
    description: "",
    externalLink: "",
    imageAspect: 1.08,
    pingguAveragePrice: "",
    pingguNote: "",
    unsoldRoles: [],
    ...overrides
  };
}

function appealSubmission(overrides = {}) {
  return {
    caseId: "case-appeal-route",
    ownerId: "u-owner",
    detail: "Please review the final decision.",
    objectKeys: [],
    ...overrides
  };
}

function clientProxy(client, queries) {
  return {
    query(sql, params) {
      queries.push(String(sql));
      return client.query(sql, params);
    },
    release: client.release.bind(client)
  };
}

async function waitForDatabaseBlock(blockedPID, blockerPID, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await pool.query(
      "SELECT $2::int = ANY(pg_blocking_pids($1::int)) AS blocked",
      [blockedPID, blockerPID]
    );
    if (rows[0].blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("duplicate appeal did not block behind the first transaction");
}

class RecordingSocket extends EventEmitter {
  constructor(readCommittedState) {
    super();
    this.readyState = WebSocket.OPEN;
    this.messages = [];
    this.committedState = null;
    this.readCommittedState = readCommittedState;
  }

  send(data) {
    this.messages.push(JSON.parse(data));
    this.committedState = this.readCommittedState();
  }
}

async function insertReport({
  id, caseID, targetType, targetID, reasonCode, reportedField, reporterID = "u-reporter-secret"
}) {
  await pool.query(
    `INSERT INTO reports (
       id, target_type, target_id, reason, detail, reporter_id, status, client_request_id,
       case_id, source_type, source_id, subject_type, subject_id, reason_code, reported_field
     ) VALUES ($1, $2, $3, 'Private report reason', 'Reporter supplied private detail',
       $7, 'pending', $1, $4, $2, $3, $2, $3, $5, $6)`,
    [id, targetType, targetID, caseID, reasonCode, reportedField, reporterID]
  );
}

function assertNoForbiddenKeys(value) {
  const forbidden = new Set([
    "reporterID", "reporterId", "reporter_id", "reportCount", "report_count", "reportIDs",
    "report_ids", "reportID", "report_id", "detail", "actorID", "actorId", "actor_id",
    "adminReason", "admin_reason", "privateNotes", "private_notes", "ai_recommendation",
    "confidence", "model_version", "prompt_version", "raw_summary", "rawSummary"
  ]);
  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenKeys(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    assert.equal(forbidden.has(key), false, `forbidden response key: ${key}`);
    assertNoForbiddenKeys(item);
  }
}

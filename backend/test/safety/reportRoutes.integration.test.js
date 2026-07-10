import assert from "node:assert/strict";
import test from "node:test";
import { signToken } from "../../src/auth.js";
import { createApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import { safetyReportToClient } from "../../src/safety/reportMapper.js";
import { closeDatabase, pool, resetDatabase } from "../helpers/database.js";

test.beforeEach(async () => {
  await resetDatabase();
  await seedReportTargets();
});

test.after(closeDatabase);

test("maps case statuses and legacy rows to the strict public report shape", () => {
  const base = {
    id: "rp-public",
    case_id: "sc-public",
    target_type: "post",
    target_id: "post-1",
    reason: "legacy reason",
    reporter_id: "u-reporter",
    admin_result: "legacy admin result",
    handled_at: "2026-07-10T02:00:00.000Z",
    source_type: "post",
    source_id: "post-1",
    subject_type: "post",
    subject_id: "post-1",
    reason_code: "suspected_scam",
    reported_field: "content",
    detail: "Public detail",
    created_at: "2026-07-10T00:00:00.000Z",
    updated_at: "2026-07-10T01:00:00.000Z"
  };
  for (const [caseStatus, status] of [
    ["received", "received"],
    ["triaging", "reviewing"],
    ["monitoring", "reviewing"],
    ["manual_review", "reviewing"],
    ["awaiting_correction", "reviewing"],
    ["rechecking", "reviewing"],
    ["appealed", "reviewing"],
    ["resolved_no_action", "no_violation"],
    ["resolved_restored", "handled"],
    ["resolved_actioned", "handled"]
  ]) {
    assert.equal(safetyReportToClient({ ...base, case_status: caseStatus }).status, status);
  }
  assert.deepEqual(safetyReportToClient({
    id: "rp-legacy",
    target_type: "comment",
    target_id: "comment-1",
    reason: "legacy reason",
    reporter_id: "u-reporter",
    admin_result: "legacy admin result",
    handled_at: "2026-07-10T02:00:00.000Z",
    detail: "legacy detail",
    status: "pending",
    created_at: "2026-07-10T00:00:00.000Z"
  }), {
    id: "rp-legacy",
    caseID: "",
    sourceType: "comment",
    sourceID: "comment-1",
    subjectType: "comment",
    subjectID: "comment-1",
    reasonCode: "other",
    reportedField: "content",
    detail: "legacy detail",
    status: "received",
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z"
  });
});

test("accepts a first safety report for every supported source type", async () => {
  await withServer(async (baseUrl) => {
    const cases = [
      {
        body: {
          clientRequestID: "request-post",
          sourceType: "post",
          sourceID: "post-1",
          reasonCode: "suspected_scam",
          reportedField: "content",
          detail: "The listing price is misleading."
        },
        subjectType: "post",
        subjectID: "post-1"
      },
      {
        body: {
          clientRequestID: "request-comment",
          sourceType: "comment",
          sourceID: "comment-1",
          reasonCode: "harassment_or_abuse",
          reportedField: "content",
          detail: "This comment targets a member."
        },
        subjectType: "comment",
        subjectID: "comment-1"
      },
      {
        body: {
          clientRequestID: "request-user",
          sourceType: "user",
          sourceID: "u-owner",
          reasonCode: "suspected_scam",
          reportedField: "content",
          detail: "The profile asks for payment off-platform."
        },
        subjectType: "user",
        subjectID: "u-owner"
      },
      {
        body: {
          clientRequestID: "request-direct-message",
          sourceType: "direct_message",
          sourceID: "message-1",
          reasonCode: "direct_message_risk",
          reportedField: "content",
          detail: "The message requests an unsafe transfer."
        },
        subjectType: "direct_message",
        subjectID: "message-1"
      },
      {
        body: {
          clientRequestID: "request-collection",
          sourceType: "collection",
          sourceID: "collection-1",
          reasonCode: "false_or_expired_group_buy",
          reportedField: "collection_deadline",
          detail: "The published deadline has already passed."
        },
        subjectType: "collection",
        subjectID: "collection-1"
      }
    ];

    for (const expected of cases) {
      const response = await request(baseUrl, "/api/reports", expected.body);
      assert.equal(response.status, 201, expected.body.sourceType);
      assert.equal(response.body.duplicate, false);
      assert.equal(typeof response.body.duplicate, "boolean");
      assert.deepEqual(Object.keys(response.body.report).sort(), [
        "caseID", "createdAt", "detail", "id", "reasonCode", "reportedField",
        "sourceID", "sourceType", "status", "subjectID", "subjectType", "updatedAt"
      ]);
      assert.equal(response.body.report.sourceType, expected.body.sourceType);
      assert.equal(response.body.report.sourceID, expected.body.sourceID);
      assert.equal(response.body.report.subjectType, expected.subjectType);
      assert.equal(response.body.report.subjectID, expected.subjectID);
      assert.equal(response.body.report.reasonCode, expected.body.reasonCode);
      assert.equal(response.body.report.reportedField, expected.body.reportedField);
      assert.equal(response.body.report.detail, expected.body.detail);
      assert.equal(response.body.report.status, "received");
      for (const field of ["target", "reason", "reporterID", "adminResult", "handledAt", "caseStatus", "riskLevel", "aiRecommendation"]) {
        assert.equal(Object.hasOwn(response.body.report, field), false, field);
      }
    }
  });

  assert.equal((await pool.query("SELECT count(*)::int AS count FROM reports")).rows[0].count, 5);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM safety_cases")).rows[0].count, 5);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM safety_evidence")).rows[0].count, 5);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM safety_jobs")).rows[0].count, 5);
});

test("uses one forbidden response for invisible direct messages while preserving own-target validation", async () => {
  await withServer(async (baseUrl) => {
    for (const sourceID of ["message-1", "missing-message"]) {
      const response = await request(baseUrl, "/api/reports", {
        clientRequestID: `outsider-${sourceID}`,
        sourceType: "direct_message",
        sourceID,
        reasonCode: "direct_message_risk",
        reportedField: "content",
        detail: "Unsafe message"
      }, { userID: "u-outsider" });
      assert.equal(response.status, 403);
      assert.equal(response.body.error, "举报目标不存在或不可见");
    }

    const ownTarget = await request(baseUrl, "/api/reports", {
      clientRequestID: "own-message",
      sourceType: "direct_message",
      sourceID: "message-1",
      reasonCode: "direct_message_risk",
      reportedField: "content",
      detail: "Unsafe message"
    }, { userID: "u-dm-sender" });
    assert.equal(ownTarget.status, 400);
    assert.equal(ownTarget.body.error, "不能举报自己的内容");
  });
});

test("deduplicates an exact request and adds immutable evidence for a new pending request", async () => {
  await pool.query("UPDATE posts SET image_object_keys = ARRAY['post/u-owner/2026-07-10/source.png']::text[] WHERE id = 'post-1'");
  await withServer(async (baseUrl) => {
    const first = await request(baseUrl, "/api/reports", reportInput({
      clientRequestID: "first-request",
      objectKeys: ["report/u-reporter/2026-07-10/first.png"]
    }));
    assert.equal(first.status, 201);
    assert.equal(first.body.duplicate, false);

    const retry = await request(baseUrl, "/api/reports", reportInput({
      clientRequestID: "first-request",
      detail: "Ignored because this is an exact retry.",
      objectKeys: ["report/u-reporter/2026-07-10/retry.png"]
    }));
    assert.equal(retry.status, 200);
    assert.equal(retry.body.duplicate, true);
    assert.equal(retry.body.report.id, first.body.report.id);
    assert.equal(retry.body.report.caseID, first.body.report.caseID);
    await assertCounts({ reports: 1, cases: 1, evidence: 1, jobs: 1, events: 1, syncEvents: 1 });
    const initialEvidence = await pool.query(
      "SELECT object_keys FROM safety_evidence WHERE client_request_id = 'first-request'"
    );
    assert.deepEqual(initialEvidence.rows[0].object_keys, [
      "post/u-owner/2026-07-10/source.png",
      "report/u-reporter/2026-07-10/first.png"
    ]);

    const supplement = await request(baseUrl, "/api/reports", reportInput({
      clientRequestID: "supplement-request",
      detail: "Here is additional context.",
      objectKeys: ["report/u-reporter/2026-07-10/supplement.png"]
    }));
    assert.equal(supplement.status, 200);
    assert.equal(supplement.body.duplicate, true);
    assert.equal(supplement.body.report.id, first.body.report.id);
    assert.equal(supplement.body.report.caseID, first.body.report.caseID);
    await assertCounts({ reports: 1, cases: 1, evidence: 2, jobs: 1, events: 2, syncEvents: 2 });

    const evidence = await pool.query(
      "SELECT evidence_type, text_snapshot, structured_snapshot, object_keys FROM safety_evidence WHERE client_request_id = 'supplement-request'"
    );
    assert.equal(evidence.rows[0].evidence_type, "report_supplement");
    assert.equal(evidence.rows[0].text_snapshot, "Here is additional context.");
    assert.equal(evidence.rows[0].structured_snapshot.supplemental, true);
    assert.equal(evidence.rows[0].structured_snapshot.sourceEvidenceType, "post");
    assert.equal(evidence.rows[0].structured_snapshot.source.id, "post-1");
    assert.equal(evidence.rows[0].structured_snapshot.detail, "Here is additional context.");
    assert.deepEqual(evidence.rows[0].object_keys, [
      "post/u-owner/2026-07-10/source.png",
      "report/u-reporter/2026-07-10/supplement.png"
    ]);
  });
});

test("creates a new report and case after the prior report and case are terminal", async () => {
  await withServer(async (baseUrl) => {
    const first = await request(baseUrl, "/api/reports", reportInput({ clientRequestID: "terminal-first" }));
    assert.equal(first.status, 201);
    await pool.query("UPDATE safety_cases SET status = 'resolved_no_action' WHERE id = $1", [first.body.report.caseID]);

    const exactRetry = await request(baseUrl, "/api/reports", reportInput({ clientRequestID: "terminal-first" }));
    assert.equal(exactRetry.status, 200);
    assert.equal(exactRetry.body.report.id, first.body.report.id);

    const reopened = await request(baseUrl, "/api/reports", reportInput({ clientRequestID: "terminal-second" }));
    assert.equal(reopened.status, 201);
    assert.notEqual(reopened.body.report.id, first.body.report.id);
    assert.notEqual(reopened.body.report.caseID, first.body.report.caseID);
    const oldReport = await pool.query("SELECT status FROM reports WHERE id = $1", [first.body.report.id]);
    assert.equal(oldReport.rows[0].status, "closed");
    await assertCounts({ reports: 2, cases: 2, evidence: 2, jobs: 2, events: 2, syncEvents: 2 });
  });
});

test("does not duplicate reports, evidence, or cases under concurrent retries and pending reasons", async () => {
  await withServer(async (baseUrl) => {
    const exactResponses = await Promise.all(Array.from({ length: 2 }, () => request(
      baseUrl,
      "/api/reports",
      reportInput({ clientRequestID: "concurrent-exact" })
    )));
    assert.deepEqual(exactResponses.map((response) => response.status).sort(), [200, 201]);
    assert.equal(exactResponses[0].body.report.id, exactResponses[1].body.report.id);
    await assertCounts({ reports: 1, cases: 1, evidence: 1, jobs: 1, events: 1, syncEvents: 1 });
  });

  await resetDatabase();
  await seedReportTargets();
  await withServer(async (baseUrl) => {
    const pendingResponses = await Promise.all(["concurrent-a", "concurrent-b"].map((clientRequestID) => request(
      baseUrl,
      "/api/reports",
      reportInput({ clientRequestID })
    )));
    assert.deepEqual(pendingResponses.map((response) => response.status).sort(), [200, 201]);
    assert.equal(pendingResponses[0].body.report.id, pendingResponses[1].body.report.id);
    await assertCounts({ reports: 1, cases: 1, evidence: 2, jobs: 1, events: 2, syncEvents: 2 });
  });
});

test("lists only a reporter's public report records", async () => {
  await withServer(async (baseUrl) => {
    const own = await request(baseUrl, "/api/reports", reportInput({ clientRequestID: "list-own" }));
    const other = await request(baseUrl, "/api/reports", reportInput({
      clientRequestID: "list-other",
      sourceID: "comment-1",
      sourceType: "comment",
      reasonCode: "harassment_or_abuse"
    }), { userID: "u-reporter-two" });
    assert.equal(own.status, 201);
    assert.equal(other.status, 201);

    const mine = await getReports(baseUrl, "u-reporter");
    assert.equal(mine.status, 200);
    assert.equal(mine.body.reports.length, 1);
    assert.deepEqual(mine.body.reports[0], own.body.report);
    for (const field of [
      "target", "reason", "reporterID", "adminResult", "handledAt", "reporter_id", "caseStatus", "case_status", "riskLevel", "risk_level",
      "confidence", "aiRecommendation", "ai_recommendation", "modelVersion", "model_version",
      "promptVersion", "prompt_version", "internal"
    ]) {
      assert.equal(Object.hasOwn(mine.body.reports[0], field), false, field);
    }

    const theirs = await getReports(baseUrl, "u-reporter-two");
    assert.equal(theirs.status, 200);
    assert.deepEqual(theirs.body.reports, [other.body.report]);

    const unauthenticated = await fetch(`${baseUrl}/api/me/reports`);
    assert.equal(unauthenticated.status, 401);
  });
});

test("keeps bootstrap reports backward-compatible without exposing safety internals", async () => {
  await withServer(async (baseUrl) => {
    const created = await request(baseUrl, "/api/reports", reportInput({ clientRequestID: "bootstrap-report" }));
    await pool.query(
      "UPDATE reports SET reason = $2, reason_code = $3, admin_result = $4, handled_at = $5 WHERE id = $1",
      [created.body.report.id, "original legacy reason", "other", "legacy review note", "2026-07-11T00:00:00.000Z"]
    );

    const bootstrap = await getBootstrap(baseUrl, "u-reporter");
    assert.equal(bootstrap.status, 200);
    assert.equal(bootstrap.body.reports.length, 1);
    const [report] = bootstrap.body.reports;
    for (const key of ["target", "reason", "reporterID", "adminResult", "handledAt", "caseID", "reasonCode", "sourceType", "subjectType"]) {
      assert.equal(Object.hasOwn(report, key), true, key);
    }
    assert.deepEqual(report.target, { type: "post", id: "post-1" });
    assert.equal(report.reason, "original legacy reason");
    assert.equal(report.reporterID, "u-reporter");
    assert.equal(report.adminResult, null);
    assert.equal(report.handledAt, null);
    for (const key of ["caseStatus", "riskLevel", "confidence", "aiRecommendation", "modelVersion", "promptVersion"]) {
      assert.equal(Object.hasOwn(report, key), false, key);
    }
  });
});

test("publishes safety report changes through the approved sync event contract", async () => {
  await withServer(async (baseUrl) => {
    const created = await request(baseUrl, "/api/reports", reportInput({ clientRequestID: "sync-root" }));
    const firstSync = await getSync(baseUrl, "u-reporter", "0");
    const firstEvent = firstSync.body.events.find((event) => event.entityID === created.body.report.caseID);
    assert.deepEqual({
      eventType: firstEvent.eventType,
      entityType: firstEvent.entityType,
      entityID: firstEvent.entityID
    }, {
      eventType: "safety.report.updated",
      entityType: "safety_case",
      entityID: created.body.report.caseID
    });

    const supplemented = await request(baseUrl, `/api/reports/${created.body.report.id}/evidence`, {
      clientRequestID: "sync-supplement",
      detail: "Sync event check"
    });
    assert.equal(supplemented.status, 201);
    const secondSync = await getSync(baseUrl, "u-reporter", firstEvent.id);
    assert.deepEqual(secondSync.body.events.map((event) => ({
      eventType: event.eventType,
      entityType: event.entityType,
      entityID: event.entityID
    })), [{
      eventType: "safety.report.updated",
      entityType: "safety_case",
      entityID: created.body.report.caseID
    }]);
  });
});

test("serializes a reporter client request across concurrent supplements to different reports", async () => {
  await withServer(async (baseUrl) => {
    const first = await request(baseUrl, "/api/reports", reportInput({ clientRequestID: "request-report-one" }));
    const second = await request(baseUrl, "/api/reports", reportInput({
      clientRequestID: "request-report-two",
      sourceType: "comment",
      sourceID: "comment-1",
      reasonCode: "harassment_or_abuse"
    }));

    const results = await Promise.all([first, second].map((report) => request(
      baseUrl,
      `/api/reports/${report.body.report.id}/evidence`,
      { clientRequestID: "shared-supplement-request", detail: "One of these may win." }
    )));
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 400]);
    assert.equal(results.filter((result) => result.status === 400)[0].body.error, "请求 ID 已被使用");
    const evidence = await pool.query(
      "SELECT count(*)::int AS count FROM safety_evidence WHERE client_request_id = 'shared-supplement-request'"
    );
    assert.equal(evidence.rows[0].count, 1);
  });
});

test("waits for a locked case transition and never inserts a report into the terminal case", async () => {
  await withServer(async (baseUrl) => {
    const first = await request(baseUrl, "/api/reports", reportInput({ clientRequestID: "transition-root" }));
    const transition = await pool.connect();
    let committed = false;
    try {
      await transition.query("BEGIN");
      await transition.query("SELECT id FROM safety_cases WHERE id = $1 FOR UPDATE", [first.body.report.caseID]);
      let settled = false;
      const intake = request(baseUrl, "/api/reports", reportInput({ clientRequestID: "transition-intake" }))
        .then((response) => {
          settled = true;
          return response;
        });
      await delay(40);
      assert.equal(settled, false);

      await transition.query("UPDATE safety_cases SET status = 'resolved_actioned' WHERE id = $1", [first.body.report.caseID]);
      await transition.query("COMMIT");
      committed = true;

      const result = await intake;
      assert.equal(result.status, 201);
      assert.notEqual(result.body.report.caseID, first.body.report.caseID);
      const oldReport = await pool.query("SELECT status FROM reports WHERE id = $1", [first.body.report.id]);
      assert.equal(oldReport.rows[0].status, "closed");
    } finally {
      if (!committed) await transition.query("ROLLBACK").catch(() => {});
      transition.release();
    }
  });
});

test("accepts one controlled evidence supplement and handles ownership, validation, terminal state, and exact retries", async () => {
  await withServer(async (baseUrl) => {
    const created = await request(baseUrl, "/api/reports", reportInput({ clientRequestID: "evidence-root" }));
    const reportID = created.body.report.id;

    const missingRequest = await request(baseUrl, `/api/reports/${reportID}/evidence`, { detail: "No request ID" });
    assert.equal(missingRequest.status, 400);
    const malformed = await request(baseUrl, `/api/reports/${reportID}/evidence`, {
      clientRequestID: "evidence-too-many",
      objectKeys: Array.from({ length: 7 }, (_, index) => `report/u-reporter/2026-07-10/${index}.png`)
    });
    assert.equal(malformed.status, 400);
    const overlong = await request(baseUrl, `/api/reports/${reportID}/evidence`, {
      clientRequestID: "evidence-overlong",
      detail: "😀".repeat(1001)
    });
    assert.equal(overlong.status, 400);
    const wrongObjectOwner = await request(baseUrl, `/api/reports/${reportID}/evidence`, {
      clientRequestID: "evidence-wrong-owner",
      objectKeys: ["report/u-other/2026-07-10/not-owned.png"]
    });
    assert.equal(wrongObjectOwner.status, 400);
    const extraField = await request(baseUrl, `/api/reports/${reportID}/evidence`, {
      clientRequestID: "evidence-extra-field",
      detail: "Rejected",
      sourceID: "post-1"
    });
    assert.equal(extraField.status, 400);
    const wrongOwner = await request(baseUrl, `/api/reports/${reportID}/evidence`, {
      clientRequestID: "evidence-other-owner",
      detail: "Not allowed"
    }, { userID: "u-reporter-two" });
    assert.equal(wrongOwner.status, 403);

    const supplement = await request(baseUrl, `/api/reports/${reportID}/evidence`, {
      clientRequestID: "evidence-first",
      detail: "A separate supporting detail.",
      objectKeys: ["report/u-reporter/2026-07-10/support.png"]
    });
    assert.equal(supplement.status, 201);
    assert.equal(supplement.body.duplicate, false);
    assert.equal(typeof supplement.body.duplicate, "boolean");
    assert.equal(supplement.body.report.id, reportID);
    await assertCounts({ reports: 1, cases: 1, evidence: 2, jobs: 1, events: 2, syncEvents: 2 });

    const retry = await request(baseUrl, `/api/reports/${reportID}/evidence`, {
      clientRequestID: "evidence-first",
      detail: "Ignored on exact retry."
    });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.duplicate, true);
    await assertCounts({ reports: 1, cases: 1, evidence: 2, jobs: 1, events: 2, syncEvents: 2 });

    await pool.query("UPDATE reports SET status = 'closed' WHERE id = $1", [reportID]);
    await pool.query("UPDATE safety_cases SET status = 'resolved_actioned' WHERE id = $1", [created.body.report.caseID]);
    const terminal = await request(baseUrl, `/api/reports/${reportID}/evidence`, {
      clientRequestID: "evidence-terminal",
      detail: "Too late"
    });
    assert.equal(terminal.status, 409);
  });
});

test("returns duplicate true when submit collides with supplemental evidence for the same report", async () => {
  await withServer(async (baseUrl) => {
    const created = await request(baseUrl, "/api/reports", reportInput({ clientRequestID: "collision-root" }));
    assert.equal(created.status, 201);
    assert.equal(created.body.duplicate, false);
    const evidence = await request(baseUrl, `/api/reports/${created.body.report.id}/evidence`, {
      clientRequestID: "collision-evidence",
      detail: "This request ID belongs to supplemental evidence."
    });
    assert.equal(evidence.status, 201);
    assert.equal(evidence.body.duplicate, false);

    const collision = await request(baseUrl, "/api/reports", reportInput({ clientRequestID: "collision-evidence" }));
    assert.equal(collision.status, 200);
    assert.equal(collision.body.duplicate, true);
    assert.equal(collision.body.report.id, created.body.report.id);
  });
});

test("enforces independent IP, account, and burst limits with the stable API code", async () => {
  const trustProxy = createApp().get("trust proxy fn");
  assert.equal(trustProxy("127.0.0.1"), true);
  assert.equal(trustProxy("::1"), true);
  assert.equal(trustProxy("198.51.100.10"), false);
  await withSafetyConfig({ reportIpMax24h: 1, reportAccountMax24h: 100, reportBurstMaxMinute: 100 }, async () => {
    await withServer(async (baseUrl) => {
      const first = await request(baseUrl, "/api/reports", reportInput({ clientRequestID: "ip-one" }), { ip: "198.51.100.1" });
      const differentForwardedIP = await request(baseUrl, "/api/reports", reportInput({ clientRequestID: "ip-two" }), {
        userID: "u-reporter-two",
        ip: "198.51.100.2"
      });
      const sameForwardedIP = await request(baseUrl, "/api/reports", reportInput({ clientRequestID: "ip-three" }), {
        userID: "u-outsider",
        ip: "198.51.100.1"
      });
      assert.ok(first.status < 300);
      assert.ok(differentForwardedIP.status < 300);
      assert.equal(sameForwardedIP.status, 429);
      assert.equal(sameForwardedIP.body.code, "report_rate_limited");
    });
  });

  await withSafetyConfig({ reportIpMax24h: 100, reportAccountMax24h: 1, reportBurstMaxMinute: 100 }, async () => {
    await withServer(async (baseUrl) => {
      const first = await request(baseUrl, "/api/reports", reportInput({ clientRequestID: "account-one" }), { ip: "198.51.100.3" });
      const second = await request(baseUrl, "/api/reports", reportInput({ clientRequestID: "account-two" }), { ip: "198.51.100.4" });
      assert.ok(first.status < 300);
      assert.equal(second.status, 429);
      assert.equal(second.body.code, "report_rate_limited");
    });
  });

  await withSafetyConfig({ reportIpMax24h: 100, reportAccountMax24h: 100, reportBurstMaxMinute: 1 }, async () => {
    await withServer(async (baseUrl) => {
      const first = await request(baseUrl, "/api/reports", reportInput({ clientRequestID: "burst-one" }), { userID: "u-reporter-two" });
      const second = await request(baseUrl, "/api/reports", reportInput({ clientRequestID: "burst-two" }), { userID: "u-reporter-two" });
      assert.ok(first.status < 300);
      assert.equal(second.status, 429);
      assert.equal(second.body.code, "report_rate_limited");
    });
  });
});

test("keeps the migrated legacy report contract active only when safety intake is disabled", async () => {
  await withSafetyConfig({ enabled: false }, async () => {
    await withServer(async (baseUrl) => {
      const first = await request(baseUrl, "/api/reports", {
        targetType: "post",
        targetID: "post-1",
        reason: "Legacy reason",
        detail: "Legacy detail"
      });
      assert.equal(first.status, 201);
      assert.equal(first.body.report.target_type, "post");
      assert.equal(first.body.report.target_id, "post-1");
      const duplicate = await request(baseUrl, "/api/reports", {
        targetType: "post",
        targetID: "post-1"
      });
      assert.equal(duplicate.status, 200);
      assert.deepEqual(duplicate.body, { ok: true, message: "你已举报过该内容，我们会尽快处理" });
      await assertCounts({ reports: 1, cases: 1, evidence: 0, jobs: 0, events: 0, syncEvents: 0 });
    });
  });
});

test("recovers the disabled legacy route after a case-only terminal transition without an orphan case", async () => {
  await withSafetyConfig({ enabled: false }, async () => {
    await withServer(async (baseUrl) => {
      const first = await request(baseUrl, "/api/reports", {
        targetType: "post",
        targetID: "post-1",
        reason: "Legacy reason",
        detail: "Legacy detail"
      });
      assert.equal(first.status, 201);
      await pool.query("UPDATE safety_cases SET status = 'resolved_no_action' WHERE id = $1", [first.body.report.case_id]);

      const second = await request(baseUrl, "/api/reports", {
        targetType: "post",
        targetID: "post-1",
        reason: "Legacy reason",
        detail: "New legacy report"
      });
      assert.equal(second.status, 201);
      assert.notEqual(second.body.report.case_id, first.body.report.case_id);
      const oldReport = await pool.query("SELECT status FROM reports WHERE id = $1", [first.body.report.id]);
      assert.equal(oldReport.rows[0].status, "closed");
      const openCases = await pool.query(
        `SELECT count(*)::int AS count
         FROM safety_cases
         WHERE subject_type = 'post' AND subject_id = 'post-1' AND category = 'other'
           AND status NOT IN ('resolved_no_action', 'resolved_restored', 'resolved_actioned')`
      );
      assert.equal(openCases.rows[0].count, 1);
      await assertCounts({ reports: 2, cases: 2, evidence: 0, jobs: 0, events: 0, syncEvents: 0 });
    });
  });
});

async function withServer(callback) {
  const server = createApp().listen(0);
  try {
    await onceListening(server);
    const { port } = server.address();
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function request(baseUrl, path, body, { userID = "u-reporter", ip = null } = {}) {
  const headers = {
    authorization: `Bearer ${signToken({ id: userID, email: `${userID}@example.test` })}`,
    "content-type": "application/json"
  };
  if (ip) headers["x-forwarded-for"] = ip;
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function getReports(baseUrl, userID) {
  const response = await fetch(`${baseUrl}/api/me/reports`, {
    headers: { authorization: `Bearer ${signToken({ id: userID, email: `${userID}@example.test` })}` }
  });
  return { status: response.status, body: await response.json() };
}

async function getBootstrap(baseUrl, userID) {
  const response = await fetch(`${baseUrl}/api/bootstrap`, {
    headers: { authorization: `Bearer ${signToken({ id: userID, email: `${userID}@example.test` })}` }
  });
  return { status: response.status, body: await response.json() };
}

async function getSync(baseUrl, userID, cursor) {
  const response = await fetch(`${baseUrl}/api/sync?cursor=${encodeURIComponent(cursor)}`, {
    headers: { authorization: `Bearer ${signToken({ id: userID, email: `${userID}@example.test` })}` }
  });
  return { status: response.status, body: await response.json() };
}

function reportInput(overrides = {}) {
  return {
    clientRequestID: "request-default",
    sourceType: "post",
    sourceID: "post-1",
    reasonCode: "suspected_scam",
    reportedField: "content",
    detail: "The listing needs review.",
    ...overrides
  };
}

async function assertCounts(expected) {
  const actual = {};
  for (const [key, table] of Object.entries({
    reports: "reports",
    cases: "safety_cases",
    evidence: "safety_evidence",
    jobs: "safety_jobs",
    events: "safety_case_events",
    syncEvents: "sync_events"
  })) {
    actual[key] = (await pool.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count;
  }
  assert.deepEqual(actual, expected);
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

function onceListening(server) {
  if (server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function seedReportTargets() {
  await pool.query(
    `INSERT INTO users (id, nickname)
     VALUES
       ('u-owner', 'Owner'),
       ('u-reporter', 'Reporter'),
       ('u-reporter-two', 'Reporter two'),
       ('u-commenter', 'Commenter'),
       ('u-dm-sender', 'DM sender'),
       ('u-outsider', 'Outsider')`
  );
  await pool.query(
    `INSERT INTO group_collections (id, owner_id, name, deadline)
     VALUES ('collection-1', 'u-owner', 'Report collection', now() + interval '1 day')`
  );
  await pool.query(
    `INSERT INTO posts (id, author_id, collection_id, title, deadline)
     VALUES ('post-1', 'u-owner', 'collection-1', 'Report post', now() + interval '1 day')`
  );
  await pool.query(
    `INSERT INTO comments (id, post_id, author_id, body)
     VALUES ('comment-1', 'post-1', 'u-commenter', 'Report comment')`
  );
  await pool.query(
    `INSERT INTO message_threads (id, buyer_user_id, publisher_user_id)
     VALUES ('thread-1', 'u-reporter', 'u-dm-sender')`
  );
  await pool.query(
    `INSERT INTO direct_messages (id, thread_id, sender_id, body)
     VALUES ('message-1', 'thread-1', 'u-dm-sender', 'Report direct message')`
  );
}

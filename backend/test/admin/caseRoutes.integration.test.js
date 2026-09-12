import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../../src/app.js";
import { signToken } from "../../src/auth.js";
import { hashAdminToken } from "../../src/admin/sessionService.js";
import { moderationProvider } from "../../src/moderation/index.js";
import { applySafetyAction } from "../../src/safety/actionService.js";
import { closeDatabase, pool, resetDatabase } from "../helpers/database.js";

const sessionToken = "A".repeat(43);
const csrfToken = "B".repeat(43);
const adminCookies = new Map([
  ["zbt_admin_session", sessionToken],
  ["zbt_admin_csrf", csrfToken]
]);

process.env.ADMIN_RECOVERY_PEPPER = "test-admin-case-pepper-with-32-plus-characters";

test.beforeEach(async () => {
  await resetDatabase();
  await seedCaseFixture();
});

test.after(closeDatabase);

test("protects, lists, redacts, audits, and version-checks admin safety cases", async () => {
  await withServer(async (baseUrl) => {
    const unauthenticated = await request(baseUrl, "/admin/api/cases");
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.body.code, "admin_auth_required");

    const appJWT = signToken({ id: "u-owner", email: "owner@example.test" });
    const consumerToken = await request(baseUrl, "/admin/api/cases", { bearer: appJWT });
    assert.equal(consumerToken.status, 401);
    assert.equal(consumerToken.body.code, "admin_auth_required");

    const queue = await request(
      baseUrl,
      "/admin/api/cases?status=manual_review&subjectType=post&riskLevel=urgent&sort=oldest&limit=10",
      { cookies: adminCookies }
    );
    assert.equal(queue.status, 200);
    assert.deepEqual(queue.body.cases.map((item) => item.id), ["case-post"]);
    assert.deepEqual(queue.body.cases[0], {
      id: "case-post",
      subjectType: "post",
      subjectID: "post-case-target",
      subjectTitle: "需要审核的帖子",
      category: "harassment_or_abuse",
      impactScope: "post",
      status: "manual_review",
      riskLevel: "urgent",
      reportCount: 2,
      independentReporterCount: 2,
      correctionDueAt: null,
      manualHold: false,
      version: queue.body.cases[0].updatedAt,
      updatedAt: queue.body.cases[0].updatedAt
    });
    assert.deepEqual(queue.body.counts, {
      manual_review: 2,
      auto_action: 0,
      awaiting_correction: 0,
      appealed: 0,
      ai_failed: 0,
      overdue: 0
    });
    assert.equal(queue.body.nextCursor, null);

    const firstPage = await request(baseUrl, "/admin/api/cases?sort=oldest&limit=1", {
      cookies: adminCookies
    });
    assert.equal(firstPage.status, 200);
    assert.equal(firstPage.body.cases[0].id, "case-post");
    assert.ok(firstPage.body.nextCursor);
    const secondPage = await request(
      baseUrl,
      `/admin/api/cases?sort=oldest&limit=1&cursor=${encodeURIComponent(firstPage.body.nextCursor)}`,
      { cookies: adminCookies }
    );
    assert.equal(secondPage.status, 200);
    assert.equal(secondPage.body.cases[0].id, "case-message");
    assert.equal(secondPage.body.nextCursor, null);

    const detail = await request(baseUrl, "/admin/api/cases/case-post", {
      cookies: adminCookies
    });
    assert.equal(detail.status, 200);
    assert.deepEqual(
      detail.body.case.reports.map((report) => report.reporterLabel),
      ["举报人 1", "举报人 2"]
    );
    assert.equal(JSON.stringify(detail.body).includes("u-reporter"), false);
    assert.equal(detail.body.case.subjectOwnerID, "u-owner");
    assert.equal(detail.body.case.reports[0].hasDetail, true);
    assert.equal(JSON.stringify(detail.body).includes("合成举报说明"), false);
    assert.equal(JSON.stringify(detail.body).includes("另一条合成说明"), false);
    assert.equal(detail.body.case.evidence[0].id, "evidence-post");
    assert.equal(detail.body.case.evidence[0].hasText, true);
    assert.equal(detail.body.case.evidence[0].objectCount, 1);
    assertNoKeys(detail.body.case.evidence[0], [
      "textSnapshot",
      "structuredSnapshot",
      "objectKeys"
    ]);
    assert.equal(JSON.stringify(detail.body).includes("私密证据原文"), false);
    assert.equal(detail.body.case.revisions[0].snapshot.title, "整改后的帖子标题");
    assert.deepEqual(detail.body.case.revisions[0].snapshot.imageURLs, [
      "/admin/api/assets/post/u-owner/revised.png"
    ]);
    assert.equal(detail.body.case.revisions[0].objectCount, 1);
    assertNoKeys(detail.body.case.revisions[0], ["objectKey", "report/u-owner/revision.png"]);

    const repeat = await request(baseUrl, "/admin/api/cases/case-post", {
      cookies: adminCookies
    });
    assert.deepEqual(
      repeat.body.case.reports.map((report) => report.reporterLabel),
      detail.body.case.reports.map((report) => report.reporterLabel)
    );

    const reveal = await request(
      baseUrl,
      "/admin/api/cases/case-post/evidence/evidence-post?reason=%E5%A4%8D%E6%A0%B8%E4%B8%BE%E6%8A%A5%E4%BE%9D%E6%8D%AE",
      { cookies: adminCookies }
    );
    assert.equal(reveal.status, 200);
    assert.equal(reveal.body.evidence.textSnapshot, "私密证据原文");
    assert.deepEqual(reveal.body.evidence.structuredSnapshot, {
      report: { detail: "合成举报说明" },
      id: "post-case-target",
      title: "需要审核的帖子"
    });
    assert.deepEqual(reveal.body.evidence.objectURLs, [
      "/admin/api/cases/case-post/evidence/evidence-post/objects/0"
    ]);
    assertNoKeys(reveal.body.evidence, ["objectKeys"]);
    assert.equal(JSON.stringify(reveal.body).includes("u-owner"), false);
    assert.equal(JSON.stringify(reveal.body).includes("report/u-reporter-a/evidence.png"), false);

    const objectWithoutReason = await request(
      baseUrl,
      "/admin/api/cases/case-post/evidence/evidence-post/objects/0",
      { cookies: adminCookies }
    );
    assert.equal(objectWithoutReason.status, 400);
    assert.equal(objectWithoutReason.body.code, "admin_request_invalid");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith("http://127.0.0.1:")) return originalFetch(input, init);
      assert.match(url, /^https:\/\//u);
      assert.equal(init?.redirect, "error");
      return new Response(Uint8Array.from([137, 80, 78, 71]), {
        status: 200,
        headers: { "content-type": "image/png" }
      });
    };
    try {
      const object = await originalFetch(
        `${baseUrl}/admin/api/cases/case-post/evidence/evidence-post/objects/0`,
        { headers: adminRequestHeaders({
          cookies: adminCookies,
          evidenceReason: "review image evidence"
        }) }
      );
      assert.equal(object.status, 200);
      assert.equal(object.headers.get("content-type"), "image/png");
      assert.equal(object.headers.get("cache-control"), "no-store");
      assert.equal(object.headers.get("x-content-type-options"), "nosniff");
      assert.deepEqual([...new Uint8Array(await object.arrayBuffer())], [137, 80, 78, 71]);
    } finally {
      globalThis.fetch = originalFetch;
    }

    const audit = await pool.query(
      `SELECT event_type, subject_type, subject_id, event_data
       FROM admin_audit_events
       WHERE event_type = 'safety.evidence_viewed'
       ORDER BY id DESC LIMIT 1`
    );
    assert.deepEqual(audit.rows[0], {
      event_type: "safety.evidence_viewed",
      subject_type: "evidence",
      subject_id: "evidence-post",
      event_data: {
        accessReason: "复核举报依据",
        caseId: "case-post"
      }
    });
    const objectAudit = await pool.query(
      `SELECT event_type, subject_type, subject_id, event_data
       FROM admin_audit_events
       WHERE event_type = 'safety.evidence_object_viewed'
       ORDER BY id DESC LIMIT 1`
    );
    assert.deepEqual(objectAudit.rows[0], {
      event_type: "safety.evidence_object_viewed",
      subject_type: "evidence",
      subject_id: "evidence-post",
      event_data: {
        accessReason: "review image evidence",
        caseId: "case-post",
        objectIndex: 0
      }
    });
    const auditList = await request(
      baseUrl,
      "/admin/api/audit-events?eventType=safety.evidence_viewed&limit=10",
      { cookies: adminCookies }
    );
    assert.equal(auditList.status, 200);
    assert.equal(auditList.body.events.length, 1);
    assert.deepEqual(auditList.body.events[0], {
      id: auditList.body.events[0].id,
      adminUsername: "CaseReviewer",
      deviceName: "Case Review Browser",
      eventType: "safety.evidence_viewed",
      subjectType: "evidence",
      subjectID: "evidence-post",
      userAgentSummary: "Other / Other",
      data: {
        accessReason: "复核举报依据",
        caseId: "case-post"
      },
      createdAt: auditList.body.events[0].createdAt
    });
    assert.equal(auditList.body.nextCursor, null);
    assert.equal(JSON.stringify(auditList.body).includes("ip_hash"), false);

    const directMessage = await request(
      baseUrl,
      "/admin/api/cases/case-message/evidence/evidence-message?reason=%E5%A4%8D%E6%A0%B8%E7%A7%81%E4%BF%A1%E4%B8%8A%E4%B8%8B%E6%96%87",
      { cookies: adminCookies }
    );
    assert.equal(directMessage.status, 200);
    assert.equal(directMessage.body.evidence.structuredSnapshot.messages.length, 7);
    assert.deepEqual(
      directMessage.body.evidence.structuredSnapshot.messages.map((message) => message.id),
      ["m-1", "m-2", "m-3", "m-4", "m-5", "m-6", "m-7"]
    );
    assert.deepEqual(
      directMessage.body.evidence.structuredSnapshot.messages.map((message) => message.senderLabel),
      ["举报人 1", "对话参与者 1", "举报人 1", "对话参与者 1", "举报人 1", "对话参与者 1", "举报人 1"]
    );
    assert.equal(
      directMessage.body.evidence.structuredSnapshot.messages[3].imageURL,
      "/admin/api/cases/case-message/evidence/evidence-message/objects/0"
    );
    assert.equal(directMessage.body.evidence.structuredSnapshot.messages[3].hasSharedProfile, true);
    assertNoKeys(directMessage.body.evidence, [
      "senderId", "imageObjectKey", "sharedProfileUserId",
      "u-reporter-a", "u-owner", "message/u-owner/evidence.png"
    ]);

    const staleDecision = await request(baseUrl, "/admin/api/cases/case-post/decision", {
      method: "POST",
      cookies: adminCookies,
      csrf: csrfToken,
      body: {
        decision: "no_action",
        reason: "证据不足，不采取处置",
        expectedVersion: "2000-01-01T00:00:00.000Z"
      }
    });
    assert.equal(staleDecision.status, 409);
    assert.equal(staleDecision.body.code, "case_changed");

    const pathWins = await request(baseUrl, "/admin/api/cases/case-post/decision", {
      method: "POST",
      cookies: adminCookies,
      csrf: csrfToken,
      body: {
        caseId: "case-message",
        decision: "no_action",
        reason: "路径中的案件标识必须覆盖请求体",
        expectedVersion: detail.body.case.version
      }
    });
    assert.equal(pathWins.status, 200);
    assert.equal(pathWins.body.case.id, "case-post");
    const pathStates = await pool.query(
      "SELECT id, status FROM safety_cases WHERE id = ANY($1::text[]) ORDER BY id",
      [["case-post", "case-message"]]
    );
    assert.deepEqual(pathStates.rows, [
      { id: "case-message", status: "manual_review" },
      { id: "case-post", status: "resolved_no_action" }
    ]);
  });
});

test("marks one report invalid with CSRF, reason, confirmation, and counting status", async () => {
  await withServer(async (baseUrl) => {
    const detail = await request(baseUrl, "/admin/api/cases/case-post", {
      cookies: adminCookies
    });
    assert.equal(detail.body.case.reports.every((report) => report.countsTowardThreshold), true);
    assert.equal(detail.body.case.reports.every((report) => report.countingReason === "counted"), true);
    assert.equal(detail.body.case.reports.every((report) => report.invalidReason === null), true);

    const withoutCSRF = await request(
      baseUrl,
      "/admin/api/cases/case-post/reports/report-a/invalidate",
      {
        method: "POST",
        cookies: adminCookies,
        body: {
          reason: "malicious",
          confirmed: true,
          expectedVersion: detail.body.case.version
        }
      }
    );
    assert.equal(withoutCSRF.status, 403);

    const invalidReason = await request(
      baseUrl,
      "/admin/api/cases/case-post/reports/report-a/invalidate",
      {
        method: "POST",
        cookies: adminCookies,
        csrf: csrfToken,
        body: {
          reason: "unsupported",
          confirmed: true,
          expectedVersion: detail.body.case.version
        }
      }
    );
    assert.equal(invalidReason.status, 400);
    assert.equal(invalidReason.body.code, "admin_report_invalid_reason");

    const withoutConfirmation = await request(
      baseUrl,
      "/admin/api/cases/case-post/reports/report-a/invalidate",
      {
        method: "POST",
        cookies: adminCookies,
        csrf: csrfToken,
        body: {
          reason: "malicious",
          confirmed: false,
          expectedVersion: detail.body.case.version
        }
      }
    );
    assert.equal(withoutConfirmation.status, 400);
    assert.equal(withoutConfirmation.body.code, "admin_report_confirmation_required");

    const invalidated = await request(
      baseUrl,
      "/admin/api/cases/case-post/reports/report-a/invalidate",
      {
        method: "POST",
        cookies: adminCookies,
        csrf: csrfToken,
        body: {
          reason: "malicious",
          confirmed: true,
          expectedVersion: detail.body.case.version
        }
      }
    );
    assert.equal(invalidated.status, 200);
    assert.equal(invalidated.body.case.reportCount, 2);
    assert.equal(invalidated.body.case.independentReporterCount, 1);
    assert.equal(invalidated.body.case.reports.length, 2);
    const reportA = invalidated.body.case.reports.find((report) => report.id === "report-a");
    const reportB = invalidated.body.case.reports.find((report) => report.id === "report-b");
    assert.deepEqual({
      status: reportA.status,
      countsTowardThreshold: reportA.countsTowardThreshold,
      countingReason: reportA.countingReason,
      invalidReason: reportA.invalidReason
    }, {
      status: "invalid",
      countsTowardThreshold: false,
      countingReason: "invalid",
      invalidReason: "malicious"
    });
    assert.equal(reportB.countsTowardThreshold, true);
    assert.equal((await pool.query(
      "SELECT count(*)::int AS count FROM safety_evidence WHERE report_id = 'report-a'"
    )).rows[0].count, 1);
    assert.equal((await pool.query(
      "SELECT count(*)::int AS count FROM safety_case_events WHERE event_type = 'report_marked_invalid'"
    )).rows[0].count, 1);
    assert.equal((await pool.query(
      "SELECT count(*)::int AS count FROM admin_audit_events WHERE event_type = 'safety.report_invalidated'"
    )).rows[0].count, 1);
  });
});

test("applies and restores a human hide, and enforces manual user restrictions", async () => {
  await withServer(async (baseUrl) => {
    const detail = await request(baseUrl, "/admin/api/cases/case-post", {
      cookies: adminCookies
    });
    const hidden = await request(baseUrl, "/admin/api/cases/case-post/decision", {
      method: "POST",
      cookies: adminCookies,
      csrf: csrfToken,
      body: {
        decision: "temporary_hide",
        reason: "人工复核确认需要暂时隐藏",
        expectedVersion: detail.body.case.version
      }
    });
    assert.equal(hidden.status, 200);
    assert.equal(hidden.body.case.status, "resolved_actioned");
    assert.equal(hidden.body.case.manualHold, true);
    const hiddenState = await pool.query(
      `SELECT post.safety_status, safety_case.status, safety_case.manual_hold,
              action.action_type, action.actor_type, report.status AS report_status
       FROM posts post
       JOIN safety_cases safety_case ON safety_case.id = 'case-post'
       JOIN safety_actions action ON action.case_id = safety_case.id
       JOIN reports report ON report.id = 'report-a'
       WHERE post.id = 'post-case-target'
       ORDER BY action.created_at DESC LIMIT 1`
    );
    assert.deepEqual(hiddenState.rows[0], {
      safety_status: "hidden",
      status: "resolved_actioned",
      manual_hold: true,
      action_type: "hide_post",
      actor_type: "admin",
      report_status: "closed"
    });
    await assert.rejects(
      testTransaction((client) => applySafetyAction(client, {
        caseId: "case-post",
        idempotencyKey: "automatic-after-manual-hold",
        actionType: "hide_post",
        targetType: "post",
        targetId: "post-case-target",
        actorType: "system",
        reason: "不应覆盖人工处置"
      })),
      (error) => error?.status === 409 && error?.apiCode === "manual_hold"
    );
    const automaticActions = await pool.query(
      "SELECT count(*)::int AS count FROM safety_actions WHERE idempotency_key = 'automatic-after-manual-hold'"
    );
    assert.equal(automaticActions.rows[0].count, 0);

    const restored = await request(baseUrl, "/admin/api/cases/case-post/decision", {
      method: "POST",
      cookies: adminCookies,
      csrf: csrfToken,
      body: {
        decision: "restore",
        reason: "人工复核后恢复公开",
        expectedVersion: hidden.body.case.version
      }
    });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.case.status, "resolved_restored");
    assert.equal(restored.body.case.manualHold, false);
    const restoredPost = await pool.query(
      "SELECT safety_status FROM posts WHERE id = 'post-case-target'"
    );
    assert.equal(restoredPost.rows[0].safety_status, "active");

    const restricted = await request(baseUrl, "/admin/api/cases/case-post/restrict-user", {
      method: "POST",
      cookies: adminCookies,
      csrf: csrfToken,
      body: {
        userID: "u-owner",
        restricted: true,
        reason: "人工确认需要限制账号操作",
        expectedVersion: restored.body.case.version
      }
    });
    assert.equal(restricted.status, 200);
    assert.equal(restricted.body.case.manualHold, true);
    const restrictedUser = await pool.query(
      "SELECT is_restricted, can_show_contact FROM users WHERE id = 'u-owner'"
    );
    assert.deepEqual(restrictedUser.rows[0], {
      is_restricted: true,
      can_show_contact: false
    });

    const appJWT = signToken({ id: "u-owner", email: "owner@example.test" });
    const blockedWrites = [
      ["/api/collections", { id: "col-restricted", name: "受限合集", wechat: "synthetic-contact" }],
      ["/api/posts", { id: "p-restricted", title: "受限帖子" }],
      ["/api/posts/post-case-target/comments", { body: "受限评论" }],
      ["/api/messages/threads/t-restricted/messages", {
        recipientUserID: "u-target",
        messageID: "m-restricted",
        body: "受限私信"
      }]
    ];
    for (const [path, body] of blockedWrites) {
      const blocked = await request(baseUrl, path, {
        method: "POST",
        bearer: appJWT,
        body
      });
      assert.equal(blocked.status, 403, path);
      assert.equal(blocked.body.code, "user_restricted", path);
    }
    const reportStillAvailable = await request(baseUrl, "/api/reports", {
      method: "POST",
      bearer: appJWT,
      body: {
        clientRequestID: "restricted-user-report",
        sourceType: "user",
        sourceID: "u-target",
        reasonCode: "suspected_scam",
        reportedField: "content",
        detail: "受限账号仍可提交合成举报"
      }
    });
    assert.equal(reportStillAvailable.status, 201);
    for (const path of [
      "/api/content-actions/case-post/revisions",
      "/api/content-actions/case-post/appeal"
    ]) {
      const ownerAction = await request(baseUrl, path, {
        method: "POST",
        bearer: appJWT,
        body: {}
      });
      assert.notEqual(ownerAction.body?.code, "user_restricted", path);
    }
    const followBlocked = await request(baseUrl, "/api/users/u-target/follow", {
      method: "POST",
      bearer: appJWT
    });
    assert.equal(followBlocked.status, 403);
    assert.equal(followBlocked.body.code, "user_restricted");
    const browseStillAvailable = await request(baseUrl, "/api/feed", { bearer: appJWT });
    assert.equal(browseStillAvailable.status, 200);
    const blockStillAvailable = await request(baseUrl, "/api/users/u-target/block", {
      method: "POST",
      bearer: appJWT
    });
    assert.equal(blockStillAvailable.status, 204);

    const unrestricted = await request(baseUrl, "/admin/api/cases/case-post/restrict-user", {
      method: "POST",
      cookies: adminCookies,
      csrf: csrfToken,
      body: {
        userID: "u-owner",
        restricted: false,
        reason: "人工复核后解除账号限制",
        expectedVersion: restricted.body.case.version
      }
    });
    assert.equal(unrestricted.status, 200);
    const unblock = await request(baseUrl, "/api/users/u-target/block", {
      method: "DELETE",
      bearer: appJWT
    });
    assert.equal(unblock.status, 204);
    const followAllowed = await request(baseUrl, "/api/users/u-target/follow", {
      method: "POST",
      bearer: appJWT
    });
    assert.equal(followAllowed.status, 204);
  });
});

test("requests correction, permanently removes without deletion, and closes no-action cases", async () => {
  await withServer(async (baseUrl) => {
    const messageDetail = await request(baseUrl, "/admin/api/cases/case-message", {
      cookies: adminCookies
    });
    const noAction = await request(baseUrl, "/admin/api/cases/case-message/decision", {
      method: "POST",
      cookies: adminCookies,
      csrf: csrfToken,
      body: {
        decision: "no_action",
        reason: "私信上下文不足以确认违规",
        expectedVersion: messageDetail.body.case.version
      }
    });
    assert.equal(noAction.status, 200);
    assert.equal(noAction.body.case.status, "resolved_no_action");
    const closedMessageReport = await pool.query(
      "SELECT status FROM reports WHERE id = 'report-message'"
    );
    assert.equal(closedMessageReport.rows[0].status, "closed");

    const detail = await request(baseUrl, "/admin/api/cases/case-post", {
      cookies: adminCookies
    });
    const correction = await request(baseUrl, "/admin/api/cases/case-post/decision", {
      method: "POST",
      cookies: adminCookies,
      csrf: csrfToken,
      body: {
        decision: "request_correction",
        reason: "请在 24 小时内修改攻击性表述",
        expectedVersion: detail.body.case.version
      }
    });
    assert.equal(correction.status, 200);
    assert.equal(correction.body.case.status, "awaiting_correction");
    assert.equal(correction.body.case.manualHold, true);
    const correctionState = await pool.query(
      `SELECT action_type, actor_type,
              correction_due_at > now() + interval '23 hours' AS due_after_23h,
              correction_due_at <= now() + interval '24 hours 1 minute' AS due_within_24h,
              (SELECT status FROM reports WHERE id = 'report-a') AS report_status
       FROM safety_actions action
       JOIN safety_cases safety_case ON safety_case.id = action.case_id
       WHERE action.case_id = 'case-post'
       ORDER BY action.created_at DESC LIMIT 1`
    );
    assert.deepEqual(correctionState.rows[0], {
      action_type: "request_correction",
      actor_type: "admin",
      due_after_23h: true,
      due_within_24h: true,
      report_status: "pending"
    });

    const removed = await request(baseUrl, "/admin/api/cases/case-post/decision", {
      method: "POST",
      cookies: adminCookies,
      csrf: csrfToken,
      body: {
        decision: "permanent_remove",
        reason: "整改前复核确认内容严重违规",
        expectedVersion: correction.body.case.version
      }
    });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.case.status, "resolved_actioned");
    const removedPost = await pool.query(
      "SELECT safety_status, status FROM posts WHERE id = 'post-case-target'"
    );
    assert.deepEqual(removedPost.rows[0], {
      safety_status: "removed",
      status: "active"
    });
    const permanentAction = await pool.query(
      `SELECT action_type, execution_status
       FROM safety_actions
       WHERE case_id = 'case-post' AND action_type = 'permanent_remove'`
    );
    assert.deepEqual(permanentAction.rows[0], {
      action_type: "permanent_remove",
      execution_status: "applied"
    });

    const restored = await request(baseUrl, "/admin/api/cases/case-post/decision", {
      method: "POST",
      cookies: adminCookies,
      csrf: csrfToken,
      body: {
        decision: "restore",
        reason: "人工复核后撤销永久移除",
        expectedVersion: removed.body.case.version
      }
    });
    assert.equal(restored.status, 200);
    const restoredPost = await pool.query(
      "SELECT safety_status, status FROM posts WHERE id = 'post-case-target'"
    );
    assert.deepEqual(restoredPost.rows[0], {
      safety_status: "active",
      status: "active"
    });
    assert.equal(restored.body.case.status, "resolved_restored");
  });
});

test("publishes an approved revision and handles both appeal outcomes", async () => {
  await withServer(async (baseUrl) => {
    const detail = await request(baseUrl, "/admin/api/cases/case-post", {
      cookies: adminCookies
    });
    const approved = await request(baseUrl, "/admin/api/cases/case-post/decision", {
      method: "POST",
      cookies: adminCookies,
      csrf: csrfToken,
      body: {
        decision: "approve_revision",
        reason: "人工确认整改版本可以发布",
        expectedVersion: detail.body.case.version
      }
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.case.status, "resolved_restored");
    const published = await pool.query(
      `SELECT revision.status, post.title
       FROM content_revisions revision
       JOIN posts post ON post.id = revision.target_id
       WHERE revision.id = 'revision-admin-approved'`
    );
    assert.deepEqual(published.rows[0], {
      status: "published",
      title: "整改后的帖子标题"
    });

    const hidden = await request(baseUrl, "/admin/api/cases/case-post/decision", {
      method: "POST",
      cookies: adminCookies,
      csrf: csrfToken,
      body: {
        decision: "temporary_hide",
        reason: "复核新证据后暂时隐藏",
        expectedVersion: approved.body.case.version
      }
    });
    assert.equal(hidden.status, 200);
    const firstDecision = await pool.query(
      `SELECT id FROM safety_actions
       WHERE case_id = 'case-post' AND action_type = 'hide_post'
       ORDER BY created_at DESC LIMIT 1`
    );
    await pool.query(
      `INSERT INTO safety_appeals (
         id, case_id, decision_action_id, owner_id, detail
       ) VALUES ('appeal-uphold', 'case-post', $1, 'u-owner', '请求重新复核')`,
      [firstDecision.rows[0].id]
    );
    await pool.query(
      "UPDATE safety_cases SET status = 'appealed', updated_at = now() WHERE id = 'case-post'"
    );
    const appealedVersion = await caseVersion(baseUrl, "case-post");
    const bypassAppeal = await request(baseUrl, "/admin/api/cases/case-post/decision", {
      method: "POST",
      cookies: adminCookies,
      csrf: csrfToken,
      body: {
        decision: "no_action",
        reason: "不应绕过待处理申诉",
        expectedVersion: appealedVersion
      }
    });
    assert.equal(bypassAppeal.status, 409);
    assert.equal(bypassAppeal.body.code, "admin_appeal_decision_required");
    const upheld = await request(baseUrl, "/admin/api/cases/case-post/decision", {
      method: "POST",
      cookies: adminCookies,
      csrf: csrfToken,
      body: {
        decision: "uphold_appeal",
        reason: "申诉未能推翻原处置依据",
        expectedVersion: appealedVersion
      }
    });
    assert.equal(upheld.status, 200);
    assert.equal(upheld.body.case.status, "resolved_actioned");
    assert.equal(upheld.body.case.appeal.status, "upheld");
    assert.equal(upheld.body.case.appeal.hasDetail, true);
    assert.equal(JSON.stringify(upheld.body).includes("请求重新复核"), false);
    const stillHidden = await pool.query(
      "SELECT safety_status FROM posts WHERE id = 'post-case-target'"
    );
    assert.equal(stillHidden.rows[0].safety_status, "hidden");

    const hiddenAgain = await request(baseUrl, "/admin/api/cases/case-post/decision", {
      method: "POST",
      cookies: adminCookies,
      csrf: csrfToken,
      body: {
        decision: "temporary_hide",
        reason: "建立新的可申诉人工处置",
        expectedVersion: upheld.body.case.version
      }
    });
    assert.equal(hiddenAgain.status, 200);
    const secondDecision = await pool.query(
      `SELECT id FROM safety_actions
       WHERE case_id = 'case-post' AND action_type = 'hide_post'
       ORDER BY created_at DESC LIMIT 1`
    );
    assert.notEqual(secondDecision.rows[0].id, firstDecision.rows[0].id);
    await pool.query(
      `INSERT INTO safety_appeals (
         id, case_id, decision_action_id, owner_id, detail
       ) VALUES ('appeal-overturn', 'case-post', $1, 'u-owner', '补充证据请求复核')`,
      [secondDecision.rows[0].id]
    );
    await pool.query(
      "UPDATE safety_cases SET status = 'appealed', updated_at = now() WHERE id = 'case-post'"
    );
    const secondAppealedVersion = await caseVersion(baseUrl, "case-post");
    const overturned = await request(baseUrl, "/admin/api/cases/case-post/decision", {
      method: "POST",
      cookies: adminCookies,
      csrf: csrfToken,
      body: {
        decision: "overturn_appeal",
        reason: "补充证据足以推翻原处置",
        expectedVersion: secondAppealedVersion
      }
    });
    assert.equal(overturned.status, 200);
    assert.equal(overturned.body.case.status, "resolved_actioned");
    assert.equal(overturned.body.case.appeal.status, "overturned");
    assert.equal(overturned.body.case.appeal.hasDetail, true);
    assert.equal(JSON.stringify(overturned.body).includes("补充证据请求复核"), false);
    const priorDecisionStillApplies = await pool.query(
      "SELECT safety_status FROM posts WHERE id = 'post-case-target'"
    );
    assert.equal(priorDecisionStillApplies.rows[0].safety_status, "hidden");
    const actionStates = await pool.query(
      `SELECT id, execution_status FROM safety_actions
       WHERE id = ANY($1::text[])
       ORDER BY id`,
      [[firstDecision.rows[0].id, secondDecision.rows[0].id]]
    );
    assert.deepEqual(
      Object.fromEntries(actionStates.rows.map((action) => [action.id, action.execution_status])),
      {
        [firstDecision.rows[0].id]: "applied",
        [secondDecision.rows[0].id]: "rolled_back"
      }
    );
  });
});

test("keeps reports open when an overturned appeal returns to an earlier correction", async () => {
  await withServer(async (baseUrl) => {
    const initialVersion = await caseVersion(baseUrl, "case-post");
    const correction = await request(baseUrl, "/admin/api/cases/case-post/decision", {
      method: "POST",
      cookies: adminCookies,
      csrf: csrfToken,
      body: {
        decision: "request_correction",
        reason: "先保留一项仍需完成的整改",
        expectedVersion: initialVersion
      }
    });
    assert.equal(correction.status, 200);
    const hidden = await request(baseUrl, "/admin/api/cases/case-post/decision", {
      method: "POST",
      cookies: adminCookies,
      csrf: csrfToken,
      body: {
        decision: "temporary_hide",
        reason: "后续临时隐藏将被申诉推翻",
        expectedVersion: correction.body.case.version
      }
    });
    assert.equal(hidden.status, 200);
    const hideAction = hidden.body.case.actions.find((action) => action.type === "hide_post");
    assert.ok(hideAction);
    await pool.query(
      `INSERT INTO safety_appeals (id, case_id, decision_action_id, owner_id, detail)
       VALUES ('appeal-return-to-correction', 'case-post', $1, 'u-owner', '补充材料足以撤销隐藏')`,
      [hideAction.id]
    );
    await pool.query(
      `UPDATE safety_cases SET status = 'appealed', updated_at = now() WHERE id = 'case-post';
       UPDATE reports SET status = 'pending', handled_at = NULL, updated_at = now()
       WHERE id = 'report-a'`
    );
    const appealedVersion = await caseVersion(baseUrl, "case-post");
    const overturned = await request(baseUrl, "/admin/api/cases/case-post/decision", {
      method: "POST",
      cookies: adminCookies,
      csrf: csrfToken,
      body: {
        decision: "overturn_appeal",
        reason: "撤销较新的隐藏但继续要求整改",
        expectedVersion: appealedVersion
      }
    });
    assert.equal(overturned.status, 200);
    assert.equal(overturned.body.case.status, "awaiting_correction");
    assert.equal(overturned.body.case.manualHold, true);
    const report = await pool.query("SELECT status FROM reports WHERE id = 'report-a'");
    assert.equal(report.rows[0].status, "pending");
  });
});

test("fails evidence proxy requests safely for upstream errors, timeouts, and interrupted streams", async () => {
  let mode = "missing";
  const app = createApp({
    adminWebEnabled: true,
    adminCaseRouterOptions: {
      evidenceTimeoutMs: 25,
      signObjectURL: () => "https://evidence.invalid/object",
      fetchObject: async (_url, { signal }) => {
        if (mode === "missing") return new Response("missing", { status: 404 });
        if (mode === "timeout") {
          return new Promise((resolve, reject) => {
            signal.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            }, { once: true });
          });
        }
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(Uint8Array.from([137, 80]));
            queueMicrotask(() => controller.error(new Error("upstream interrupted")));
          }
        }), {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
    }
  });
  await withServer(async (baseUrl) => {
    const path = "/admin/api/cases/case-post/evidence/evidence-post/objects/0";
    const headers = adminRequestHeaders({
      cookies: adminCookies,
      evidenceReason: "failure path verification"
    });
    const missing = await request(baseUrl, path, {
      cookies: adminCookies,
      evidenceReason: "failure path verification"
    });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, "admin_evidence_object_not_found");

    mode = "timeout";
    const timeout = await request(baseUrl, path, {
      cookies: adminCookies,
      evidenceReason: "failure path verification"
    });
    assert.equal(timeout.status, 504);
    assert.equal(timeout.body.code, "admin_evidence_timeout");

    mode = "stream";
    await assert.rejects(async () => {
      const response = await fetch(`${baseUrl}${path}`, { headers });
      await response.arrayBuffer();
    });
    const healthy = await request(baseUrl, "/admin/api/cases", { cookies: adminCookies });
    assert.equal(healthy.status, 200);
  }, app);
});

test("keeps a committed admin decision successful when realtime notification fails", async () => {
  const logged = [];
  const app = createApp({
    adminWebEnabled: true,
    adminCaseRouterOptions: {
      notifyEvents: async () => { throw new Error("synthetic notifier failure"); },
      eventLogger: { error: async (event, fields) => logged.push({ event, fields }) }
    }
  });
  await withServer(async (baseUrl) => {
    const version = await caseVersion(baseUrl, "case-post");
    const response = await request(baseUrl, "/admin/api/cases/case-post/decision", {
      method: "POST",
      cookies: adminCookies,
      csrf: csrfToken,
      body: {
        decision: "temporary_hide",
        reason: "验证提交后通知失败不改变成功响应",
        expectedVersion: version
      }
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.case.status, "resolved_actioned");
    assert.equal(logged.length, 1);
    assert.equal(logged[0].event, "admin_case_routes.sync_notify_failed");
    assert.equal(logged[0].fields.errorCode, "ADMIN_CASE_SYNC_NOTIFY_FAILED");
    assert.ok(logged[0].fields.eventCount > 0);
  }, app);
});

test("rechecks account restriction in the final content-write transaction", async () => {
  const provider = moderationProvider();
  const originalReviewText = provider.reviewText;
  let markModerationStarted;
  let releaseModeration;
  const moderationStarted = new Promise((resolve) => { markModerationStarted = resolve; });
  const moderationGate = new Promise((resolve) => { releaseModeration = resolve; });
  provider.reviewText = async function reviewTextWithGate(input) {
    markModerationStarted();
    await moderationGate;
    return originalReviewText.call(this, input);
  };
  let pendingPost;
  try {
    await withServer(async (baseUrl) => {
      await pool.query("INSERT INTO group_collections(id,owner_id,name,deadline) VALUES('collection-main','u-owner','Race fixture',now()+interval '1 day')");
      await pool.query("INSERT INTO upload_tickets(token_hash,object_key,user_id,kind,content_type,status) VALUES('race-ticket','guarded/post/u-owner/race.jpg','u-owner','post','image/jpeg','ready')");
      const appJWT = signToken({ id: "u-owner", email: "owner@example.test" });
      pendingPost = request(baseUrl, "/api/posts", {
        method: "POST",
        bearer: appJWT,
        body: { id: "p-restriction-race", title: "并发限制竞态验证", collectionID: "collection-main", imageObjectKeys: ["guarded/post/u-owner/race.jpg"] }
      });
      await Promise.race([moderationStarted, pendingPost.then(result => { throw new Error("Post rejected before moderation: " + JSON.stringify(result)); })]);
      const version = await caseVersion(baseUrl, "case-post");
      const restricted = await request(baseUrl, "/admin/api/cases/case-post/restrict-user", {
        method: "POST",
        cookies: adminCookies,
        csrf: csrfToken,
        body: {
          userID: "u-owner",
          restricted: true,
          reason: "在外部审核等待期间限制账号",
          expectedVersion: version
        }
      });
      assert.equal(restricted.status, 200);
      releaseModeration();
      const postResult = await pendingPost;
      assert.equal(postResult.status, 403);
      assert.equal(postResult.body.code, "user_restricted");
      const persisted = await pool.query(
        "SELECT count(*)::int AS count FROM posts WHERE id = 'p-restriction-race'"
      );
      assert.equal(persisted.rows[0].count, 0);
    });
  } finally {
    releaseModeration();
    provider.reviewText = originalReviewText;
    await pendingPost?.catch(() => {});
  }
});

async function seedCaseFixture() {
  await pool.query(
    `INSERT INTO admin_users (id, username, username_normalized, password_hash)
     VALUES ('admin-case-reviewer', 'CaseReviewer', 'casereviewer', 'unused-test-hash')`
  );
  await pool.query(
    `INSERT INTO admin_devices (
       id, admin_user_id, display_name, public_key_jwk, fingerprint_hash, is_root
     ) VALUES (
       'device-case-reviewer', 'admin-case-reviewer', 'Case Review Browser',
       '{"kty":"EC"}'::jsonb, 'fixture-fingerprint', true
     )`
  );
  await pool.query(
    `INSERT INTO admin_sessions (
       id, admin_user_id, device_id, token_hash, csrf_hash,
       idle_expires_at, absolute_expires_at
     ) VALUES (
       'session-case-reviewer', 'admin-case-reviewer', 'device-case-reviewer', $1, $2,
       now() + interval '30 minutes', now() + interval '8 hours'
     )`,
    [hashAdminToken(sessionToken), hashAdminToken(csrfToken)]
  );

  await pool.query(
    `INSERT INTO users (id, email, nickname) VALUES
       ('u-owner', 'owner@example.test', '团长'),
       ('u-reporter-a', 'reporter-a@example.test', '举报人甲'),
       ('u-reporter-b', 'reporter-b@example.test', '举报人乙'),
       ('u-target', 'target@example.test', '目标用户')`
  );
  await pool.query(
    `INSERT INTO posts (
       id, author_id, title, deadline, description
     ) VALUES (
       'post-case-target', 'u-owner', '需要审核的帖子', now() + interval '30 days', '公开帖子说明'
     )`
  );
  await pool.query(
    `INSERT INTO safety_cases (
       id, subject_type, subject_id, category, impact_scope,
       status, risk_level, created_at, updated_at
     ) VALUES
       (
         'case-post', 'post', 'post-case-target', 'harassment_or_abuse', 'post',
         'manual_review', 'urgent', now() - interval '2 hours', now() - interval '5 minutes'
       ),
       (
         'case-message', 'direct_message', 'message-4', 'harassment_or_abuse', 'direct_message',
         'manual_review', 'medium', now() - interval '1 hour', now() - interval '3 minutes'
       )`
  );
  await pool.query(
    `INSERT INTO reports (
       id, target_type, target_id, reason, detail, reporter_id, status,
       client_request_id, case_id, source_type, source_id,
       subject_type, subject_id, reason_code, reported_field, created_at
     ) VALUES
       (
         'report-a', 'post', 'post-case-target', 'harassment_or_abuse', '合成举报说明',
         'u-reporter-a', 'pending', 'case-request-a', 'case-post', 'post',
         'post-case-target', 'post', 'post-case-target', 'harassment_or_abuse', 'content',
         now() - interval '50 minutes'
       ),
       (
         'report-b', 'post', 'post-case-target', 'harassment_or_abuse', '另一条合成说明',
         'u-reporter-b', 'pending', 'case-request-b', 'case-post', 'post',
         'post-case-target', 'post', 'post-case-target', 'harassment_or_abuse', 'content',
         now() - interval '40 minutes'
       ),
       (
         'report-message', 'direct_message', 'message-4', 'harassment_or_abuse', '私信举报',
         'u-reporter-a', 'pending', 'case-request-message', 'case-message', 'direct_message',
         'message-4', 'direct_message', 'message-4', 'harassment_or_abuse', 'content',
         now() - interval '30 minutes'
       )`
  );
  await pool.query(
    `INSERT INTO safety_evidence (
       id, case_id, report_id, client_request_id, evidence_type,
       text_snapshot, structured_snapshot, object_keys, created_at
     ) VALUES
       (
         'evidence-post', 'case-post', 'report-a', 'evidence-request-post', 'post_snapshot',
         '私密证据原文',
         '{"report":{"detail":"合成举报说明"},"id":"post-case-target","title":"需要审核的帖子","authorId":"u-owner","imageObjectKeys":["report/u-reporter-a/evidence.png"]}'::jsonb,
         ARRAY['report/u-reporter-a/evidence.png']::text[], now() - interval '45 minutes'
       ),
       (
         'evidence-message', 'case-message', 'report-message', 'evidence-request-message', 'direct_message_window',
         '私信保留窗口',
         '{"messages":[{"id":"m-1","senderId":"u-reporter-a"},{"id":"m-2","senderId":"u-owner"},{"id":"m-3","senderId":"u-reporter-a"},{"id":"m-4","senderId":"u-owner","imageObjectKey":"message/u-owner/evidence.png","sharedProfileUserId":"u-target"},{"id":"m-5","senderId":"u-reporter-a"},{"id":"m-6","senderId":"u-owner"},{"id":"m-7","senderId":"u-reporter-a"}]}'::jsonb,
         ARRAY['message/u-owner/evidence.png']::text[], now() - interval '25 minutes'
       )`
  );
  await pool.query(
    `INSERT INTO content_revisions (
       id, case_id, target_type, target_id, owner_id, revision_number,
       snapshot, object_keys, status, review_summary, reviewed_at
     ) VALUES (
       'revision-admin-approved', 'case-post', 'post', 'post-case-target', 'u-owner', 1,
       $1::jsonb, ARRAY['report/u-owner/revision.png']::text[],
       'approved', '{"status":"active","outcome":"pass"}'::jsonb, now()
     )`,
    [JSON.stringify({
      title: "整改后的帖子标题",
      imageNames: [],
      imageObjectKeys: ["post/u-owner/revised.png"],
      previewImageObjectKeys: [],
      nested: { imageObjectKey: "report/u-owner/revision.png" },
      groupType: "followGroup",
      categoryTags: [],
      fandomTags: [],
      price: "",
      deposit: "",
      condition: "",
      isFormed: false,
      description: "整改后的公开说明",
      externalLink: "",
      imageAspect: 1.08,
      pingguAveragePrice: "",
      pingguNote: "",
      unsoldRoles: []
    })]
  );
}

async function caseVersion(baseUrl, caseID) {
  const detail = await request(baseUrl, `/admin/api/cases/${caseID}`, {
    cookies: adminCookies
  });
  assert.equal(detail.status, 200);
  return detail.body.case.version;
}

async function request(baseUrl, path, {
  method = "GET",
  body,
  cookies,
  csrf,
  bearer,
  evidenceReason
} = {}) {
  const headers = adminRequestHeaders({ body, cookies, csrf, bearer, evidenceReason });
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : null
  };
}

function adminRequestHeaders({ body, cookies, csrf, bearer, evidenceReason } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookies?.size) {
    headers.cookie = [...cookies]
      .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
      .join("; ");
  }
  if (csrf) headers["x-csrf-token"] = csrf;
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (evidenceReason) headers["x-evidence-access-reason"] = evidenceReason;
  return headers;
}

function assertNoKeys(value, forbidden) {
  const serialized = JSON.stringify(value);
  for (const key of forbidden) assert.equal(serialized.includes(key), false, key);
}

async function withServer(callback, app = createApp({ adminWebEnabled: true })) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testTransaction(callback) {
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

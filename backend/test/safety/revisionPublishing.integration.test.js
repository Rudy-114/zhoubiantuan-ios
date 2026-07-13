import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createApp } from "../../src/app.js";
import { withTransaction } from "../../src/db.js";
import { applySafetyAction } from "../../src/safety/actionService.js";
import {
  publishApprovedRevision,
  reviewContentRevision,
  submitContentRevision
} from "../../src/safety/revisionService.js";
import { closeDatabase, pool, resetDatabase } from "../helpers/database.js";

test.beforeEach(async () => {
  await resetDatabase();
  await seedRevisionPublishingFixture();
});

test.after(closeDatabase);

test("injected hard-safety approval waits for a decision without granting Aliyun provenance", async () => {
  const revision = await submitPostRevision();
  let moderationInput;
  const moderationResult = {
    outcome: "pass",
    status: "active",
    riskLevel: "none",
    source: "textKeyword",
    reason: "Aliyun hard-safety pass",
    provider: "aliyun",
    rawSummary: { requestId: "req-safe" }
  };

  const result = await withTransaction((client) => reviewContentRevision(client, {
    revisionId: revision.id,
    moderation: async (input) => {
      moderationInput = input;
      return moderationResult;
    }
  }));

  assert.equal(result.published, false);
  assert.equal(result.awaiting, "human_or_qwen");
  assert.deepEqual(result.result, moderationResult);
  assert.equal(moderationInput.targetType, "post");
  assert.equal(moderationInput.targetId, revision.id);
  assert.equal(moderationInput.ownerId, "u-owner");
  assert.match(moderationInput.text, /Revised post/);
  assert.match(moderationInput.text, /Revised description/);
  assert.deepEqual(moderationInput.imageObjectKeys, [
    "post/u-owner/revised.jpg",
    "post/u-owner/revised-preview.jpg",
    "post/u-owner/revision-evidence.jpg"
  ]);

  const state = await pool.query(
    `SELECT cr.status, cr.review_summary, cr.reviewed_at,
            sc.status AS case_status,
            (SELECT count(*)::int FROM safety_case_events
             WHERE case_id = sc.id AND event_type = 'revision.hard_safety_approved') AS approval_events
     FROM content_revisions cr
     JOIN safety_cases sc ON sc.id = cr.case_id
     WHERE cr.id = $1`,
    [revision.id]
  );
  assert.equal(state.rows[0].status, "approved");
  assert.equal(state.rows[0].case_status, "manual_review");
  assert.ok(state.rows[0].reviewed_at instanceof Date);
  assert.equal(state.rows[0].approval_events, 1);
  assert.equal(state.rows[0].review_summary.hardSafety.provider, "unknown");
  assert.equal(state.rows[0].review_summary.hardSafety.passed, true);
  assert.equal(state.rows[0].review_summary.rawSummary.requestId, "req-safe");

  const post = await pool.query("SELECT title, safety_status FROM posts WHERE id = 'p-original'");
  assert.deepEqual(post.rows[0], { title: "Original post", safety_status: "hidden" });
});

test("hard-safety rejection and review outcomes never publish or restore", async () => {
  for (const scenario of [
    { status: "rejected", expectedRevisionStatus: "rejected", outcome: "block" },
    { status: "review", expectedRevisionStatus: "reviewing", outcome: "review" }
  ]) {
    await resetDatabase();
    await seedRevisionPublishingFixture();
    const revision = await submitPostRevision();

    const result = await withTransaction((client) => reviewContentRevision(client, {
      revisionId: revision.id,
      moderation: async () => ({
        outcome: scenario.outcome,
        status: scenario.status,
        riskLevel: "high",
        source: "textKeyword",
        reason: "not approved",
        rawSummary: { labels: ["risk"] }
      })
    }));

    assert.equal(result.published, false);
    assert.equal(Object.hasOwn(result, "awaiting"), false);
    const state = await pool.query(
      `SELECT cr.status, sc.status AS case_status, p.title, p.safety_status
       FROM content_revisions cr
       JOIN safety_cases sc ON sc.id = cr.case_id
       JOIN posts p ON p.id = cr.target_id
       WHERE cr.id = $1`,
      [revision.id]
    );
    assert.deepEqual(state.rows[0], {
      status: scenario.expectedRevisionStatus,
      case_status: scenario.status === "rejected" ? "awaiting_correction" : "manual_review",
      title: "Original post",
      safety_status: "hidden"
    });
  }
});

test("hard-safety rejection keeps the public post restricted and allows another correction", async () => {
  const rejectedRevision = await submitPostRevision();

  await withTransaction((client) => reviewContentRevision(client, {
    revisionId: rejectedRevision.id,
    moderation: async () => ({
      outcome: "block",
      status: "rejected",
      riskLevel: "high",
      source: "textKeyword",
      reason: "商品来源说明仍不完整",
      rawSummary: { labels: ["risk"] }
    })
  }));

  const nextRevision = await submitPostRevision();

  assert.equal(nextRevision.revision_number, 2);
  const post = await pool.query("SELECT title, safety_status FROM posts WHERE id = 'p-original'");
  assert.deepEqual(post.rows[0], { title: "Original post", safety_status: "hidden" });
});

test("provider exceptions persist a bounded manual-review outcome without leaking details", async () => {
  const revision = await submitPostRevision();
  const secret = `provider-token-${"x".repeat(10_000)}`;

  const result = await withTransaction((client) => reviewContentRevision(client, {
    revisionId: revision.id,
    moderation: async () => {
      throw new Error(secret);
    }
  }));

  assert.equal(result.published, false);
  assert.equal(result.result.status, "review");
  const state = await pool.query(
    `SELECT cr.status, cr.review_summary, sc.status AS case_status,
            p.title, p.safety_status
     FROM content_revisions cr
     JOIN safety_cases sc ON sc.id = cr.case_id
     JOIN posts p ON p.id = cr.target_id
     WHERE cr.id = $1`,
    [revision.id]
  );
  assert.equal(state.rows[0].status, "reviewing");
  assert.equal(state.rows[0].case_status, "manual_review");
  assert.equal(state.rows[0].title, "Original post");
  assert.equal(state.rows[0].safety_status, "hidden");
  const persisted = JSON.stringify(state.rows[0].review_summary);
  assert.ok(persisted.length < 2_000);
  assert.doesNotMatch(persisted, /provider-token|xxxxxxxx/);
  assert.equal(state.rows[0].review_summary.rawSummary.errorCode, "MODERATION_PROVIDER_ERROR");
});

test("review retries are idempotent after a durable decision", async () => {
  const revision = await submitPostRevision();
  let providerCalls = 0;
  const review = () => withTransaction((client) => reviewContentRevision(client, {
    revisionId: revision.id,
    moderation: async () => {
      providerCalls += 1;
      return approvedModerationResult();
    }
  }));

  const first = await review();
  const second = await review();

  assert.equal(first.awaiting, "human_or_qwen");
  assert.equal(second.unchanged, true);
  assert.deepEqual(second.syncEvents, []);
  assert.equal(providerCalls, 1);
  assert.equal(await countCaseEvents("revision.hard_safety_approved"), 1);
  const syncCount = await pool.query("SELECT count(*)::int AS count FROM sync_events WHERE event_type = 'post.updated'");
  assert.equal(syncCount.rows[0].count, 1);
});

test("review summary persists only bounded allowlisted fields and strips credentials", async () => {
  const revision = await submitPostRevision();
  const secrets = ["bearer-secret", "signature-secret", "query-token", "password-secret", "access-key-secret"];
  await withTransaction((client) => reviewContentRevision(client, {
    revisionId: revision.id,
    moderation: async () => ({
      ...approvedModerationResult(),
      reason: `Authorization: Bearer ${secrets[0]} https://oss.example/object?X-Oss-Signature=${secrets[1]}&token=${secrets[2]}`,
      rawSummary: {
        requestId: "request-safe",
        code: 200,
        riskLevel: "none",
        reason: `password=${secrets[3]} accessKeySecret=${secrets[4]}`,
        labels: ["normal", `token=${secrets[2]}`],
        hasHighRisk: false,
        hasMediumRisk: false,
        hasReview: false,
        hasBlock: false,
        hasRiskLabel: false,
        hasNon200Code: false,
        count: 2,
        errorCode: `PROVIDER_${secrets[4]}`,
        Authorization: `Bearer ${secrets[0]}`,
        signedUrl: `https://oss.example/object?signature=${secrets[1]}`,
        arbitraryMessage: secrets[3],
        nested: { accessKey: secrets[4] }
      }
    })
  }));

  const { rows } = await pool.query("SELECT review_summary FROM content_revisions WHERE id = $1", [revision.id]);
  const persisted = JSON.stringify(rows[0].review_summary);
  for (const secret of secrets) assert.doesNotMatch(persisted, new RegExp(secret));
  assert.deepEqual(Object.keys(rows[0].review_summary.rawSummary).sort(), [
    "code", "count", "hasBlock", "hasHighRisk", "hasMediumRisk", "hasNon200Code",
    "hasReview", "hasRiskLabel", "labels", "reason", "requestId", "riskLevel"
  ]);
  assert.doesNotMatch(persisted, /Authorization|signedUrl|arbitraryMessage|nested|X-Oss-Signature/i);
});

test("admin publication updates a post in place, preserves history and interactions, and restores visibility", async () => {
  await pool.query(
    `INSERT INTO safety_case_events (case_id, actor_type, actor_id, event_type, event_data)
     VALUES ('case-revision', 'reporter', 'u-reporter', 'report.received', '{"source":"task-7-fixture"}'::jsonb)`
  );
  const revision = await submitPostRevision();
  await approveRevision(revision.id);
  await pool.query("TRUNCATE sync_events RESTART IDENTITY");
  const before = await pool.query(
    `SELECT id, author_id, collection_id, created_at, status
     FROM posts WHERE id = 'p-original'`
  );

  const result = await withTransaction((client) => publishApprovedRevision(client, revision.id, adminApproval()));

  assert.equal(result.published, true);
  assert.equal(result.restored, true);
  const post = await pool.query("SELECT * FROM posts WHERE id = 'p-original'");
  assert.equal(post.rows[0].id, before.rows[0].id);
  assert.equal(post.rows[0].author_id, before.rows[0].author_id);
  assert.equal(post.rows[0].collection_id, before.rows[0].collection_id);
  assert.equal(post.rows[0].created_at.getTime(), before.rows[0].created_at.getTime());
  assert.equal(post.rows[0].status, before.rows[0].status);
  assert.equal(post.rows[0].title, "Revised post");
  assert.deepEqual(post.rows[0].image_names, ["revised.jpg"]);
  assert.deepEqual(post.rows[0].image_object_keys, ["post/u-owner/revised.jpg"]);
  assert.deepEqual(post.rows[0].preview_image_object_keys, ["post/u-owner/revised-preview.jpg"]);
  assert.equal(post.rows[0].group_type, "splitGoods");
  assert.deepEqual(post.rows[0].category_tags, ["revised-category"]);
  assert.deepEqual(post.rows[0].fandom_tags, ["revised-fandom"]);
  assert.equal(post.rows[0].price, "Revised price");
  assert.equal(post.rows[0].deposit, "Revised deposit");
  assert.equal(post.rows[0].condition, "Revised condition");
  assert.equal(post.rows[0].is_formed, true);
  assert.equal(post.rows[0].description, "Revised description");
  assert.equal(post.rows[0].external_link, "https://example.com/revised");
  assert.equal(Number(post.rows[0].image_aspect), 1.25);
  assert.equal(post.rows[0].pinggu_average_price, "Revised average");
  assert.equal(post.rows[0].pinggu_note, "Revised note");
  assert.deepEqual(post.rows[0].unsold_roles, [
    { id: "new", name: "New", quantity: 2, priceAdjustment: 0 }
  ]);
  assert.equal(post.rows[0].wechat, "parent-wechat");
  assert.equal(post.rows[0].qq, "parent-qq");
  assert.equal(post.rows[0].group_number, "parent-group");
  assert.equal(post.rows[0].group_info, "Parent authoritative group information");
  assert.equal(post.rows[0].deadline.toISOString(), "2030-01-02T03:04:05.000Z");
  assert.equal(post.rows[0].safety_status, "active");

  const preservation = await publicationPreservationState();
  assert.deepEqual(preservation, {
    likes: 1,
    favorites: 1,
    comments: 1,
    reports: 1,
    moderation_reviews: 1
  });
  const preservedHistory = await pool.query(
    `SELECT event_type, event_data FROM safety_case_events
     WHERE case_id = 'case-revision' AND event_type = 'report.received'`
  );
  assert.deepEqual(preservedHistory.rows, [
    { event_type: "report.received", event_data: { source: "task-7-fixture" } }
  ]);
  const preservedReport = await pool.query(
    "SELECT case_id, subject_id FROM reports WHERE id = 'report-preserved'"
  );
  assert.deepEqual(preservedReport.rows[0], { case_id: "case-revision", subject_id: "p-original" });
  const state = await pool.query(
    `SELECT cr.status AS revision_status, cr.published_at,
            sc.status AS case_status, sc.correction_due_at, sc.resolved_at,
            sa.execution_status AS action_status
     FROM content_revisions cr
     JOIN safety_cases sc ON sc.id = cr.case_id
     JOIN safety_actions sa ON sa.id = 'action-hide-post'
     WHERE cr.id = $1`,
    [revision.id]
  );
  assert.equal(state.rows[0].revision_status, "published");
  assert.ok(state.rows[0].published_at instanceof Date);
  assert.equal(state.rows[0].case_status, "resolved_restored");
  assert.equal(state.rows[0].correction_due_at, null);
  assert.ok(state.rows[0].resolved_at instanceof Date);
  assert.equal(state.rows[0].action_status, "rolled_back");

  assert.deepEqual(result.syncEvents.map(syncIdentity), [
    "u-owner:safety.report.updated:safety_case:case-revision",
    "u-reporter:safety.report.updated:safety_case:case-revision",
    "u-owner:post.updated:post:p-original",
    "u-audience:post.updated:post:p-original",
    "u-reporter:post.updated:post:p-original"
  ]);
  const persistedSync = await pool.query(
    "SELECT user_id, event_type, entity_type, entity_id FROM sync_events ORDER BY id"
  );
  assert.deepEqual(persistedSync.rows, [
    { user_id: "u-owner", event_type: "safety.report.updated", entity_type: "safety_case", entity_id: "case-revision" },
    { user_id: "u-reporter", event_type: "safety.report.updated", entity_type: "safety_case", entity_id: "case-revision" },
    { user_id: "u-owner", event_type: "post.updated", entity_type: "post", entity_id: "p-original" },
    { user_id: "u-audience", event_type: "post.updated", entity_type: "post", entity_id: "p-original" },
    { user_id: "u-reporter", event_type: "post.updated", entity_type: "post", entity_id: "p-original" }
  ]);
  await withServer(async (baseUrl) => {
    const sharedPost = await request(baseUrl, "/api/posts/p-original");
    assert.equal(sharedPost.status, 200);
    assert.equal(sharedPost.body.post.id, "p-original");
    assert.equal(sharedPost.body.post.title, "Revised post");
    assert.equal(sharedPost.body.post.likedCount, 1);
    assert.equal(sharedPost.body.post.favoriteCount, 1);
    assert.equal(sharedPost.body.post.commentCount, 1);
    assert.equal(sharedPost.body.post.reportCount, 1);
    assert.deepEqual(sharedPost.body.comments.map((comment) => comment.id), ["comment-preserved"]);
  });
});

test("manual hold publishes editable content but keeps restrictions and restoration pending", async () => {
  await pool.query("UPDATE safety_cases SET manual_hold = true WHERE id = 'case-revision'");
  const revision = await submitPostRevision();
  await approveRevision(revision.id);
  await pool.query("TRUNCATE sync_events RESTART IDENTITY");

  const result = await withTransaction((client) => publishApprovedRevision(client, revision.id, adminApproval()));

  assert.equal(result.published, true);
  assert.equal(result.restored, false);
  const state = await postPublicationState(revision.id);
  assert.equal(state.title, "Revised post");
  assert.equal(state.safety_status, "hidden");
  assert.equal(state.revision_status, "published");
  assert.equal(state.case_status, "manual_review");
  assert.equal(state.resolved_at, null);
  assert.equal(state.action_status, "applied");
  assert.deepEqual(await publicationPreservationState(), {
    likes: 1,
    favorites: 1,
    comments: 1,
    reports: 1,
    moderation_reviews: 1
  });
  assert.deepEqual(result.syncEvents.map(syncIdentity), ["u-owner:post.updated:post:p-original"]);
  const entityEvents = await pool.query(
    "SELECT user_id FROM sync_events WHERE event_type = 'post.updated' ORDER BY id"
  );
  assert.deepEqual(entityEvents.rows, [{ user_id: "u-owner" }]);
  assert.equal(await countCaseEvents("revision.approved_waiting_manual_restore"), 1);
});

test("an applied admin action prevents every automatic rollback", async () => {
  await insertAppliedAction({
    id: "action-admin-hold",
    caseId: "case-revision",
    actionType: "hide_post",
    actorType: "admin",
    actorId: "admin-guard"
  });
  const revision = await approvedPostRevision();

  const result = await withTransaction((client) => publishApprovedRevision(client, revision.id, adminApproval()));

  assert.equal(result.restored, false);
  const actions = await pool.query(
    "SELECT id, execution_status FROM safety_actions WHERE target_id = 'p-original' ORDER BY id"
  );
  assert.deepEqual(actions.rows, [
    { id: "action-admin-hold", execution_status: "applied" },
    { id: "action-hide-post", execution_status: "applied" }
  ]);
  const state = await postPublicationState(revision.id);
  assert.equal(state.safety_status, "hidden");
  assert.equal(state.case_status, "manual_review");
  assert.deepEqual(result.syncEvents.map(syncIdentity), ["u-owner:post.updated:post:p-original"]);
  const audienceEvents = await pool.query(
    "SELECT user_id FROM sync_events WHERE event_type = 'post.updated' AND user_id <> 'u-owner' ORDER BY id"
  );
  assert.deepEqual(audienceEvents.rows, []);
});

test("another open case for the same target prevents restoration", async () => {
  await pool.query(
    `INSERT INTO safety_cases (id, subject_type, subject_id, category, impact_scope, status)
     VALUES ('case-other-open', 'post', 'p-original', 'spam_or_advertising', 'post', 'monitoring')`
  );
  const revision = await approvedPostRevision();

  const result = await withTransaction((client) => publishApprovedRevision(client, revision.id, adminApproval()));

  assert.equal(result.restored, false);
  const state = await postPublicationState(revision.id);
  assert.equal(state.safety_status, "hidden");
  assert.equal(state.case_status, "manual_review");
  assert.equal(state.action_status, "applied");
});

test("terminal sibling-case restrictions block restoration and are never rolled back", async () => {
  await pool.query(
    `INSERT INTO safety_cases (id, subject_type, subject_id, category, impact_scope, status, resolved_at)
     VALUES ('case-terminal-sibling', 'post', 'p-original', 'spam_or_advertising', 'post',
             'resolved_actioned', now())`
  );
  await insertAppliedAction({
    id: "action-sibling-hide",
    caseId: "case-terminal-sibling",
    actionType: "hide_post",
    actorType: "system",
    beforeSnapshot: { safety_status: "active", action_chain_id: "chain-sibling-hide" },
    afterSnapshot: { safety_status: "hidden", action_chain_id: "chain-sibling-hide" }
  });
  await insertAppliedAction({
    id: "action-sibling-correction",
    caseId: "case-terminal-sibling",
    actionType: "request_correction",
    actorType: "ai"
  });
  const revision = await approvedPostRevision();

  const result = await withTransaction((client) => publishApprovedRevision(client, revision.id, adminApproval()));

  assert.equal(result.published, true);
  assert.equal(result.restored, false);
  const actions = await pool.query(
    `SELECT id, execution_status FROM safety_actions
     WHERE id IN ('action-hide-post', 'action-sibling-hide', 'action-sibling-correction') ORDER BY id`
  );
  assert.deepEqual(actions.rows, [
    { id: "action-hide-post", execution_status: "applied" },
    { id: "action-sibling-correction", execution_status: "applied" },
    { id: "action-sibling-hide", execution_status: "applied" }
  ]);
  const state = await postPublicationState(revision.id);
  assert.equal(state.title, "Revised post");
  assert.equal(state.safety_status, "hidden");
  assert.equal(state.case_status, "manual_review");
  assert.equal(await countCaseEventsForCase("case-terminal-sibling", "safety_action_rolled_back"), 0);
  assert.equal(await countCaseEvents("revision.approved_waiting_manual_restore"), 1);
});

test("an applied non-reversible system action conservatively prevents restoration", async () => {
  await insertAppliedAction({
    id: "action-unknown-system",
    caseId: "case-revision",
    actionType: "remove_post",
    actorType: "system"
  });
  const revision = await approvedPostRevision();

  const result = await withTransaction((client) => publishApprovedRevision(client, revision.id, adminApproval()));

  assert.equal(result.restored, false);
  assert.equal((await postPublicationState(revision.id)).action_status, "applied");
  assert.equal(await countCaseEvents("revision.approved_waiting_manual_restore"), 1);
});

test("collection publication updates the original row and mirrors shared fields without changing child moderation", async () => {
  await pool.query(
    "UPDATE group_collections SET contact_visibility = 'hidden' WHERE id = 'collection-revision'"
  );
  await insertAppliedAction({
    id: "action-hide-collection-contact-restorable",
    caseId: "case-collection-revision",
    actionType: "hide_collection_contact",
    actorType: "system",
    beforeSnapshot: { contact_visibility: "active", action_chain_id: "chain-hide-restorable-contact" },
    afterSnapshot: { contact_visibility: "hidden", action_chain_id: "chain-hide-restorable-contact" }
  });
  const revision = await submitCollectionRevision();
  await approveRevision(revision.id);
  await pool.query("TRUNCATE sync_events RESTART IDENTITY");
  const before = await pool.query(
    "SELECT id, owner_id, created_at, status, contact_visibility FROM group_collections WHERE id = 'collection-revision'"
  );
  const childBefore = await pool.query(
    "SELECT id, status, safety_status FROM posts WHERE collection_id = 'collection-revision' ORDER BY id"
  );

  const result = await withTransaction((client) => publishApprovedRevision(client, revision.id, adminApproval()));

  assert.equal(result.restored, true);
  const collection = await pool.query("SELECT * FROM group_collections WHERE id = 'collection-revision'");
  assert.equal(collection.rows[0].id, before.rows[0].id);
  assert.equal(collection.rows[0].owner_id, before.rows[0].owner_id);
  assert.equal(collection.rows[0].created_at.getTime(), before.rows[0].created_at.getTime());
  assert.equal(collection.rows[0].status, before.rows[0].status);
  assert.equal(before.rows[0].contact_visibility, "hidden");
  assert.equal(collection.rows[0].contact_visibility, "active");
  assert.equal(collection.rows[0].name, "Revised collection");
  assert.equal(collection.rows[0].contact_wechat, "revised-wechat");
  assert.equal(collection.rows[0].contact_qq, "revised-qq");
  assert.equal(collection.rows[0].contact_group_number, "revised-group");
  assert.equal(collection.rows[0].group_info, "Revised collection group information");
  assert.equal(collection.rows[0].deadline.toISOString(), "2031-02-03T04:05:06.000Z");
  assert.equal(collection.rows[0].default_note, "Revised default note");
  assert.equal(collection.rows[0].safety_status, "active");

  const children = await pool.query(
    `SELECT id, wechat, qq, group_number, group_info, deadline, status, safety_status
     FROM posts WHERE collection_id = 'collection-revision' ORDER BY id`
  );
  assert.deepEqual(children.rows.map(({ id, status, safety_status }) => ({ id, status, safety_status })), childBefore.rows);
  for (const child of children.rows) {
    assert.equal(child.wechat, "revised-wechat");
    assert.equal(child.qq, "revised-qq");
    assert.equal(child.group_number, "revised-group");
    assert.equal(child.group_info, "Revised collection group information");
    assert.equal(child.deadline.toISOString(), "2031-02-03T04:05:06.000Z");
  }
  const restoredActions = await pool.query(
    `SELECT id, execution_status FROM safety_actions
     WHERE id IN ('action-suspend-collection', 'action-hide-collection-contact-restorable')
     ORDER BY id`
  );
  assert.deepEqual(restoredActions.rows, [
    { id: "action-hide-collection-contact-restorable", execution_status: "rolled_back" },
    { id: "action-suspend-collection", execution_status: "rolled_back" }
  ]);
  await withServer(async (baseUrl) => {
    const independentlyActiveChild = await request(baseUrl, "/api/posts/collection-child-active");
    const separatelyHiddenChild = await request(baseUrl, "/api/posts/collection-child-hidden");
    assert.equal(independentlyActiveChild.status, 200);
    assert.equal(independentlyActiveChild.body.post.id, "collection-child-active");
    assert.equal(separatelyHiddenChild.status, 404);
  });
  assert.deepEqual(result.syncEvents.map(syncIdentity), [
    "u-owner:safety.report.updated:safety_case:case-collection-revision",
    "u-owner:collection.updated:collection:collection-revision",
    "u-audience:collection.updated:collection:collection-revision",
    "u-reporter:collection.updated:collection:collection-revision"
  ]);
  const ownerSafetySync = await pool.query(
    `SELECT count(*)::int AS count FROM sync_events
     WHERE user_id = 'u-owner' AND event_type = 'safety.report.updated'
       AND entity_id = 'case-collection-revision'`
  );
  assert.equal(ownerSafetySync.rows[0].count, 1);
});

test("restored collection publication includes reporters who directly reported the collection", async () => {
  await pool.query("INSERT INTO users (id, nickname) VALUES ('u-collection-reporter', 'Collection Reporter')");
  await pool.query(
    `INSERT INTO reports (
       id, target_type, target_id, reason, detail, reporter_id, status, client_request_id,
       case_id, source_type, source_id, subject_type, subject_id, reason_code
     ) VALUES (
       'report-direct-collection', 'collection', 'collection-revision', 'Collection report', '',
       'u-collection-reporter', 'pending', 'report-request-direct-collection',
       'case-collection-revision', 'collection', 'collection-revision',
       'collection', 'collection-revision', 'other'
     )`
  );
  const revision = await submitCollectionRevision();
  await approveRevision(revision.id);
  await pool.query("TRUNCATE sync_events RESTART IDENTITY");

  const result = await withTransaction((client) => publishApprovedRevision(client, revision.id, adminApproval()));

  assert.equal(result.restored, true);
  const directReporterEvents = result.syncEvents.filter((event) =>
    event.userID === "u-collection-reporter" && event.eventType === "collection.updated");
  assert.equal(directReporterEvents.length, 1);
});

test("collection contact remaining hidden prevents effective restoration", async () => {
  await pool.query(
    "UPDATE group_collections SET contact_visibility = 'hidden' WHERE id = 'collection-revision'"
  );
  await insertAppliedAction({
    id: "action-hide-collection-contact",
    caseId: "case-collection-revision",
    actionType: "hide_collection_contact",
    actorType: "system",
    beforeSnapshot: { contact_visibility: "hidden", action_chain_id: "chain-hidden-contact" },
    afterSnapshot: { contact_visibility: "hidden", action_chain_id: "chain-hidden-contact" }
  });
  const revision = await submitCollectionRevision();
  await approveRevision(revision.id);

  const result = await withTransaction((client) => publishApprovedRevision(client, revision.id, adminApproval()));

  assert.equal(result.published, true);
  assert.equal(result.restored, false);
  const state = await pool.query(
    `SELECT c.contact_visibility, c.safety_status, sc.status AS case_status,
            sa.execution_status AS contact_action_status
     FROM group_collections c
     JOIN safety_cases sc ON sc.id = 'case-collection-revision'
     JOIN safety_actions sa ON sa.id = 'action-hide-collection-contact'
     WHERE c.id = 'collection-revision'`
  );
  assert.deepEqual(state.rows[0], {
    contact_visibility: "hidden",
    safety_status: "suspended",
    case_status: "manual_review",
    contact_action_status: "applied"
  });
  assert.equal(await countCaseEvents("revision.approved_waiting_manual_restore"), 1);
});

test("policy publication requires recorded Aliyun provenance and a strict explicitly passing Qwen result", async () => {
  let revision = await submitPostRevision();
  await approveRevision(revision.id, { provider: "mock", source: "systemRule" });
  await assert.rejects(
    withTransaction((client) => publishApprovedRevision(client, revision.id, policyApproval())),
    (error) => error.status === 400 && error.apiCode === "invalid_policy_approval"
  );

  await resetDatabase();
  await seedRevisionPublishingFixture();
  revision = await submitPostRevision();
  await approveRevision(revision.id, { provider: undefined, source: "textKeyword" });
  await assert.rejects(
    withTransaction((client) => publishApprovedRevision(client, revision.id, policyApproval())),
    (error) => error.status === 400 && error.apiCode === "invalid_policy_approval"
  );

  await resetDatabase();
  await seedRevisionPublishingFixture();
  revision = await submitPostRevision();
  await approveRevision(revision.id, { provider: "aliyun", source: "textKeyword" });
  const forged = await pool.query("SELECT review_summary FROM content_revisions WHERE id = $1", [revision.id]);
  assert.equal(forged.rows[0].review_summary.hardSafety.provider, "unknown");
  await assert.rejects(
    withTransaction((client) => publishApprovedRevision(client, revision.id, policyApproval())),
    (error) => error.status === 400 && error.apiCode === "invalid_policy_approval"
  );

  await resetDatabase();
  await seedRevisionPublishingFixture();
  revision = await approvedPostRevision();
  await persistTrustedAliyunReviewSummary(revision.id);
  const invalidApprovals = [
    { actorType: "policy", qwenResult: validQwenResult(), policyVersion: "" },
    { ...policyApproval(), extra: true },
    policyApproval({ requiresHuman: true }),
    policyApproval({ recommendedAction: "manual_review" }),
    policyApproval({ riskLevel: "low" }),
    policyApproval({ extra: "ambiguous" }),
    { actorType: "admin", actorId: "admin-1", reason: "approved", extra: true }
  ];
  for (const approval of invalidApprovals) {
    await assert.rejects(
      withTransaction((client) => publishApprovedRevision(client, revision.id, approval)),
      (error) => error.status === 400
    );
  }

  const result = await withTransaction((client) => publishApprovedRevision(client, revision.id, policyApproval()));
  assert.equal(result.restored, true);
  const rollback = await pool.query(
    `SELECT actor_type, actor_id, event_data
     FROM safety_case_events
     WHERE case_id = 'case-revision' AND event_type = 'safety_action_rolled_back'`
  );
  assert.equal(rollback.rows[0].actor_type, "ai");
  assert.equal(rollback.rows[0].actor_id, "policy:policy-v7");
  assert.match(rollback.rows[0].event_data.reason, /policy-v7/);
  assert.doesNotMatch(JSON.stringify(rollback.rows[0]), /Aliyun passed/);
});

test("publication rejects non-approved revisions and concurrent approved retries change state only once", async () => {
  let revision = await submitPostRevision();
  await assert.rejects(
    withTransaction((client) => publishApprovedRevision(client, revision.id, adminApproval())),
    (error) => error.status === 409 && error.apiCode === "revision_not_approved"
  );

  await resetDatabase();
  await seedRevisionPublishingFixture();
  revision = await approvedPostRevision();
  await pool.query("TRUNCATE sync_events RESTART IDENTITY");
  const results = await Promise.all([
    withTransaction((client) => publishApprovedRevision(client, revision.id, adminApproval())),
    withTransaction((client) => publishApprovedRevision(client, revision.id, adminApproval()))
  ]);

  assert.deepEqual(results.map((result) => result.unchanged === true).sort(), [false, true]);
  assert.equal(await countCaseEvents("safety_action_rolled_back"), 1);
  assert.equal(await countCaseEvents("revision.approved_waiting_manual_restore"), 0);
  const syncCount = await pool.query("SELECT count(*)::int AS count FROM sync_events");
  assert.equal(syncCount.rows[0].count, 5);

  const repeated = await withTransaction((client) => publishApprovedRevision(client, revision.id, adminApproval()));
  assert.equal(repeated.unchanged, true);
  assert.deepEqual(repeated.syncEvents, []);
  assert.equal(await countCaseEvents("safety_action_rolled_back"), 1);
});

test("review and resubmit use case-first locking without deadlock or duplicate provider work", async () => {
  const revision = await submitPostRevision();
  await pool.query("UPDATE safety_cases SET status = 'awaiting_correction' WHERE id = 'case-revision'");
  let providerCalls = 0;

  const results = await runResubmitRevisionRace((client) => reviewContentRevision(client, {
    revisionId: revision.id,
    moderation: async () => {
      providerCalls += 1;
      return approvedModerationResult();
    }
  }));

  assert.equal(results[0].status, "rejected");
  assert.equal(results[0].reason.apiCode, "revision_in_progress");
  assert.equal(results[1].status, "fulfilled");
  assert.equal(results[1].value.awaiting, "human_or_qwen");
  assert.equal(providerCalls, 1);
  assert.equal(results.some((result) => result.reason?.code === "40P01"), false);
});

test("publish and resubmit use case-first locking without deadlock", async () => {
  const revision = await approvedPostRevision();
  await pool.query("UPDATE safety_cases SET status = 'awaiting_correction' WHERE id = 'case-revision'");

  const results = await runResubmitRevisionRace((client) =>
    publishApprovedRevision(client, revision.id, adminApproval()));

  assert.equal(results[0].status, "rejected");
  assert.equal(results[0].reason.apiCode, "revision_in_progress");
  assert.equal(results[1].status, "fulfilled");
  assert.equal(results[1].value.restored, true);
  assert.equal(results.some((result) => result.reason?.code === "40P01"), false);
});

test("post and parent collection publication serialize without deadlock and keep shared fields coherent", async () => {
  await pool.query(
    `INSERT INTO safety_cases (
       id, subject_type, subject_id, category, impact_scope, status, correction_due_at
     ) VALUES (
       'case-parent-revision', 'collection', 'collection-parent', 'other', 'collection',
       'awaiting_correction', now() + interval '2 days'
     )`
  );
  const postRevision = await approvedPostRevision();
  const collectionRevision = await submitParentCollectionRevision();
  await approveRevision(collectionRevision.id);
  const beforeInteractions = await publicationPreservationState();

  const firstClient = await pool.connect();
  const secondClient = await pool.connect();
  const postLocked = deferred();
  const collectionLockAttempted = deferred();
  const releasePost = deferred();
  let firstPromise;
  let secondPromise;
  const postLock = /FROM posts WHERE id = \$1 FOR UPDATE/;
  const collectionLock = /FROM group_collections WHERE id = \$1 FOR UPDATE/;
  const firstProxy = clientProxy(firstClient, async (sql, params) => {
    const result = await firstClient.query(sql, params);
    if (postLock.test(String(sql)) && params?.[0] === "p-original") {
      postLocked.resolve();
      await releasePost.promise;
    }
    return result;
  });
  const secondProxy = clientProxy(secondClient, (sql, params) => {
    if (collectionLock.test(String(sql)) && params?.[0] === "collection-parent") {
      collectionLockAttempted.resolve();
    }
    return secondClient.query(sql, params);
  });

  try {
    await firstClient.query("BEGIN");
    await secondClient.query("BEGIN");
    await firstClient.query("SET LOCAL statement_timeout = '4000ms'");
    await secondClient.query("SET LOCAL statement_timeout = '4000ms'");
    firstPromise = settleTransaction(firstClient, () =>
      publishApprovedRevision(firstProxy, postRevision.id, adminApproval()));
    await postLocked.promise;
    secondPromise = settleTransaction(secondClient, () =>
      publishApprovedRevision(secondProxy, collectionRevision.id, adminApproval()));
    await collectionLockAttempted.promise;
    releasePost.resolve();
    const results = await withTimeout(Promise.allSettled([firstPromise, secondPromise]), 6_000);
    assert.deepEqual(results.map((result) => result.status), ["fulfilled", "fulfilled"]);
    assert.equal(results.some((result) => result.reason?.code === "40P01"), false);
  } finally {
    releasePost.resolve();
    await Promise.allSettled([firstPromise, secondPromise].filter(Boolean));
    await firstClient.query("ROLLBACK").catch(() => {});
    await secondClient.query("ROLLBACK").catch(() => {});
    firstClient.release();
    secondClient.release();
  }

  const { rows } = await pool.query(
    `SELECT c.contact_wechat, c.contact_qq, c.contact_group_number, c.group_info, c.deadline,
            p.wechat, p.qq, p.group_number, p.group_info AS post_group_info, p.deadline AS post_deadline,
            p.status, p.safety_status,
            post_revision.status AS post_revision_status,
            collection_revision.status AS collection_revision_status
     FROM group_collections c
     JOIN posts p ON p.collection_id = c.id AND p.id = 'p-original'
     JOIN content_revisions post_revision ON post_revision.id = $1
     JOIN content_revisions collection_revision ON collection_revision.id = $2
     WHERE c.id = 'collection-parent'`,
    [postRevision.id, collectionRevision.id]
  );
  assert.deepEqual(rows[0], {
    contact_wechat: "parent-revised-wechat",
    contact_qq: "parent-revised-qq",
    contact_group_number: "parent-revised-group",
    group_info: "Parent revised group information",
    deadline: new Date("2032-03-04T05:06:07.000Z"),
    wechat: "parent-revised-wechat",
    qq: "parent-revised-qq",
    group_number: "parent-revised-group",
    post_group_info: "Parent revised group information",
    post_deadline: new Date("2032-03-04T05:06:07.000Z"),
    status: "active",
    safety_status: "active",
    post_revision_status: "published",
    collection_revision_status: "published"
  });
  assert.deepEqual(await publicationPreservationState(), beforeInteractions);
});

test("publication and a sibling-case action serialize without rolling back sibling enforcement", async () => {
  await pool.query(
    `INSERT INTO safety_cases (id, subject_type, subject_id, category, impact_scope, status)
     VALUES ('case-sibling-action', 'post', 'p-original', 'suspected_scam', 'post', 'received')`
  );
  const revision = await approvedPostRevision();
  const publishClient = await pool.connect();
  const actionClient = await pool.connect();
  const postLocked = deferred();
  const siblingSerializationAttempted = deferred();
  const releasePublish = deferred();
  let publishPromise;
  let actionPromise;
  const postLock = /FROM posts WHERE id = \$1 FOR UPDATE/;
  const siblingCaseLock = /SELECT \* FROM safety_cases WHERE id = \$1 FOR UPDATE/;
  const publishProxy = clientProxy(publishClient, async (sql, params) => {
    const result = await publishClient.query(sql, params);
    if (postLock.test(String(sql)) && params?.[0] === "p-original") {
      postLocked.resolve();
      await releasePublish.promise;
    }
    return result;
  });
  const actionProxy = clientProxy(actionClient, async (sql, params) => {
    if (/zbt:safety-target/.test(String(sql))) siblingSerializationAttempted.resolve();
    const result = await actionClient.query(sql, params);
    if (siblingCaseLock.test(String(sql)) && params?.[0] === "case-sibling-action") {
      siblingSerializationAttempted.resolve();
    }
    return result;
  });

  try {
    await publishClient.query("BEGIN");
    await actionClient.query("BEGIN");
    await publishClient.query("SET LOCAL statement_timeout = '4000ms'");
    await actionClient.query("SET LOCAL statement_timeout = '4000ms'");
    publishPromise = settleTransaction(publishClient, () =>
      publishApprovedRevision(publishProxy, revision.id, adminApproval()));
    await postLocked.promise;
    actionPromise = settleTransaction(actionClient, () => applySafetyAction(actionProxy, {
      caseId: "case-sibling-action",
      idempotencyKey: "sibling-action-during-publication",
      actionType: "hide_post",
      targetType: "post",
      targetId: "p-original",
      actorType: "system",
      actorId: "safety-automation",
      reason: "new sibling enforcement"
    }));
    await siblingSerializationAttempted.promise;
    releasePublish.resolve();
    const results = await withTimeout(Promise.allSettled([publishPromise, actionPromise]), 6_000);
    assert.deepEqual(results.map((result) => result.status), ["fulfilled", "fulfilled"]);
    assert.equal(results.some((result) => result.reason?.code === "40P01"), false);
  } finally {
    releasePublish.resolve();
    await Promise.allSettled([publishPromise, actionPromise].filter(Boolean));
    await publishClient.query("ROLLBACK").catch(() => {});
    await actionClient.query("ROLLBACK").catch(() => {});
    publishClient.release();
    actionClient.release();
  }

  const { rows } = await pool.query(
    `SELECT p.safety_status, sibling.execution_status AS sibling_status,
            original.execution_status AS original_status, cr.status AS revision_status,
            sc.status AS case_status,
            (SELECT count(*)::int FROM safety_case_events
             WHERE case_id = sc.id AND event_type = 'revision.approved_waiting_manual_restore') AS waiting_events
     FROM posts p
     JOIN safety_actions sibling ON sibling.idempotency_key = 'sibling-action-during-publication'
     JOIN safety_actions original ON original.id = 'action-hide-post'
     JOIN content_revisions cr ON cr.id = $1
     JOIN safety_cases sc ON sc.id = cr.case_id
     WHERE p.id = 'p-original'`,
    [revision.id]
  );
  assert.deepEqual(rows[0], {
    safety_status: "hidden",
    sibling_status: "applied",
    original_status: "applied",
    revision_status: "published",
    case_status: "manual_review",
    waiting_events: 1
  });
  assert.equal(await countCaseEventsForCase("case-sibling-action", "safety_action_rolled_back"), 0);
});

test("publication and sibling revision review serialize without undoing sibling enforcement", async () => {
  const publicationRevision = await approvedPostRevision();
  await pool.query(
    `INSERT INTO safety_cases (
       id, subject_type, subject_id, category, impact_scope, status, correction_due_at
     ) VALUES (
       'case-sibling-review', 'post', 'p-original', 'suspected_scam', 'post',
       'awaiting_correction', now() + interval '2 days'
     )`
  );
  await insertAppliedAction({
    id: "action-sibling-review-hide",
    caseId: "case-sibling-review",
    actionType: "hide_post",
    actorType: "system",
    beforeSnapshot: { safety_status: "hidden", action_chain_id: "chain-sibling-review-hide" },
    afterSnapshot: { safety_status: "hidden", action_chain_id: "chain-sibling-review-hide" }
  });
  const siblingRevision = await withTransaction((client) => submitContentRevision(client, {
    caseId: "case-sibling-review",
    ownerId: "u-owner",
    snapshot: revisedPostSnapshot()
  }));

  const publishClient = await pool.connect();
  const reviewClient = await pool.connect();
  const postLocked = deferred();
  const siblingSerializationAttempted = deferred();
  const releasePublish = deferred();
  let publishPromise;
  let reviewPromise;
  let providerCalls = 0;
  const postLock = /FROM posts WHERE id = \$1 FOR UPDATE/;
  const siblingCaseLock = /SELECT \* FROM safety_cases WHERE id = \$1 FOR UPDATE/;
  const publishProxy = clientProxy(publishClient, async (sql, params) => {
    const result = await publishClient.query(sql, params);
    if (postLock.test(String(sql)) && params?.[0] === "p-original") {
      postLocked.resolve();
      await releasePublish.promise;
    }
    return result;
  });
  const reviewProxy = clientProxy(reviewClient, async (sql, params) => {
    if (/zbt:safety-target/.test(String(sql))) siblingSerializationAttempted.resolve();
    const result = await reviewClient.query(sql, params);
    if (siblingCaseLock.test(String(sql)) && params?.[0] === "case-sibling-review") {
      siblingSerializationAttempted.resolve();
    }
    return result;
  });

  try {
    await publishClient.query("BEGIN");
    await reviewClient.query("BEGIN");
    await publishClient.query("SET LOCAL statement_timeout = '4000ms'");
    await reviewClient.query("SET LOCAL statement_timeout = '4000ms'");
    publishPromise = settleTransaction(publishClient, () =>
      publishApprovedRevision(publishProxy, publicationRevision.id, adminApproval()));
    await postLocked.promise;
    reviewPromise = settleTransaction(reviewClient, () => reviewContentRevision(reviewProxy, {
      revisionId: siblingRevision.id,
      moderation: async () => {
        providerCalls += 1;
        return approvedModerationResult();
      }
    }));
    await siblingSerializationAttempted.promise;
    releasePublish.resolve();
    const results = await withTimeout(Promise.allSettled([publishPromise, reviewPromise]), 6_000);
    assert.deepEqual(results.map((result) => result.status), ["fulfilled", "fulfilled"]);
    assert.equal(results.some((result) => result.reason?.code === "40P01"), false);
    assert.equal(results[0].value.restored, false);
    assert.equal(results[1].value.awaiting, "human_or_qwen");
  } finally {
    releasePublish.resolve();
    await Promise.allSettled([publishPromise, reviewPromise].filter(Boolean));
    await publishClient.query("ROLLBACK").catch(() => {});
    await reviewClient.query("ROLLBACK").catch(() => {});
    publishClient.release();
    reviewClient.release();
  }

  assert.equal(providerCalls, 1);
  const { rows } = await pool.query(
    `SELECT p.safety_status,
            publication.status AS publication_status,
            sibling.status AS sibling_revision_status,
            sibling_case.status AS sibling_case_status,
            sibling_action.execution_status AS sibling_action_status,
            (SELECT count(*)::int FROM safety_case_events
             WHERE case_id = sibling_case.id AND event_type = 'safety_action_rolled_back') AS sibling_rollbacks
     FROM posts p
     JOIN content_revisions publication ON publication.id = $1
     JOIN content_revisions sibling ON sibling.id = $2
     JOIN safety_cases sibling_case ON sibling_case.id = sibling.case_id
     JOIN safety_actions sibling_action ON sibling_action.id = 'action-sibling-review-hide'
     WHERE p.id = 'p-original'`,
    [publicationRevision.id, siblingRevision.id]
  );
  assert.deepEqual(rows[0], {
    safety_status: "hidden",
    publication_status: "published",
    sibling_revision_status: "approved",
    sibling_case_status: "manual_review",
    sibling_action_status: "applied",
    sibling_rollbacks: 0
  });
});

test("review and publication reject non-transaction clients before business queries", async () => {
  await assert.rejects(
    reviewContentRevision(pool, { revisionId: "revision-missing", moderation: async () => ({ status: "active" }) }),
    (error) => error.name === "TypeError" && /transaction-scoped.*PoolClient/i.test(error.message)
  );
  await assert.rejects(
    publishApprovedRevision(pool, "revision-missing", adminApproval()),
    (error) => error.name === "TypeError" && /transaction-scoped.*PoolClient/i.test(error.message)
  );
});

async function seedRevisionPublishingFixture() {
  await pool.query(
    `INSERT INTO users (id, nickname)
     VALUES ('u-owner', 'Owner'), ('u-audience', 'Audience'), ('u-reporter', 'Reporter')`
  );
  await pool.query(
    `INSERT INTO group_collections (
       id, owner_id, name, contact_wechat, contact_qq, contact_group_number,
       group_info, deadline, default_note, created_at, updated_at, safety_status
     ) VALUES
       ('collection-parent', 'u-owner', 'Parent collection', 'parent-wechat', 'parent-qq',
        'parent-group', 'Parent authoritative group information', '2030-01-02T03:04:05Z',
        'Parent note', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z', 'active'),
       ('collection-revision', 'u-owner', 'Original collection', 'old-wechat', 'old-qq',
        'old-group', 'Original collection group information', '2030-03-04T05:06:07Z',
        'Original default note', '2025-02-01T00:00:00Z', '2025-02-02T00:00:00Z', 'suspended')`
  );
  await pool.query(
    `INSERT INTO posts (
       id, author_id, collection_id, title, image_names, image_object_keys, preview_image_object_keys,
       group_type, category_tags, fandom_tags, price, deposit, deadline, condition,
       is_formed, description, wechat, qq, group_number, group_info, external_link,
       image_aspect, pinggu_average_price, pinggu_note, unsold_roles, status, safety_status,
       created_at, updated_at
     ) VALUES
     (
       'p-original', 'u-owner', 'collection-parent', 'Original post', ARRAY['original.jpg'],
       ARRAY['post/u-owner/original.jpg'], ARRAY['post/u-owner/original-preview.jpg'],
       'followGroup', ARRAY['original-category'], ARRAY['original-fandom'], 'Original price',
       'Original deposit', '2029-01-01T00:00:00Z', 'Original condition', false,
       'Original description', 'original-wechat', 'original-qq', 'original-group',
       'Original group information', 'https://example.com/original', 1.08,
       'Original average', 'Original note', '[{"id":"old","name":"Old","quantity":1}]'::jsonb,
       'active', 'hidden', '2025-03-01T00:00:00Z', '2025-03-02T00:00:00Z'
     ),
     (
       'collection-child-active', 'u-owner', 'collection-revision', 'Active child', ARRAY[]::text[],
       ARRAY[]::text[], ARRAY[]::text[], 'followGroup', ARRAY[]::text[], ARRAY[]::text[], '', '',
       '2030-03-04T05:06:07Z', '', false, '', 'old-wechat', 'old-qq', 'old-group',
       'Old child group information', '', 1.08, '', '', '[]'::jsonb, 'active', 'active',
       '2025-04-01T00:00:00Z', '2025-04-02T00:00:00Z'
     ),
     (
       'collection-child-hidden', 'u-owner', 'collection-revision', 'Hidden child', ARRAY[]::text[],
       ARRAY[]::text[], ARRAY[]::text[], 'followGroup', ARRAY[]::text[], ARRAY[]::text[], '', '',
       '2030-03-04T05:06:07Z', '', false, '', 'old-wechat', 'old-qq', 'old-group',
       'Old hidden child group information', '', 1.08, '', '', '[]'::jsonb, 'review', 'hidden',
       '2025-05-01T00:00:00Z', '2025-05-02T00:00:00Z'
     )`
  );
  await pool.query(
    `INSERT INTO safety_cases (
       id, subject_type, subject_id, category, impact_scope, status, correction_due_at
     ) VALUES
       ('case-revision', 'post', 'p-original', 'other', 'post', 'awaiting_correction',
        now() + interval '2 days'),
       ('case-collection-revision', 'collection', 'collection-revision', 'other', 'collection',
        'awaiting_correction', now() + interval '2 days'),
       ('case-collection-child-report', 'post', 'collection-child-active', 'other', 'post',
        'resolved_no_action', NULL)`
  );
  await pool.query(
    `INSERT INTO comments (id, post_id, author_id, body, status, safety_status)
     VALUES ('comment-preserved', 'p-original', 'u-audience', 'Preserved comment', 'active', 'active');
     INSERT INTO post_likes (user_id, post_id) VALUES ('u-audience', 'p-original');
     INSERT INTO post_favorites (user_id, post_id) VALUES ('u-audience', 'p-original');
     INSERT INTO moderation_reviews (
       id, target_type, target_id, owner_id, status, decision, source, reason
     ) VALUES (
       'moderation-history', 'post', 'p-original', 'u-owner', 'active', 'pass', 'systemRule', 'Original review'
     );
     INSERT INTO reports (
       id, target_type, target_id, reason, detail, reporter_id, status, client_request_id,
       case_id, source_type, source_id, subject_type, subject_id, reason_code
     ) VALUES (
       'report-preserved', 'post', 'p-original', 'Needs correction', '', 'u-reporter', 'pending',
       'report-request-preserved', 'case-revision', 'post', 'p-original', 'post', 'p-original', 'other'
     );
     INSERT INTO post_likes (user_id, post_id) VALUES ('u-audience', 'collection-child-active');
     INSERT INTO reports (
       id, target_type, target_id, reason, detail, reporter_id, status, client_request_id,
       case_id, source_type, source_id, subject_type, subject_id, reason_code
     ) VALUES (
       'report-collection-child', 'post', 'collection-child-active', 'Prior child report', '',
       'u-reporter', 'closed', 'report-request-collection-child', 'case-collection-child-report',
       'post', 'collection-child-active', 'post', 'collection-child-active', 'other'
     )`
  );
  await insertAppliedAction({
    id: "action-hide-post",
    caseId: "case-revision",
    actionType: "hide_post",
    actorType: "system",
    beforeSnapshot: { safety_status: "active", action_chain_id: "chain-hide-post" },
    afterSnapshot: { safety_status: "hidden", action_chain_id: "chain-hide-post" }
  });
  await insertAppliedAction({
    id: "action-suspend-collection",
    caseId: "case-collection-revision",
    actionType: "suspend_collection",
    actorType: "system",
    beforeSnapshot: { safety_status: "active", action_chain_id: "chain-suspend-collection" },
    afterSnapshot: { safety_status: "suspended", action_chain_id: "chain-suspend-collection" }
  });
  await pool.query(
    `UPDATE safety_cases
     SET status = 'awaiting_correction', correction_due_at = now() + interval '2 days'
     WHERE id IN ('case-revision', 'case-collection-revision')`
  );
}

async function submitPostRevision() {
  return withTransaction((client) => submitContentRevision(client, {
    caseId: "case-revision",
    ownerId: "u-owner",
    snapshot: revisedPostSnapshot(),
    objectKeys: ["post/u-owner/revision-evidence.jpg"]
  }));
}

async function submitCollectionRevision() {
  return withTransaction((client) => submitContentRevision(client, {
    caseId: "case-collection-revision",
    ownerId: "u-owner",
    snapshot: {
      name: "Revised collection",
      contactWechat: "revised-wechat",
      contactQQ: "revised-qq",
      contactGroupNumber: "revised-group",
      groupInfo: "Revised collection group information",
      deadline: "2031-02-03T04:05:06Z",
      defaultNote: "Revised default note"
    }
  }));
}

async function submitParentCollectionRevision() {
  return withTransaction((client) => submitContentRevision(client, {
    caseId: "case-parent-revision",
    ownerId: "u-owner",
    snapshot: {
      name: "Parent revised collection",
      contactWechat: "parent-revised-wechat",
      contactQQ: "parent-revised-qq",
      contactGroupNumber: "parent-revised-group",
      groupInfo: "Parent revised group information",
      deadline: "2032-03-04T05:06:07Z",
      defaultNote: "Parent revised default note"
    }
  }));
}

async function approvedPostRevision() {
  const revision = await submitPostRevision();
  await approveRevision(revision.id);
  return revision;
}

function approveRevision(revisionId, overrides = {}) {
  return withTransaction((client) => reviewContentRevision(client, {
    revisionId,
    moderation: async () => ({
      outcome: "pass",
      status: "active",
      riskLevel: "none",
      source: "textKeyword",
      reason: "Aliyun hard-safety pass",
      provider: "aliyun",
      rawSummary: { requestId: "req-safe" },
      ...overrides
    })
  }));
}

function approvedModerationResult(overrides = {}) {
  return {
    outcome: "pass",
    status: "active",
    riskLevel: "none",
    source: "textKeyword",
    reason: "hard-safety pass",
    rawSummary: { requestId: "req-safe" },
    ...overrides
  };
}

function persistTrustedAliyunReviewSummary(revisionId) {
  return pool.query(
    `UPDATE content_revisions
     SET review_summary = jsonb_set(review_summary, '{hardSafety,provider}', '"aliyun"'::jsonb)
     WHERE id = $1`,
    [revisionId]
  );
}

function adminApproval() {
  return { actorType: "admin", actorId: "admin-1", reason: "Approved corrected content" };
}

function policyApproval(qwenOverrides = {}) {
  return {
    actorType: "policy",
    qwenResult: validQwenResult(qwenOverrides),
    policyVersion: "policy-v7"
  };
}

function validQwenResult(overrides = {}) {
  return {
    category: "other",
    subjectType: "post",
    impactScope: "post",
    riskLevel: "none",
    confidence: 0.99,
    evidence: [{ source: "hard_signal", fact: "Aliyun passed" }],
    recommendedAction: "no_action",
    requiresHuman: false,
    summary: "Corrected content is safe to restore",
    ...overrides
  };
}

async function insertAppliedAction({
  id,
  caseId,
  actionType,
  actorType,
  actorId = null,
  beforeSnapshot = { action_chain_id: `chain-${id}` },
  afterSnapshot = { action_chain_id: `chain-${id}` }
}) {
  await pool.query(
    `INSERT INTO safety_actions (
       id, case_id, idempotency_key, action_type, target_type, target_id,
       actor_type, actor_id, reason, execution_status, before_snapshot, after_snapshot, applied_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, 'fixture restriction', 'applied', $9::jsonb, $10::jsonb, now()
     )`,
    [
      id,
      caseId,
      `fixture:${id}`,
      actionType,
      caseId === "case-collection-revision" ? "collection" : "post",
      caseId === "case-collection-revision" ? "collection-revision" : "p-original",
      actorType,
      actorId,
      JSON.stringify(beforeSnapshot),
      JSON.stringify(afterSnapshot)
    ]
  );
}

async function publicationPreservationState() {
  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM post_likes WHERE post_id = 'p-original') AS likes,
       (SELECT count(*)::int FROM post_favorites WHERE post_id = 'p-original') AS favorites,
       (SELECT count(*)::int FROM comments WHERE post_id = 'p-original') AS comments,
       (SELECT count(*)::int FROM reports WHERE subject_type = 'post' AND subject_id = 'p-original') AS reports,
       (SELECT count(*)::int FROM moderation_reviews WHERE target_type = 'post' AND target_id = 'p-original') AS moderation_reviews`
  );
  return rows[0];
}

async function postPublicationState(revisionId) {
  const { rows } = await pool.query(
    `SELECT p.title, p.safety_status, cr.status AS revision_status,
            sc.status AS case_status, sc.resolved_at,
            sa.execution_status AS action_status
     FROM posts p
     JOIN content_revisions cr ON cr.target_id = p.id
     JOIN safety_cases sc ON sc.id = cr.case_id
     JOIN safety_actions sa ON sa.id = 'action-hide-post'
     WHERE cr.id = $1`,
    [revisionId]
  );
  return rows[0];
}

async function countCaseEvents(eventType) {
  const { rows } = await pool.query(
    "SELECT count(*)::int AS count FROM safety_case_events WHERE event_type = $1",
    [eventType]
  );
  return rows[0].count;
}

async function countCaseEventsForCase(caseId, eventType) {
  const { rows } = await pool.query(
    "SELECT count(*)::int AS count FROM safety_case_events WHERE case_id = $1 AND event_type = $2",
    [caseId, eventType]
  );
  return rows[0].count;
}

async function withServer(callback) {
  const server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function request(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, body: await response.json() };
}

async function runResubmitRevisionRace(secondOperation) {
  const firstClient = await pool.connect();
  const secondClient = await pool.connect();
  const firstLocked = deferred();
  const secondAttempted = deferred();
  const releaseFirst = deferred();
  let firstPromise;
  let secondPromise;
  const caseLock = /SELECT \* FROM safety_cases WHERE id = \$1 FOR UPDATE/;
  const firstProxy = clientProxy(firstClient, async (sql, params) => {
    const result = await firstClient.query(sql, params);
    if (caseLock.test(String(sql))) {
      firstLocked.resolve();
      await releaseFirst.promise;
    }
    return result;
  });
  const secondProxy = clientProxy(secondClient, (sql, params) => {
    const pending = secondClient.query(sql, params);
    if (caseLock.test(String(sql)) || /zbt:safety-target/.test(String(sql))) secondAttempted.resolve();
    return pending;
  });

  try {
    await firstClient.query("BEGIN");
    await secondClient.query("BEGIN");
    firstPromise = settleTransaction(firstClient, () => submitContentRevision(firstProxy, {
      caseId: "case-revision",
      ownerId: "u-owner",
      snapshot: revisedPostSnapshot()
    }));
    await firstLocked.promise;
    secondPromise = settleTransaction(secondClient, () => secondOperation(secondProxy));
    await Promise.race([
      secondAttempted.promise,
      secondPromise.then(
        () => Promise.reject(new Error("revision operation completed before attempting the case lock")),
        (error) => Promise.reject(error)
      )
    ]);
    releaseFirst.resolve();
    return await withTimeout(Promise.allSettled([firstPromise, secondPromise]), 5_000);
  } finally {
    releaseFirst.resolve();
    await Promise.allSettled([firstPromise, secondPromise].filter(Boolean));
    await firstClient.query("ROLLBACK").catch(() => {});
    await secondClient.query("ROLLBACK").catch(() => {});
    firstClient.release();
    secondClient.release();
  }
}

async function settleTransaction(client, operation) {
  try {
    const result = await operation();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

function clientProxy(client, query) {
  return { query, release: client.release.bind(client) };
}

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("revision lock-order race timed out")), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

function deferred() {
  let resolve;
  const promise = new Promise((fulfill) => { resolve = fulfill; });
  return { promise, resolve };
}

function syncIdentity(event) {
  return `${event.userID}:${event.eventType}:${event.entityType}:${event.entityID}`;
}

function revisedPostSnapshot() {
  return {
    title: "Revised post",
    imageNames: ["revised.jpg"],
    imageObjectKeys: ["post/u-owner/revised.jpg"],
    previewImageObjectKeys: ["post/u-owner/revised-preview.jpg"],
    groupType: "splitGoods",
    categoryTags: ["revised-category"],
    fandomTags: ["revised-fandom"],
    price: "Revised price",
    deposit: "Revised deposit",
    condition: "Revised condition",
    isFormed: true,
    description: "Revised description",
    externalLink: "https://example.com/revised",
    imageAspect: 1.25,
    pingguAveragePrice: "Revised average",
    pingguNote: "Revised note",
    unsoldRoles: [{ id: "new", name: "New", quantity: 2, priceAdjustment: 0 }]
  };
}

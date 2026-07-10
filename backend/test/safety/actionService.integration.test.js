import assert from "node:assert/strict";
import test from "node:test";
import { withTransaction } from "../../src/db.js";
import { applySafetyAction, rollbackSafetyAction } from "../../src/safety/actionService.js";
import { isPostRowPubliclyVisible } from "../../src/safety/visibility.js";
import { closeDatabase, pool, resetDatabase } from "../helpers/database.js";

test.beforeEach(async () => {
  await resetDatabase();
  await seedSafetyActionTargets();
});

test.after(closeDatabase);

test("applies a collection suspension exactly once and restores only its effective visibility on rollback", async () => {
  const input = collectionActionInput();
  const first = await withTransaction((client) => applySafetyAction(client, input));
  const second = await withTransaction((client) => applySafetyAction(client, input));

  assert.equal(first.action.id, second.action.id);
  assert.equal(first.unchanged, false);
  assert.equal(second.unchanged, true);
  assert.equal(second.syncEvents.length, 0);
  assert.deepEqual(first.syncEvents.map((event) => event.userID).sort(), ["u-owner", "u-reporter"]);

  const collection = await pool.query("SELECT safety_status FROM group_collections WHERE id = 'collection-action'");
  const child = await pool.query("SELECT * FROM posts_with_safety_context WHERE id = 'post-action-child'");
  assert.equal(collection.rows[0].safety_status, "suspended");
  assert.equal(child.rows[0].safety_status, "active");
  assert.equal(isPostRowPubliclyVisible(child.rows[0]), false);

  const actionCount = await pool.query("SELECT count(*)::int AS count FROM safety_actions");
  const eventCount = await pool.query("SELECT count(*)::int AS count FROM safety_case_events");
  const syncCount = await pool.query("SELECT count(*)::int AS count FROM sync_events");
  assert.equal(actionCount.rows[0].count, 1);
  assert.equal(eventCount.rows[0].count, 1);
  assert.equal(syncCount.rows[0].count, 2);

  const rolledBack = await withTransaction((client) => rollbackSafetyAction(client, {
    actionId: first.action.id,
    actorType: "admin",
    actorId: "u-admin",
    reason: "collection information corrected"
  }));
  const repeatedRollback = await withTransaction((client) => rollbackSafetyAction(client, {
    actionId: first.action.id,
    actorType: "admin",
    actorId: "u-admin",
    reason: "collection information corrected"
  }));

  assert.equal(rolledBack.unchanged, false);
  assert.equal(repeatedRollback.unchanged, true);
  assert.equal(repeatedRollback.syncEvents.length, 0);
  const restored = await pool.query("SELECT * FROM posts_with_safety_context WHERE id = 'post-action-child'");
  assert.equal(restored.rows[0].collection_safety_status, "active");
  assert.equal(isPostRowPubliclyVisible(restored.rows[0]), true);

  const finalCounts = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM safety_case_events) AS events,
       (SELECT count(*)::int FROM sync_events) AS sync_events`
  );
  assert.deepEqual(finalCounts.rows[0], { events: 2, sync_events: 4 });
});

test("does not roll back a restriction still required by another active action", async () => {
  const first = await withTransaction((client) => applySafetyAction(client, collectionActionInput({
    caseId: "case-collection-secondary",
    idempotencyKey: "collection-suspend-secondary"
  })));
  const second = await withTransaction((client) => applySafetyAction(client, collectionActionInput({
    idempotencyKey: "collection-suspend-primary"
  })));

  await withTransaction((client) => rollbackSafetyAction(client, {
    actionId: first.action.id,
    actorType: "admin",
    actorId: "u-admin",
    reason: "first case resolved"
  }));

  const collection = await pool.query("SELECT safety_status FROM group_collections WHERE id = 'collection-action'");
  assert.equal(collection.rows[0].safety_status, "suspended");

  await withTransaction((client) => rollbackSafetyAction(client, {
    actionId: second.action.id,
    actorType: "admin",
    actorId: "u-admin",
    reason: "second case resolved"
  }));
  const restored = await pool.query("SELECT safety_status FROM group_collections WHERE id = 'collection-action'");
  assert.equal(restored.rows[0].safety_status, "active");
});

test("restores a mapped action chain to its original restricted baseline", async () => {
  await pool.query("UPDATE group_collections SET safety_status = 'suspended' WHERE id = 'collection-action'");
  const action = await withTransaction((client) => applySafetyAction(client, collectionActionInput({ idempotencyKey: "mapped-baseline" })));
  await rollback(action.action.id);
  const collection = await pool.query("SELECT safety_status FROM group_collections WHERE id = 'collection-action'");
  assert.equal(collection.rows[0].safety_status, "suspended");
});

test("restores the oldest baseline after all same-target mapped actions roll back", async () => {
  await pool.query("UPDATE group_collections SET safety_status = 'suspended' WHERE id = 'collection-action'");
  const oldest = await withTransaction((client) => applySafetyAction(client, collectionActionInput({ idempotencyKey: "mapped-oldest" })));
  const newest = await withTransaction((client) => applySafetyAction(client, collectionActionInput({
    caseId: "case-collection-secondary", idempotencyKey: "mapped-newest"
  })));
  await rollback(oldest.action.id);
  let collection = await pool.query("SELECT safety_status FROM group_collections WHERE id = 'collection-action'");
  assert.equal(collection.rows[0].safety_status, "suspended");
  await rollback(newest.action.id);
  collection = await pool.query("SELECT safety_status FROM group_collections WHERE id = 'collection-action'");
  assert.equal(collection.rows[0].safety_status, "suspended");
});

test("hides collection contact presentation without changing stored contact values", async () => {
  await pool.query(
    `UPDATE group_collections
     SET contact_wechat = 'wechat', contact_qq = 'qq', contact_group_number = 'group', group_info = 'group info'
     WHERE id = 'collection-action'`
  );
  await withTransaction((client) => applySafetyAction(client, collectionActionInput({
    actionType: "hide_collection_contact",
    idempotencyKey: "hide-collection-contact"
  })));

  const { rows } = await pool.query(
    "SELECT contact_visibility, contact_wechat, contact_qq, contact_group_number, group_info FROM group_collections WHERE id = 'collection-action'"
  );
  assert.deepEqual(rows[0], {
    contact_visibility: "hidden",
    contact_wechat: "wechat",
    contact_qq: "qq",
    contact_group_number: "group",
    group_info: "group info"
  });
});

test("allows only automatic safety actions and keeps notify and correction case-only", async () => {
  await assert.rejects(
    withTransaction((client) => applySafetyAction(client, collectionActionInput({ actionType: "suspend_user" }))),
    /不支持|unsupported/i
  );
  await assert.rejects(
    withTransaction((client) => applySafetyAction(client, collectionActionInput({
      actionType: "request_correction",
      idempotencyKey: "correction-without-deadline"
    }))),
    /整改期限|deadline/i
  );

  const notify = await withTransaction((client) => applySafetyAction(client, collectionActionInput({
    actionType: "notify_owner",
    idempotencyKey: "notify-owner"
  })));
  assert.deepEqual(notify.syncEvents.map((event) => event.userID), ["u-owner"]);
  let safetyCase = await pool.query("SELECT status, correction_due_at FROM safety_cases WHERE id = 'case-collection'");
  assert.deepEqual(safetyCase.rows[0], { status: "monitoring", correction_due_at: null });
  let collection = await pool.query("SELECT safety_status FROM group_collections WHERE id = 'collection-action'");
  assert.equal(collection.rows[0].safety_status, "active");

  const correctionDueAt = "2026-08-01T00:00:00.000Z";
  await withTransaction((client) => applySafetyAction(client, collectionActionInput({
    actionType: "request_correction",
    idempotencyKey: "request-correction",
    correctionDueAt
  })));
  safetyCase = await pool.query("SELECT status, correction_due_at FROM safety_cases WHERE id = 'case-collection'");
  assert.equal(safetyCase.rows[0].status, "awaiting_correction");
  assert.equal(safetyCase.rows[0].correction_due_at.toISOString(), correctionDueAt);
  const correctionAction = await pool.query("SELECT before_snapshot, after_snapshot FROM safety_actions WHERE idempotency_key = 'request-correction'");
  assert.equal(correctionAction.rows[0].before_snapshot.status, "monitoring");
  assert.equal(correctionAction.rows[0].before_snapshot.correction_due_at, null);
  assert.equal(correctionAction.rows[0].after_snapshot.status, "awaiting_correction");
  assert.equal(correctionAction.rows[0].after_snapshot.correction_due_at, correctionDueAt);
  assert.equal(typeof correctionAction.rows[0].after_snapshot.action_chain_id, "string");
  collection = await pool.query("SELECT safety_status FROM group_collections WHERE id = 'collection-action'");
  assert.equal(collection.rows[0].safety_status, "active");
});

test("rejects idempotency keys reused with a different immutable action payload", async () => {
  const input = collectionActionInput({
    actionType: "request_correction", idempotencyKey: "collision-key", correctionDueAt: "2026-08-01T00:00:00.000Z"
  });
  const first = await withTransaction((client) => applySafetyAction(client, input));
  const exactRetry = await withTransaction((client) => applySafetyAction(client, input));
  assert.equal(exactRetry.action.id, first.action.id);
  assert.equal(exactRetry.unchanged, true);

  const variants = [
    { reason: "different reason" },
    { actorId: "different-actor" },
    { actorType: "admin", actorId: "u-admin" },
    { correctionDueAt: "2026-08-02T00:00:00.000Z" },
    { caseId: "case-collection-secondary" },
    { actionType: "notify_owner" },
    { caseId: "case-user-collision", targetType: "user", targetId: "u-collision-owner" }
  ];
  await pool.query("INSERT INTO users (id, nickname) VALUES ('u-collision-owner', 'Collision owner')");
  await pool.query(`INSERT INTO safety_cases (id, subject_type, subject_id, category, impact_scope)
    VALUES ('case-user-collision', 'user', 'u-collision-owner', 'suspected_scam', 'user')`);
  for (const overrides of variants) {
    await assert.rejects(
      withTransaction((client) => applySafetyAction(client, { ...input, ...overrides })),
      (error) => error.status === 409
    );
  }
  const counts = await pool.query(`SELECT
    (SELECT count(*)::int FROM safety_actions) AS actions,
    (SELECT count(*)::int FROM safety_case_events) AS events,
    (SELECT count(*)::int FROM sync_events) AS sync_events`);
  assert.deepEqual(counts.rows[0], { actions: 1, events: 1, sync_events: 2 });
});

test("preserves the latest active correction through notify and mapped actions", async () => {
  const dueAt = "2026-08-10T00:00:00.000Z";
  await withTransaction((client) => applySafetyAction(client, collectionActionInput({
    actionType: "request_correction", idempotencyKey: "preserve-correction", correctionDueAt: dueAt
  })));
  await withTransaction((client) => applySafetyAction(client, collectionActionInput({
    actionType: "notify_owner", idempotencyKey: "preserve-notify"
  })));
  await withTransaction((client) => applySafetyAction(client, collectionActionInput({
    actionType: "suspend_collection", idempotencyKey: "preserve-suspend"
  })));
  const safetyCase = await pool.query("SELECT status, correction_due_at FROM safety_cases WHERE id = 'case-collection'");
  assert.equal(safetyCase.rows[0].status, "awaiting_correction");
  assert.equal(safetyCase.rows[0].correction_due_at.toISOString(), dueAt);
});

test("restores correction chains to their baseline in either rollback order", async () => {
  await pool.query("UPDATE safety_cases SET status = 'manual_review', correction_due_at = '2026-07-20T00:00:00.000Z' WHERE id = 'case-collection'");
  const first = await applyCorrection("chain-first", "2026-08-01T00:00:00.000Z");
  const second = await applyCorrection("chain-second", "2026-08-02T00:00:00.000Z");
  await rollback(first.action.id);
  await assertCaseState("awaiting_correction", "2026-08-02T00:00:00.000Z");
  await rollback(second.action.id);
  await assertCaseState("manual_review", "2026-07-20T00:00:00.000Z");

  const later = await applyCorrection("chain-later", "2026-08-03T00:00:00.000Z");
  await rollback(later.action.id);
  await assertCaseState("manual_review", "2026-07-20T00:00:00.000Z");
});

test("uses the latest remaining correction when rolled back newest-first", async () => {
  await pool.query("UPDATE safety_cases SET status = 'manual_review', correction_due_at = '2026-07-21T00:00:00.000Z' WHERE id = 'case-collection'");
  const first = await applyCorrection("reverse-first", "2026-08-04T00:00:00.000Z");
  const second = await applyCorrection("reverse-second", "2026-08-05T00:00:00.000Z");
  await rollback(second.action.id);
  await assertCaseState("awaiting_correction", "2026-08-04T00:00:00.000Z");
  await rollback(first.action.id);
  await assertCaseState("manual_review", "2026-07-21T00:00:00.000Z");
});

test("does not connect a new correction epoch to rolled-back history with matching values", async () => {
  await pool.query("UPDATE safety_cases SET status = 'awaiting_correction', correction_due_at = '2026-07-25T00:00:00.000Z' WHERE id = 'case-collection'");
  const old = await applyCorrection("epoch-old", "2026-08-06T00:00:00.000Z");
  await rollback(old.action.id);
  await pool.query("UPDATE safety_cases SET status = 'awaiting_correction', correction_due_at = '2026-08-06T00:00:00.000Z' WHERE id = 'case-collection'");
  const current = await applyCorrection("epoch-new", "2026-08-07T00:00:00.000Z");
  await rollback(current.action.id);
  await assertCaseState("awaiting_correction", "2026-08-06T00:00:00.000Z");
});

test("rolls back correction state within its own case only", async () => {
  const primary = await withTransaction((client) => applySafetyAction(client, collectionActionInput({
    actionType: "request_correction", idempotencyKey: "primary-correction", correctionDueAt: "2026-08-01T00:00:00.000Z"
  })));
  await withTransaction((client) => applySafetyAction(client, collectionActionInput({
    caseId: "case-collection-secondary", actionType: "request_correction", idempotencyKey: "secondary-correction", correctionDueAt: "2026-08-15T00:00:00.000Z"
  })));

  await withTransaction((client) => rollbackSafetyAction(client, {
    actionId: primary.action.id, actorType: "admin", actorId: "u-admin", reason: "primary correction withdrawn"
  }));
  const cases = await pool.query("SELECT id, status, correction_due_at FROM safety_cases WHERE id IN ('case-collection', 'case-collection-secondary') ORDER BY id");
  assert.deepEqual(cases.rows, [
    { id: "case-collection", status: "received", correction_due_at: null },
    { id: "case-collection-secondary", status: "awaiting_correction", correction_due_at: new Date("2026-08-15T00:00:00.000Z") }
  ]);
});

test("supports non-punitive notify and correction actions for a user case", async () => {
  await pool.query("INSERT INTO users (id, nickname) VALUES ('u-subject', 'Subject')");
  await pool.query(
    `INSERT INTO safety_cases (id, subject_type, subject_id, category, impact_scope)
     VALUES ('case-user', 'user', 'u-subject', 'suspected_scam', 'user')`
  );
  const base = {
    caseId: "case-user", targetType: "user", targetId: "u-subject", actorType: "system", actorId: "safety-automation", reason: "owner follow-up"
  };
  const notify = await withTransaction((client) => applySafetyAction(client, { ...base, actionType: "notify_owner", idempotencyKey: "user-notify" }));
  const correction = await withTransaction((client) => applySafetyAction(client, {
    ...base, actionType: "request_correction", idempotencyKey: "user-correction", correctionDueAt: "2026-08-20T00:00:00.000Z"
  }));
  assert.deepEqual(notify.syncEvents.map((event) => event.userID), ["u-subject"]);
  assert.deepEqual(correction.syncEvents.map((event) => event.userID), ["u-subject"]);
  const user = await pool.query("SELECT status FROM users WHERE id = 'u-subject'");
  assert.equal(user.rows[0].status, "active");
});

test("serializes concurrent retries with the same idempotency key", async () => {
  const input = collectionActionInput({ idempotencyKey: "concurrent-action-key" });
  const [first, second] = await Promise.all([transactionalAction(input), transactionalAction(input)]);
  assert.equal(first.action.id, second.action.id);
  assert.deepEqual([first.unchanged, second.unchanged].sort(), [false, true]);
  const counts = await pool.query(`SELECT
    (SELECT count(*)::int FROM safety_actions) AS actions,
    (SELECT count(*)::int FROM safety_case_events) AS events,
    (SELECT count(*)::int FROM sync_events) AS sync_events`);
  assert.deepEqual(counts.rows[0], { actions: 1, events: 1, sync_events: 2 });
});

test("concurrently rolls back same-target actions without deadlocking", async () => {
  const first = await withTransaction((client) => applySafetyAction(client, collectionActionInput({
    idempotencyKey: "rollback-concurrent-primary"
  })));
  const second = await withTransaction((client) => applySafetyAction(client, collectionActionInput({
    caseId: "case-collection-secondary", idempotencyKey: "rollback-concurrent-secondary"
  })));
  const results = await withTimeout(Promise.all([first, second].map((action) => transactionalRollback(action.action.id))), 3000);
  assert.equal(results.length, 2);
  const collection = await pool.query("SELECT safety_status FROM group_collections WHERE id = 'collection-action'");
  assert.equal(collection.rows[0].safety_status, "active");
});

function collectionActionInput(overrides = {}) {
  return {
    caseId: "case-collection",
    idempotencyKey: "collection-suspend-primary",
    actionType: "suspend_collection",
    targetType: "collection",
    targetId: "collection-action",
    actorType: "system",
    actorId: "safety-automation",
    reason: "reported collection information needs review",
    ...overrides
  };
}

async function seedSafetyActionTargets() {
  await pool.query(
    `INSERT INTO users (id, nickname)
     VALUES ('u-owner', 'Owner'), ('u-reporter', 'Reporter'), ('u-admin', 'Admin')`
  );
  await pool.query(
    `INSERT INTO group_collections (id, owner_id, name, deadline)
     VALUES ('collection-action', 'u-owner', 'Safety collection', now() + interval '1 day')`
  );
  await pool.query(
    `INSERT INTO posts (id, author_id, collection_id, title, deadline)
     VALUES ('post-action-child', 'u-owner', 'collection-action', 'Child post', now() + interval '1 day')`
  );
  await pool.query(
    `INSERT INTO safety_cases (id, subject_type, subject_id, category, impact_scope)
     VALUES
       ('case-collection', 'collection', 'collection-action', 'invalid_contact', 'collection'),
       ('case-collection-secondary', 'collection', 'collection-action', 'suspected_scam', 'collection')`
  );
  await pool.query(
    `INSERT INTO reports (
       id, target_type, target_id, reason, reporter_id, status, client_request_id,
       case_id, source_type, source_id, subject_type, subject_id, reason_code
     ) VALUES (
       'report-collection', 'collection', 'collection-action', 'incorrect collection contact', 'u-reporter', 'pending',
       'report-collection-request', 'case-collection', 'collection', 'collection-action', 'collection', 'collection-action', 'invalid_contact'
     )`
  );
}

async function transactionalAction(input) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await applySafetyAction(client, input);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function transactionalRollback(actionId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '1500ms'");
    await client.query("SET LOCAL statement_timeout = '2500ms'");
    const result = await rollbackSafetyAction(client, { actionId, actorType: "admin", actorId: "u-admin", reason: "concurrent rollback" });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function applyCorrection(idempotencyKey, correctionDueAt) {
  return withTransaction((client) => applySafetyAction(client, collectionActionInput({
    actionType: "request_correction", idempotencyKey, correctionDueAt
  })));
}

async function rollback(actionId) {
  return withTransaction((client) => rollbackSafetyAction(client, {
    actionId, actorType: "admin", actorId: "u-admin", reason: "correction rollback"
  }));
}

async function assertCaseState(status, correctionDueAt) {
  const { rows } = await pool.query("SELECT status, correction_due_at FROM safety_cases WHERE id = 'case-collection'");
  assert.equal(rows[0].status, status);
  assert.equal(rows[0].correction_due_at?.toISOString() || null, correctionDueAt);
}

async function withTimeout(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("concurrent rollback timed out")), milliseconds);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

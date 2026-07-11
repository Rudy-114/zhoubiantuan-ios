import assert from "node:assert/strict";
import test from "node:test";
import { query } from "../../src/db.js";
import {
  claimSafetyJobs,
  completeSafetyJob,
  enqueueSafetyJob,
  failSafetyJob,
  releaseSafetyJob
} from "../../src/safety/jobQueue.js";
import { startSafetyWorker } from "../../src/safety/jobWorker.js";
import { closeDatabase, resetDatabase } from "../helpers/database.js";

test.beforeEach(async () => {
  await resetDatabase();
});

test.after(async () => {
  await closeDatabase();
});

test("claims due jobs once across concurrent workers and preserves idempotent enqueue state", async () => {
  const first = await enqueueSafetyJob({
    type: "case_received",
    uniqueKey: "claim-1",
    payload: { ordinal: 1 }
  });
  await enqueueSafetyJob({ type: "case_received", uniqueKey: "claim-2", payload: { ordinal: 2 } });
  await enqueueSafetyJob({ type: "case_received", uniqueKey: "claim-3", payload: { ordinal: 3 } });

  const repeated = await enqueueSafetyJob({
    type: "analyze_case",
    uniqueKey: "claim-1",
    payload: { overwritten: true }
  });
  assert.equal(repeated.id, first.id);
  assert.equal(repeated.job_type, "case_received");
  assert.deepEqual(repeated.payload, { ordinal: 1 });

  const [workerA, workerB] = await Promise.all([
    claimSafetyJobs({ limit: 2, workerId: "worker-a" }),
    claimSafetyJobs({ limit: 2, workerId: "worker-b" })
  ]);
  const claimed = [...workerA, ...workerB];
  assert.equal(claimed.length, 3);
  assert.equal(new Set(claimed.map((job) => job.id)).size, 3);
  assert.ok(claimed.every((job) => ["worker-a", "worker-b"].includes(job.locked_by)));
  assert.ok(claimed.every((job) => job.status === "running" && job.attempts === 1));
});

test("excludes only planned deferred types while leaving other jobs claimable", async () => {
  const supported = await enqueueSafetyJob({ type: "case_received", uniqueKey: "eligible-case" });
  const deferred = await enqueueSafetyJob({ type: "analyze_case", uniqueKey: "eligible-analyze" });
  const unknown = await enqueueSafetyJob({ type: "unknown_job", uniqueKey: "eligible-unknown" });

  const claimed = await claimSafetyJobs({
    limit: 3,
    workerId: "worker-with-deferred",
    deferredJobTypes: ["analyze_case"]
  });
  assert.deepEqual(claimed.map((job) => job.id).sort(), [supported.id, unknown.id].sort());

  const { rows } = await query("SELECT status, attempts, locked_at, locked_by FROM safety_jobs WHERE id = $1", [deferred.id]);
  assert.deepEqual(rows[0], { status: "pending", attempts: 0, locked_at: null, locked_by: null });
});

test("recovers stale jobs, fences old owners, retries with bounded delays, and sanitizes errors", async () => {
  const job = await enqueueSafetyJob({ type: "case_received", uniqueKey: "retry-1" });
  const [firstClaim] = await claimSafetyJobs({ limit: 1, workerId: "worker-a" });
  assert.equal(firstClaim.id, job.id);

  await query("UPDATE safety_jobs SET locked_at = now() - interval '6 minutes' WHERE id = $1", [job.id]);
  const [reclaimed] = await claimSafetyJobs({ limit: 1, workerId: "worker-b" });
  assert.equal(reclaimed.id, job.id);
  assert.equal(reclaimed.attempts, 2);
  assert.equal(await completeSafetyJob({ jobId: job.id, workerId: "worker-a", leaseAttempt: firstClaim.attempts }), null);
  assert.equal(await failSafetyJob({ jobId: job.id, workerId: "worker-a", leaseAttempt: firstClaim.attempts, error: new Error("provider body=stale-owner-secret") }), null);

  const retry = await failSafetyJob({
    jobId: job.id,
    workerId: "worker-b",
    leaseAttempt: reclaimed.attempts,
    error: Object.assign(new Error("provider body=very-secret-token evidence text password=also-secret"), { code: "PROVIDER_TIMEOUT" })
  });
  assert.equal(retry.status, "pending");
  assert.equal(retry.attempts, 2);
  assert.match(retry.error_code, /^[A-Z0-9_]{1,64}$/);
  assert.match(retry.error_summary, /^[A-Za-z0-9_ ().:-]{1,300}$/);
  assert.doesNotMatch(retry.error_summary, /secret|provider|evidence|password/i);
  assert.equal(retry.locked_at, null);
  assert.equal(retry.locked_by, null);
  assertDelay(retry.run_at, 120);

  await query("UPDATE safety_jobs SET run_at = now() - interval '1 second' WHERE id = $1", [job.id]);
  const [thirdClaim] = await claimSafetyJobs({ limit: 1, workerId: "worker-c" });
  assert.equal(thirdClaim.attempts, 3);
  const terminal = await failSafetyJob({ jobId: job.id, workerId: "worker-c", leaseAttempt: thirdClaim.attempts, error: new Error("api_key=do-not-store") });
  assert.equal(terminal.status, "failed");
  assert.equal(terminal.locked_at, null);
  assert.equal(terminal.locked_by, null);
  assert.doesNotMatch(terminal.error_summary, /api_key|store/i);
});

test("applies thirty-second then two-minute retry delays before terminal failure", async () => {
  const job = await enqueueSafetyJob({ type: "case_received", uniqueKey: "retry-delays", maxAttempts: 3 });
  const [first] = await claimSafetyJobs({ limit: 1, workerId: "worker-a" });
  assert.equal(first.id, job.id);
  const firstRetry = await failSafetyJob({ jobId: job.id, workerId: "worker-a", leaseAttempt: first.attempts, error: new Error("untrusted") });
  assert.equal(firstRetry.status, "pending");
  assertDelay(firstRetry.run_at, 30);

  await query("UPDATE safety_jobs SET run_at = now() - interval '1 second' WHERE id = $1", [job.id]);
  const [second] = await claimSafetyJobs({ limit: 1, workerId: "worker-a" });
  assert.equal(second.attempts, 2);
  const secondRetry = await failSafetyJob({ jobId: job.id, workerId: "worker-a", leaseAttempt: second.attempts, error: new Error("untrusted") });
  assert.equal(secondRetry.status, "pending");
  assertDelay(secondRetry.run_at, 120);
});

test("terminal report cleanup is persistently reactivated only after a full cooldown", async () => {
  await query("INSERT INTO users (id, nickname) VALUES ('cleanup-owner', 'Cleanup owner')");
  const objectKey = "report/cleanup-owner/2026-07-12/long-outage.jpg";
  await query(
    `INSERT INTO report_uploads (object_key, owner_user_id, state, failure_count)
     VALUES ($1, 'cleanup-owner', 'deleting', 5)`,
    [objectKey]
  );
  const job = await enqueueSafetyJob({
    type: "cleanup_report_upload",
    uniqueKey: `cleanup_report_upload:${objectKey}`,
    payload: { objectKey },
    maxAttempts: 1
  });
  const [first] = await claimSafetyJobs({ limit: 1, workerId: "cleanup-first-cycle" });
  const terminal = await failSafetyJob({
    jobId: job.id,
    workerId: "cleanup-first-cycle",
    leaseAttempt: first.attempts,
    error: new Error("long OSS outage")
  });
  assert.equal(terminal.status, "failed");

  assert.deepEqual(await claimSafetyJobs({ limit: 1, workerId: "cleanup-too-soon" }), []);
  await query("UPDATE safety_jobs SET updated_at = now() - interval '23 hours' WHERE id = $1", [job.id]);
  assert.deepEqual(await claimSafetyJobs({ limit: 1, workerId: "cleanup-still-too-soon" }), []);
  const before = await query(
    "SELECT reactivation_count, last_reactivated_at FROM report_uploads WHERE object_key = $1",
    [objectKey]
  );
  assert.deepEqual(before.rows[0], { reactivation_count: 0, last_reactivated_at: null });

  await query("UPDATE safety_jobs SET updated_at = now() - interval '25 hours' WHERE id = $1", [job.id]);
  const [reactivated] = await claimSafetyJobs({ limit: 1, workerId: "cleanup-second-cycle" });
  assert.equal(reactivated.id, job.id);
  assert.equal(reactivated.status, "running");
  assert.equal(reactivated.attempts, 1);
  const observed = await query(
    `SELECT reactivation_count, last_reactivated_at IS NOT NULL AS has_reactivated_at
     FROM report_uploads
     WHERE object_key = $1`,
    [objectKey]
  );
  assert.deepEqual(observed.rows[0], { reactivation_count: 1, has_reactivated_at: true });
});

test("report cleanup uses staged backoff without changing ordinary job retry delays", async () => {
  const job = await enqueueSafetyJob({
    type: "cleanup_report_upload",
    uniqueKey: "cleanup_report_upload:report/retry-owner/2026-07-12/backoff.jpg",
    payload: { objectKey: "report/retry-owner/2026-07-12/backoff.jpg" },
    maxAttempts: 5
  });
  for (const [index, expectedDelay] of [300, 1_800, 7_200, 28_800].entries()) {
    const [claimed] = await claimSafetyJobs({ limit: 1, workerId: "cleanup-backoff" });
    assert.equal(claimed.id, job.id);
    assert.equal(claimed.attempts, index + 1);
    const retry = await failSafetyJob({
      jobId: job.id,
      workerId: "cleanup-backoff",
      leaseAttempt: claimed.attempts,
      error: new Error("untrusted provider outage")
    });
    assert.equal(retry.status, "pending");
    assertDelay(retry.run_at, expectedDelay);
    await query("UPDATE safety_jobs SET run_at = now() - interval '1 second' WHERE id = $1", [job.id]);
  }
});

test("report cleanup retention prunes only old resolved jobs and preserves recoverable or recent work", async () => {
  await query("INSERT INTO users (id, nickname) VALUES ('retention-owner', 'Retention owner')");
  const fixtures = [
    ["completed-old", "deleted", "completed", "31 days"],
    ["failed-resolved-old", "attached", "failed", "31 days"],
    ["failed-unresolved-old", "deleting", "failed", "31 days"],
    ["completed-recent", "deleted", "completed", "2 days"]
  ];
  for (const [name, state, status, age] of fixtures) {
    const objectKey = `report/retention-owner/2026-07-12/${name}.jpg`;
    await query(
      `INSERT INTO report_uploads (object_key, owner_user_id, state, deleted_at, attached_at, updated_at)
       VALUES (
         $1,
         'retention-owner',
         $2,
         CASE WHEN $2 = 'deleted' THEN now() - ($3::text)::interval END,
         CASE WHEN $2 = 'attached' THEN now() - ($3::text)::interval END,
         now() - ($3::text)::interval
       )`,
      [objectKey, state, age]
    );
    await query(
      `INSERT INTO safety_jobs (
         job_type, unique_key, payload, status, attempts, max_attempts,
         run_at, completed_at, error_code, error_summary, created_at, updated_at
       ) VALUES (
         'cleanup_report_upload',
         $1,
         jsonb_build_object('objectKey', $2::text),
         $3,
         CASE WHEN $3 = 'failed' THEN 5 ELSE 1 END,
         5,
         now() - ($4::text)::interval,
         CASE WHEN $3 = 'completed' THEN now() - ($4::text)::interval END,
         CASE WHEN $3 = 'failed' THEN 'SAFETY_JOB_FAILED' END,
         CASE WHEN $3 = 'failed' THEN 'Safety job failed (SAFETY_JOB_FAILED).' END,
         now() - ($4::text)::interval,
         now() - ($4::text)::interval
       )`,
      [`cleanup_report_upload:${objectKey}`, objectKey, status, age]
    );
  }

  await claimSafetyJobs({
    limit: 1,
    workerId: "cleanup-retention",
    deferredJobTypes: ["cleanup_report_upload"]
  });

  const remaining = await query(
    `SELECT replace(unique_key, 'cleanup_report_upload:report/retention-owner/2026-07-12/', '') AS name,
            status, attempts
     FROM safety_jobs
     WHERE job_type = 'cleanup_report_upload'
     ORDER BY name`
  );
  assert.deepEqual(remaining.rows, [
    { name: "completed-recent.jpg", status: "completed", attempts: 1 },
    { name: "failed-unresolved-old.jpg", status: "pending", attempts: 0 }
  ]);
  const unresolved = await query(
    `SELECT reactivation_count, last_reactivated_at IS NOT NULL AS has_reactivated_at
     FROM report_uploads
     WHERE object_key LIKE '%/failed-unresolved-old.jpg'`
  );
  assert.deepEqual(unresolved.rows[0], { reactivation_count: 1, has_reactivated_at: true });
});

test("completes only for the current owner and clears its lock and error fields", async () => {
  const job = await enqueueSafetyJob({ type: "case_received", uniqueKey: "complete-1" });
  const [claimed] = await claimSafetyJobs({ limit: 1, workerId: "worker-current" });
  assert.equal(claimed.id, job.id);
  await query("UPDATE safety_jobs SET error_code = 'OLD_ERROR', error_summary = 'Old error' WHERE id = $1", [job.id]);

  assert.equal(await completeSafetyJob({ jobId: job.id, workerId: "worker-stale", leaseAttempt: claimed.attempts }), null);
  const completed = await completeSafetyJob({ jobId: job.id, workerId: "worker-current", leaseAttempt: claimed.attempts });
  assert.equal(completed.status, "completed");
  assert.ok(completed.completed_at);
  assert.equal(completed.locked_at, null);
  assert.equal(completed.locked_by, null);
  assert.equal(completed.error_code, null);
  assert.equal(completed.error_summary, null);
});

test("stale recovery terminally fails exhausted jobs and never grants a fourth lease", async () => {
  const job = await enqueueSafetyJob({ type: "case_received", uniqueKey: "stale-terminal", maxAttempts: 3 });
  const claims = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const [claimed] = await claimSafetyJobs({ limit: 1, workerId: "worker-stale-loop" });
    assert.equal(claimed.id, job.id);
    assert.equal(claimed.attempts, attempt);
    claims.push(claimed);
    await query("UPDATE safety_jobs SET locked_at = now() - interval '6 minutes' WHERE id = $1", [job.id]);
  }

  assert.deepEqual(await claimSafetyJobs({ limit: 1, workerId: "worker-stale-loop" }), []);
  const { rows } = await query("SELECT status, attempts, locked_at, locked_by, error_code, error_summary FROM safety_jobs WHERE id = $1", [job.id]);
  assert.equal(rows[0].status, "failed");
  assert.equal(rows[0].attempts, 3);
  assert.equal(rows[0].locked_at, null);
  assert.equal(rows[0].locked_by, null);
  assert.match(rows[0].error_code, /^[A-Z0-9_]{1,64}$/);
  assert.match(rows[0].error_summary, /^[A-Za-z0-9_ ().:-]{1,300}$/);
  assert.equal(claims.length, 3);
});

test("same worker ID cannot complete or fail a later reclaimed lease", async () => {
  const completeJob = await enqueueSafetyJob({ type: "case_received", uniqueKey: "same-worker-complete" });
  const [firstComplete] = await claimSafetyJobs({ limit: 1, workerId: "worker-reused" });
  await query("UPDATE safety_jobs SET locked_at = now() - interval '6 minutes' WHERE id = $1", [completeJob.id]);
  const [secondComplete] = await claimSafetyJobs({ limit: 1, workerId: "worker-reused" });
  assert.equal(await completeSafetyJob({ jobId: completeJob.id, workerId: "worker-reused", leaseAttempt: firstComplete.attempts }), null);
  assert.equal((await completeSafetyJob({ jobId: completeJob.id, workerId: "worker-reused", leaseAttempt: secondComplete.attempts })).status, "completed");

  const failJob = await enqueueSafetyJob({ type: "case_received", uniqueKey: "same-worker-fail" });
  const [firstFail] = await claimSafetyJobs({ limit: 1, workerId: "worker-reused" });
  await query("UPDATE safety_jobs SET locked_at = now() - interval '6 minutes' WHERE id = $1", [failJob.id]);
  const [secondFail] = await claimSafetyJobs({ limit: 1, workerId: "worker-reused" });
  assert.equal(await failSafetyJob({ jobId: failJob.id, workerId: "worker-reused", leaseAttempt: firstFail.attempts, error: new Error("stale") }), null);
  assert.equal((await failSafetyJob({ jobId: failJob.id, workerId: "worker-reused", leaseAttempt: secondFail.attempts, error: new Error("current") })).status, "pending");
});

test("releases an unexecuted claimed lease without charging an attempt", async () => {
  const job = await enqueueSafetyJob({ type: "case_received", uniqueKey: "release-unexecuted" });
  const [claimed] = await claimSafetyJobs({ limit: 1, workerId: "worker-release" });
  const released = await releaseSafetyJob({ jobId: job.id, workerId: "worker-release", leaseAttempt: claimed.attempts });
  assert.equal(released.status, "pending");
  assert.equal(released.attempts, 0);
  assert.equal(released.locked_at, null);
  assert.equal(released.locked_by, null);
  const [reclaimed] = await claimSafetyJobs({ limit: 1, workerId: "worker-release" });
  assert.equal(reclaimed.attempts, 1);
});

test("worker completes supported jobs, terminally fails unknown jobs, and leaves deferred jobs pending", async () => {
  await Promise.all([1, 2, 3].map((ordinal) => enqueueSafetyJob({
    type: "known_job",
    uniqueKey: `worker-known-${ordinal}`
  })));
  await enqueueSafetyJob({ type: "unknown_job", uniqueKey: "worker-unknown", maxAttempts: 1 });
  await enqueueSafetyJob({ type: "analyze_case", uniqueKey: "worker-analyze", maxAttempts: 1 });

  let inFlight = 0;
  let peakInFlight = 0;
  const worker = startSafetyWorker({
    concurrency: 2,
    pollIntervalMs: 5,
    workerId: "worker-test",
    deferredJobTypes: ["analyze_case", "review_revision"],
    handlers: {
      async known_job() {
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight -= 1;
      }
    }
  });

  try {
    await waitFor(async () => {
      const { rows } = await query("SELECT job_type, status FROM safety_jobs ORDER BY id");
      return rows.filter((row) => row.job_type === "known_job").every((row) => row.status === "completed")
        && rows.some((row) => row.job_type === "unknown_job" && row.status === "failed");
    });

    assert.equal(peakInFlight, 2);
    const { rows } = await query("SELECT job_type, status, attempts, error_summary FROM safety_jobs ORDER BY job_type");
    assert.deepEqual(rows.map((row) => [row.job_type, row.status]), [
      ["analyze_case", "pending"],
      ["known_job", "completed"],
      ["known_job", "completed"],
      ["known_job", "completed"],
      ["unknown_job", "failed"]
    ]);
    assert.equal(rows[0].attempts, 0);
    assert.equal(rows[0].error_summary, null);
    assert.equal(rows[4].attempts, 1);
    assert.match(rows[4].error_summary, /^[A-Za-z0-9_ ().:-]{1,300}$/);
  } finally {
    await worker.stop();
  }
});

test("a deferred type becomes claimable once its handler is registered", async () => {
  await enqueueSafetyJob({ type: "analyze_case", uniqueKey: "worker-analyze-registered", maxAttempts: 1 });
  const worker = startSafetyWorker({
    pollIntervalMs: 5,
    workerId: "worker-analyze-registered",
    deferredJobTypes: ["analyze_case", "review_revision"],
    handlers: { analyze_case: async () => {} }
  });

  try {
    await waitFor(async () => {
      const { rows } = await query("SELECT status FROM safety_jobs WHERE unique_key = 'worker-analyze-registered'");
      return rows[0]?.status === "completed";
    });
  } finally {
    await worker.stop();
  }
});

test("worker retries transient claim failures with sanitized logs and recovers", async () => {
  let claims = 0;
  const completed = [];
  const logs = [];
  const worker = startSafetyWorker({
    pollIntervalMs: 5,
    workerId: "worker-claim-retry",
    handlers: { known_job: async () => {} },
    queue: {
      async claimSafetyJobs() {
        claims += 1;
        if (claims === 1) throw new Error("provider body=leaked evidence=leaked api_key=leaked");
        if (claims === 2) return [{ id: 42, job_type: "known_job", attempts: 1 }];
        return [];
      },
      async completeSafetyJob(input) {
        completed.push(input);
      },
      async failSafetyJob() {
        assert.fail("successful recovered job must not fail");
      }
    },
    eventLogger: { error(event, fields) { logs.push({ event, fields }); } }
  });

  await waitFor(() => completed.length === 1);
  await worker.stop();

  assert.ok(claims >= 2);
  assert.deepEqual(completed, [{ jobId: 42, workerId: "worker-claim-retry", leaseAttempt: 1 }]);
  assert.deepEqual(logs, [{ event: "safety_worker.claim_failed", fields: { errorCode: "SAFETY_JOB_FAILED" } }]);
  assert.doesNotMatch(JSON.stringify(logs), /provider|evidence|api_key|leaked/i);
});

test("worker stop waits for an in-flight completion update", async () => {
  const handler = deferred();
  const completion = deferred();
  const handlerStarted = deferred();
  const completionStarted = deferred();
  let claims = 0;
  const worker = startSafetyWorker({
    pollIntervalMs: 10_000,
    workerId: "worker-in-flight",
    handlers: {
      known_job: async () => {
        handlerStarted.resolve();
        await handler.promise;
      }
    },
    queue: {
      async claimSafetyJobs() {
        claims += 1;
        return claims === 1 ? [{ id: 7, job_type: "known_job", attempts: 1 }] : [];
      },
      async completeSafetyJob() {
        completionStarted.resolve();
        await completion.promise;
      },
      async failSafetyJob() {
        assert.fail("successful in-flight job must not fail");
      }
    }
  });

  await handlerStarted.promise;
  let stopped = false;
  const stop = worker.stop().then(() => { stopped = true; });
  handler.resolve();
  await completionStarted.promise;
  assert.equal(stopped, false);
  completion.resolve();
  await stop;
  assert.equal(stopped, true);
  assert.equal(claims, 1);
});

test("worker stop waits for an in-flight failure update", async () => {
  const handler = deferred();
  const failure = deferred();
  const handlerStarted = deferred();
  const failureStarted = deferred();
  let claims = 0;
  const worker = startSafetyWorker({
    pollIntervalMs: 10_000,
    workerId: "worker-failing-in-flight",
    handlers: {
      known_job: async () => {
        handlerStarted.resolve();
        await handler.promise;
        throw new Error("provider body=evidence text must not escape");
      }
    },
    queue: {
      async claimSafetyJobs() {
        claims += 1;
        return claims === 1 ? [{ id: 8, job_type: "known_job", attempts: 1 }] : [];
      },
      async completeSafetyJob() {
        assert.fail("failed in-flight job must not complete");
      },
      async failSafetyJob(input) {
        assert.equal(input.jobId, 8);
        assert.equal(input.workerId, "worker-failing-in-flight");
        assert.equal(input.leaseAttempt, 1);
        failureStarted.resolve();
        await failure.promise;
      }
    }
  });

  await handlerStarted.promise;
  let stopped = false;
  const stop = worker.stop().then(() => { stopped = true; });
  handler.resolve();
  await failureStarted.promise;
  assert.equal(stopped, false);
  failure.resolve();
  await stop;
  assert.equal(stopped, true);
  assert.equal(claims, 1);
});

test("stop during an in-flight claim releases the lease before any handler starts", async () => {
  const claimGate = deferred();
  const claimStarted = deferred();
  const releaseGate = deferred();
  let handlerCalls = 0;
  const releases = [];
  const worker = startSafetyWorker({
    pollIntervalMs: 10_000,
    workerId: "worker-claim-stop",
    handlers: { known_job: async () => { handlerCalls += 1; } },
    queue: {
      async claimSafetyJobs() {
        claimStarted.resolve();
        return claimGate.promise;
      },
      async releaseSafetyJob(input) {
        releases.push(input);
        await releaseGate.promise;
      },
      async completeSafetyJob() { assert.fail("stopped claim must not complete"); },
      async failSafetyJob() { assert.fail("stopped claim must not fail"); }
    }
  });

  try {
    await claimStarted.promise;
    let stopped = false;
    const stop = worker.stop().then(() => { stopped = true; });
    claimGate.resolve([{ id: 99, job_type: "known_job", attempts: 1 }]);
    await waitFor(() => releases.length === 1 || handlerCalls > 0);
    assert.equal(handlerCalls, 0);
    assert.equal(releases.length, 1);
    assert.equal(stopped, false);
    releaseGate.resolve();
    await stop;
    assert.deepEqual(releases, [{ jobId: 99, workerId: "worker-claim-stop", leaseAttempt: 1 }]);
  } finally {
    claimGate.resolve([]);
    releaseGate.resolve();
    await worker.stop();
  }
});

test("release failures are logged with a generic code while stop still settles", async () => {
  const claimGate = deferred();
  const claimStarted = deferred();
  const logs = [];
  const worker = startSafetyWorker({
    pollIntervalMs: 10_000,
    workerId: "worker-release-failure",
    handlers: { known_job: async () => { assert.fail("released job must not start"); } },
    queue: {
      async claimSafetyJobs() {
        claimStarted.resolve();
        return claimGate.promise;
      },
      async releaseSafetyJob() { throw new Error("release details must not log"); },
      async completeSafetyJob() { assert.fail("released job must not complete"); },
      async failSafetyJob() { assert.fail("released job must not fail"); }
    },
    eventLogger: { error(event, fields) { logs.push({ event, fields }); } }
  });

  try {
    await claimStarted.promise;
    const stop = worker.stop();
    claimGate.resolve([{ id: 100, job_type: "known_job", attempts: 1 }]);
    await stop;
    assert.deepEqual(logs, [{ event: "safety_worker.release_failed", fields: { errorCode: "SAFETY_JOB_FAILED" } }]);
    assert.doesNotMatch(JSON.stringify(logs), /details/i);
  } finally {
    claimGate.resolve([]);
    await worker.stop();
  }
});

test("idle worker stop interrupts its poll sleep promptly and is idempotent", async () => {
  const worker = startSafetyWorker({ pollIntervalMs: 10_000, workerId: "worker-idle", handlers: {} });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const startedAt = Date.now();
  await Promise.all([worker.stop(), worker.stop()]);
  assert.ok(Date.now() - startedAt < 250, "idle worker stop should not wait for poll interval");
});

function assertDelay(runAt, expectedSeconds) {
  const seconds = (new Date(runAt).getTime() - Date.now()) / 1000;
  assert.ok(seconds >= expectedSeconds - 5 && seconds <= expectedSeconds + 5, `expected ~${expectedSeconds}s delay, got ${seconds}s`);
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("timed out waiting for expected job state");
}

function deferred() {
  let resolve;
  const promise = new Promise((fulfill) => { resolve = fulfill; });
  return { promise, resolve };
}

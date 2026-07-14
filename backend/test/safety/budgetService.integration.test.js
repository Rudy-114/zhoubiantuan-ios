import assert from "node:assert/strict";
import test from "node:test";
import { releaseAiBudget, reserveAiBudget, settleAiBudget } from "../../src/safety/budgetService.js";
import { closeDatabase, pool, resetDatabase } from "../helpers/database.js";

const NOW = new Date("2026-07-14T08:00:00.000Z");

test.beforeEach(async () => {
  await resetDatabase();
  await seedRuns([
    "run-zero",
    "run-concurrent-a",
    "run-concurrent-b",
    "run-settle",
    "run-release",
    "run-uncertain"
  ]);
});

test.after(closeDatabase);

test("zero budget blocks before a caller can invoke the provider", async () => {
  let providerCalls = 0;
  const reservation = await transaction((client) => reserveAiBudget(client, {
    aiRunId: "run-zero",
    messages: [{ role: "user", content: "bounded evidence" }],
    monthlyBudgetCny: 0,
    inputCnyPerMillion: 2,
    outputCnyPerMillion: 6,
    maxCompletionTokens: 900,
    now: NOW
  }));
  if (reservation.ok) providerCalls += 1;

  assert.deepEqual(reservation, {
    ok: false,
    reason: "budget_disabled",
    monthKey: "2026-07"
  });
  assert.equal(providerCalls, 0);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM safety_ai_usage")).rows[0].count, 0);
});

test("serializes concurrent reservations so only one can cross a near-cap budget", async () => {
  const input = {
    messages: [{ role: "user", content: "same bounded evidence" }],
    monthlyBudgetCny: 0.7,
    inputCnyPerMillion: 1,
    outputCnyPerMillion: 500,
    maxCompletionTokens: 900,
    now: NOW
  };

  const [first, second] = await Promise.all([
    transaction((client) => reserveAiBudget(client, { ...input, aiRunId: "run-concurrent-a" })),
    transaction((client) => reserveAiBudget(client, { ...input, aiRunId: "run-concurrent-b" }))
  ]);

  const results = [first, second];
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => result.reason === "budget_exceeded").length, 1);

  const usage = await pool.query(
    "SELECT ai_run_id, month_key, reserved_cny::text, status FROM safety_ai_usage ORDER BY ai_run_id"
  );
  assert.equal(usage.rows.length, 1);
  assert.equal(usage.rows[0].month_key, "2026-07");
  assert.equal(usage.rows[0].status, "reserved");
  assert.ok(Number(usage.rows[0].reserved_cny) > 0.45);
  assert.ok(Number(usage.rows[0].reserved_cny) < 0.7);
});

test("reuses only same-month reservations that still cover the current maximum estimate", async () => {
  const input = {
    aiRunId: "run-release",
    messages: [{ role: "user", content: "bounded evidence" }],
    monthlyBudgetCny: 10,
    inputCnyPerMillion: 2,
    outputCnyPerMillion: 6,
    maxCompletionTokens: 900,
    now: NOW
  };
  const first = await transaction((client) => reserveAiBudget(client, input));
  const same = await transaction((client) => reserveAiBudget(client, input));
  const underpriced = await transaction((client) => reserveAiBudget(client, {
    ...input,
    outputCnyPerMillion: 6_000
  }));
  const expired = await transaction((client) => reserveAiBudget(client, {
    ...input,
    now: new Date("2026-08-01T00:00:00.000Z")
  }));

  assert.equal(first.ok, true);
  assert.equal(same.ok, true);
  assert.equal(same.existing, true);
  assert.deepEqual(underpriced, {
    ok: false,
    reason: "reservation_mismatch",
    monthKey: "2026-07"
  });
  assert.deepEqual(expired, {
    ok: false,
    reason: "reservation_expired",
    monthKey: "2026-07"
  });
  assert.equal(
    (await pool.query("SELECT count(*)::int AS count FROM safety_ai_usage WHERE ai_run_id = 'run-release'")).rows[0].count,
    1
  );
});

test("settles token-derived actual cost, releases unused reservations, and keeps spend nonnegative", async () => {
  const pricing = {
    messages: [{ role: "user", content: "结算证据" }],
    monthlyBudgetCny: 1,
    inputCnyPerMillion: 2,
    outputCnyPerMillion: 6,
    maxCompletionTokens: 900,
    now: NOW
  };
  await transaction((client) => reserveAiBudget(client, { ...pricing, aiRunId: "run-settle" }));
  await transaction((client) => reserveAiBudget(client, { ...pricing, aiRunId: "run-release" }));

  const settled = await transaction((client) => settleAiBudget(client, {
    aiRunId: "run-settle",
    inputTokens: 100,
    outputTokens: 50,
    inputCnyPerMillion: 2,
    outputCnyPerMillion: 6,
    now: NOW
  }));
  const released = await transaction((client) => releaseAiBudget(client, {
    aiRunId: "run-release",
    now: NOW
  }));

  assert.deepEqual(settled, {
    ok: true,
    actualCny: 0.0005,
    inputTokens: 100,
    outputTokens: 50,
    monthKey: "2026-07"
  });
  assert.deepEqual(released, { ok: true, monthKey: "2026-07", released: true });

  const usage = await pool.query(
    `SELECT ai_run_id, reserved_cny::text, actual_cny::text, status
     FROM safety_ai_usage
     ORDER BY ai_run_id`
  );
  assert.equal(usage.rows.find((row) => row.ai_run_id === "run-settle").status, "settled");
  assert.equal(Number(usage.rows.find((row) => row.ai_run_id === "run-settle").actual_cny), 0.0005);
  assert.equal(usage.rows.find((row) => row.ai_run_id === "run-release").status, "released");
  assert.equal(usage.rows.find((row) => row.ai_run_id === "run-release").actual_cny, null);

  const total = await pool.query(
    `SELECT COALESCE(sum(
       CASE status
         WHEN 'reserved' THEN reserved_cny
         WHEN 'settled' THEN COALESCE(actual_cny, reserved_cny)
         ELSE 0
       END
     ), 0)::text AS value
     FROM safety_ai_usage
     WHERE month_key = '2026-07'`
  );
  assert.equal(Number(total.rows[0].value), 0.0005);
  assert.ok(Number(total.rows[0].value) >= 0);
});

test("settles an uncertain provider timeout at the full reservation", async () => {
  const reservation = await transaction((client) => reserveAiBudget(client, {
    aiRunId: "run-uncertain",
    messages: [{ role: "user", content: "可能已计费的请求" }],
    monthlyBudgetCny: 1,
    inputCnyPerMillion: 2,
    outputCnyPerMillion: 6,
    maxCompletionTokens: 900,
    now: NOW
  }));
  const settled = await transaction((client) => settleAiBudget(client, {
    aiRunId: "run-uncertain",
    inputTokens: 0,
    outputTokens: 0,
    uncertain: true,
    now: NOW
  }));

  assert.equal(settled.conservative, true);
  assert.equal(settled.actualCny, reservation.reservedCny);
  const usage = await pool.query(
    "SELECT reserved_cny::text, actual_cny::text, status FROM safety_ai_usage WHERE ai_run_id = 'run-uncertain'"
  );
  assert.equal(usage.rows[0].status, "settled");
  assert.equal(Number(usage.rows[0].actual_cny), Number(usage.rows[0].reserved_cny));
});

async function seedRuns(runIds) {
  for (const [index, runId] of runIds.entries()) {
    const caseId = `budget-case-${index}`;
    const ownerId = `budget-owner-${index}`;
    await pool.query("INSERT INTO users (id, nickname) VALUES ($1, 'Budget Owner')", [ownerId]);
    await pool.query(
      `INSERT INTO safety_cases (id, subject_type, subject_id, category, impact_scope)
       VALUES ($1, 'user', $2, 'other', 'user')`,
      [caseId, ownerId]
    );
    await pool.query(
      `INSERT INTO safety_ai_runs (
         id, case_id, model_version, prompt_version, policy_version,
         evidence_hash, mode, status
       ) VALUES ($1, $2, 'model-v1', 'prompt-v1', 'policy-v1', $3, 'shadow', 'reserved')`,
      [runId, caseId, `hash-${index}`]
    );
  }
}

async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await callback(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

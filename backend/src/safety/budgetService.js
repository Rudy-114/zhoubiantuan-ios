import { randomUUID } from "node:crypto";

const TRANSACTION_PROBE_SAVEPOINT = "safety_ai_budget_probe";
const MONEY_SCALE = 1_000_000;

export async function reserveAiBudget(client, input = {}) {
  assertTransactionClient(client);
  await assertActiveTransaction(client);

  const now = validDate(input.now);
  const monthKey = utcMonthKey(now);
  const monthlyBudgetCny = nonNegativeMoney(input.monthlyBudgetCny, "monthlyBudgetCny");
  if (monthlyBudgetCny === 0) {
    return { ok: false, reason: "budget_disabled", monthKey };
  }

  const aiRunId = requiredId(input.aiRunId);
  const inputRate = nonNegativeMoney(input.inputCnyPerMillion, "inputCnyPerMillion");
  const outputRate = nonNegativeMoney(input.outputCnyPerMillion, "outputCnyPerMillion");
  const maxCompletionTokens = positiveInteger(input.maxCompletionTokens, "maxCompletionTokens");
  const serializedMessages = serializeMessages(input.messages);
  const estimatedInputTokens = Buffer.byteLength(serializedMessages, "utf8");
  const reservedCny = ceilMoney(
    ((estimatedInputTokens * inputRate) + (maxCompletionTokens * outputRate)) / MONEY_SCALE
  );

  await lockMonth(client, monthKey);
  const existing = await client.query(
    `SELECT month_key, reserved_cny, actual_cny, status
     FROM safety_ai_usage
     WHERE ai_run_id = $1
     FOR UPDATE`,
    [aiRunId]
  );
  if (existing.rows[0]) {
    return existingReservation(existing.rows[0], {
      monthKey,
      reservedCny,
      estimatedInputTokens,
      maxCompletionTokens
    });
  }

  const spend = await client.query(
    `SELECT COALESCE(sum(
       CASE status
         WHEN 'reserved' THEN reserved_cny
         WHEN 'settled' THEN COALESCE(actual_cny, reserved_cny)
         ELSE 0
       END
     ), 0) AS committed_cny
     FROM safety_ai_usage
     WHERE month_key = $1`,
    [monthKey]
  );
  const committedCny = Number(spend.rows[0].committed_cny);
  if (committedCny + reservedCny > monthlyBudgetCny) {
    return {
      ok: false,
      reason: "budget_exceeded",
      monthKey,
      reservedCny,
      committedCny
    };
  }

  const usageId = `saiu-${randomUUID()}`;
  await client.query(
    `INSERT INTO safety_ai_usage (
       id, ai_run_id, month_key, reserved_cny, status, created_at
     ) VALUES ($1, $2, $3, $4, 'reserved', $5)`,
    [usageId, aiRunId, monthKey, reservedCny, now]
  );
  return {
    ok: true,
    usageId,
    monthKey,
    reservedCny,
    estimatedInputTokens,
    maxCompletionTokens
  };
}

export async function settleAiBudget(client, input = {}) {
  assertTransactionClient(client);
  await assertActiveTransaction(client);

  const aiRunId = requiredId(input.aiRunId);
  const now = validDate(input.now);
  const initial = await loadUsage(client, aiRunId);
  await lockMonth(client, initial.month_key);
  const usage = (await loadUsage(client, aiRunId, { forUpdate: true }));

  if (usage.status === "released") throw budgetError("released_reservation");
  if (usage.status === "settled") {
    const run = await loadRunUsage(client, aiRunId);
    return settledResult(usage, run.input_tokens, run.output_tokens);
  }

  const inputTokens = nonNegativeInteger(input.inputTokens, "inputTokens");
  const outputTokens = nonNegativeInteger(input.outputTokens, "outputTokens");
  const conservative = input.uncertain === true;
  const actualCny = conservative
    ? Number(usage.reserved_cny)
    : roundMoney(
      ((inputTokens * nonNegativeMoney(input.inputCnyPerMillion, "inputCnyPerMillion")) +
       (outputTokens * nonNegativeMoney(input.outputCnyPerMillion, "outputCnyPerMillion"))) / MONEY_SCALE
    );

  await client.query(
    `UPDATE safety_ai_usage
     SET actual_cny = $2, status = 'settled', settled_at = $3
     WHERE ai_run_id = $1 AND status = 'reserved'`,
    [aiRunId, actualCny, now]
  );
  await client.query(
    `UPDATE safety_ai_runs
     SET input_tokens = $2, output_tokens = $3, estimated_cost_cny = $4
     WHERE id = $1`,
    [aiRunId, inputTokens, outputTokens, actualCny]
  );

  return {
    ...settledResult({ ...usage, actual_cny: actualCny, status: "settled" }, inputTokens, outputTokens),
    ...(conservative ? { conservative: true } : {})
  };
}

export async function releaseAiBudget(client, input = {}) {
  assertTransactionClient(client);
  await assertActiveTransaction(client);

  const aiRunId = requiredId(input.aiRunId);
  const now = validDate(input.now);
  const initial = await loadUsage(client, aiRunId);
  await lockMonth(client, initial.month_key);
  const usage = await loadUsage(client, aiRunId, { forUpdate: true });
  if (usage.status === "settled") throw budgetError("settled_reservation");
  if (usage.status === "released") {
    return { ok: true, monthKey: usage.month_key, released: false };
  }

  await client.query(
    `UPDATE safety_ai_usage
     SET status = 'released', actual_cny = NULL, settled_at = $2
     WHERE ai_run_id = $1 AND status = 'reserved'`,
    [aiRunId, now]
  );
  return { ok: true, monthKey: usage.month_key, released: true };
}

async function lockMonth(client, monthKey) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('safety-ai-budget:' || $1::text))",
    [monthKey]
  );
}

async function loadUsage(client, aiRunId, { forUpdate = false } = {}) {
  const result = await client.query(
    `SELECT month_key, reserved_cny, actual_cny, status
     FROM safety_ai_usage
     WHERE ai_run_id = $1${forUpdate ? " FOR UPDATE" : ""}`,
    [aiRunId]
  );
  if (!result.rows[0]) throw budgetError("reservation_not_found");
  return result.rows[0];
}

async function loadRunUsage(client, aiRunId) {
  const result = await client.query(
    "SELECT input_tokens, output_tokens FROM safety_ai_runs WHERE id = $1",
    [aiRunId]
  );
  if (!result.rows[0]) throw budgetError("run_not_found");
  return result.rows[0];
}

function existingReservation(row, { monthKey, reservedCny, estimatedInputTokens, maxCompletionTokens }) {
  if (row.status !== "reserved") {
    return { ok: false, reason: `already_${row.status}`, monthKey: row.month_key };
  }
  if (row.month_key !== monthKey) {
    return { ok: false, reason: "reservation_expired", monthKey: row.month_key };
  }
  if (Number(row.reserved_cny) < reservedCny) {
    return { ok: false, reason: "reservation_mismatch", monthKey: row.month_key };
  }
  return {
    ok: true,
    monthKey: row.month_key,
    reservedCny: Number(row.reserved_cny),
    estimatedInputTokens,
    maxCompletionTokens,
    existing: true
  };
}

function settledResult(usage, inputTokens, outputTokens) {
  return {
    ok: true,
    actualCny: Number(usage.actual_cny),
    inputTokens: Number(inputTokens),
    outputTokens: Number(outputTokens),
    monthKey: usage.month_key
  };
}

function serializeMessages(messages) {
  if (!Array.isArray(messages)) throw budgetError("invalid_messages");
  const serialized = JSON.stringify(messages);
  if (typeof serialized !== "string") throw budgetError("invalid_messages");
  return serialized;
}

function requiredId(value) {
  if (typeof value !== "string" || !value.trim() || Array.from(value.trim()).length > 160) {
    throw budgetError("invalid_ai_run_id");
  }
  return value.trim();
}

function validDate(value) {
  const date = value == null ? new Date() : value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) throw budgetError("invalid_date");
  return date;
}

function utcMonthKey(date) {
  return date.toISOString().slice(0, 7);
}

function nonNegativeMoney(value, field) {
  if (!Number.isFinite(value) || value < 0) throw budgetError(`invalid_${field}`);
  return value;
}

function positiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) throw budgetError(`invalid_${field}`);
  return value;
}

function nonNegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw budgetError(`invalid_${field}`);
  return value;
}

function ceilMoney(value) {
  if (value === 0) return 0;
  return Math.ceil(value * MONEY_SCALE) / MONEY_SCALE;
}

function roundMoney(value) {
  return Math.round(value * MONEY_SCALE) / MONEY_SCALE;
}

function assertTransactionClient(client) {
  if (!client || typeof client.query !== "function" || typeof client.release !== "function") {
    throw new TypeError("AI budget operations require a transaction-scoped pg PoolClient");
  }
}

async function assertActiveTransaction(client) {
  try {
    await client.query(`SAVEPOINT ${TRANSACTION_PROBE_SAVEPOINT}`);
    await client.query(`RELEASE SAVEPOINT ${TRANSACTION_PROBE_SAVEPOINT}`);
  } catch (error) {
    const developerError = new TypeError("AI budget operations require an active transaction");
    developerError.cause = error;
    throw developerError;
  }
}

function budgetError(reason) {
  const error = new Error("AI budget operation failed");
  error.code = "invalid_ai_budget";
  error.reason = reason;
  return error;
}

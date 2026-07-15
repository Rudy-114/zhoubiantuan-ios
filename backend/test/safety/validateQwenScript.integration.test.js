import assert from "node:assert/strict";
import test from "node:test";
import { validateQwenOnce } from "../../scripts/validate-qwen.js";
import { releaseAiBudget, reserveAiBudget, settleAiBudget } from "../../src/safety/budgetService.js";
import { buildQwenCaseMessages, hashCaseEvidence } from "../../src/safety/promptBuilder.js";
import { validateQwenCaseResult } from "../../src/safety/schemas/qwenCaseResult.js";
import { closeDatabase, pool, resetDatabase } from "../helpers/database.js";

const NOW = new Date("2026-07-15T02:00:00.000Z");
const AI_CONFIG = Object.freeze({
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  apiKey: "integration-test-key-never-print",
  model: "qwen3.7-plus-2026-05-26",
  promptVersion: "safety-case-prompt-v1",
  policyVersion: "safety-policy-v1",
  monthlyBudgetCny: 1,
  inputCnyPerMillion: 2,
  outputCnyPerMillion: 6,
  maxCompletionTokens: 900
});

test.beforeEach(resetDatabase);
test.after(closeDatabase);

test("reserves, calls once, validates, settles, and marks one synthetic run", async () => {
  let providerCalls = 0;
  const provider = {
    async analyze() {
      providerCalls += 1;
      return {
        result: validInvalidContactResult(),
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        requestId: "synthetic-request-1",
        rawContent: "raw synthetic provider content must not persist"
      };
    }
  };
  const dependencies = validationDependencies({ provider });

  const summary = await validateQwenOnce({
    mode: "shadow",
    autoActionsEnabled: false,
    aiConfig: AI_CONFIG,
    now: NOW,
    ...dependencies
  });

  assert.deepEqual(summary, {
    model: AI_CONFIG.model,
    requestId: "synthetic-request-1",
    inputTokens: 100,
    outputTokens: 50,
    estimatedCostCny: 0.0005,
    pass: true
  });
  assert.equal(providerCalls, 1);
  const run = (await pool.query(
    `SELECT is_synthetic, status, raw_response, parsed_result, error_code,
            input_tokens, output_tokens, estimated_cost_cny
     FROM safety_ai_runs`
  )).rows[0];
  assert.equal(run.is_synthetic, true);
  assert.equal(run.status, "completed");
  assert.equal(run.raw_response, "");
  assert.equal(run.parsed_result.category, "invalid_contact");
  assert.equal(run.error_code, null);
  assert.equal(run.input_tokens, 100);
  assert.equal(run.output_tokens, 50);
  assert.equal(Number(run.estimated_cost_cny), 0.0005);
  assert.deepEqual((await pool.query(
    "SELECT status, actual_cny FROM safety_ai_usage"
  )).rows[0], { status: "settled", actual_cny: "0.000500" });
  const syntheticCase = (await pool.query(
    "SELECT subject_type, subject_id, category, impact_scope, status FROM safety_cases"
  )).rows[0];
  assert.equal(syntheticCase.subject_type, "collection");
  assert.match(syntheticCase.subject_id, /^synthetic-qwen-validation-/u);
  assert.deepEqual(
    { category: syntheticCase.category, impactScope: syntheticCase.impact_scope, status: syntheticCase.status },
    { category: "invalid_contact", impactScope: "collection", status: "resolved_no_action" }
  );

  await assert.rejects(
    validateQwenOnce({
      mode: "shadow",
      autoActionsEnabled: false,
      aiConfig: AI_CONFIG,
      now: new Date(NOW.getTime() + 1_000),
      ...dependencies
    }),
    (error) => error?.code === "validation_already_attempted"
  );
  assert.equal(providerCalls, 1);
});

test("concurrent confirmed attempts construct and call the provider exactly once", async () => {
  let providerFactoryCalls = 0;
  let providerCalls = 0;
  let signalProviderEntered;
  let releaseProvider;
  const providerEntered = new Promise((resolve) => { signalProviderEntered = resolve; });
  const providerRelease = new Promise((resolve) => { releaseProvider = resolve; });
  const dependencies = validationDependencies({
    providerFactory: () => {
      providerFactoryCalls += 1;
      return {
        async analyze() {
          providerCalls += 1;
          signalProviderEntered();
          await providerRelease;
          return {
            result: validInvalidContactResult(),
            usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
            requestId: "synthetic-concurrent-request",
            rawContent: "concurrent synthetic raw content must not persist"
          };
        }
      };
    }
  });
  const first = validateQwenOnce({
    mode: "shadow",
    autoActionsEnabled: false,
    aiConfig: AI_CONFIG,
    now: NOW,
    ...dependencies
  });

  try {
    await providerEntered;
    await assert.rejects(
      validateQwenOnce({
        mode: "shadow",
        autoActionsEnabled: false,
        aiConfig: AI_CONFIG,
        now: new Date(NOW.getTime() + 1_000),
        ...dependencies
      }),
      (error) => error?.code === "validation_already_attempted"
    );
    assert.equal(providerFactoryCalls, 1);
    assert.equal(providerCalls, 1);
  } finally {
    releaseProvider();
  }

  assert.equal((await first).pass, true);
  assert.deepEqual((await pool.query(
    `SELECT
       (SELECT count(*)::int FROM safety_cases) AS cases,
       (SELECT count(*)::int FROM safety_ai_runs) AS runs,
       (SELECT count(*)::int FROM safety_ai_usage) AS usage`
  )).rows[0], { cases: 1, runs: 1, usage: 1 });
});

test("zero budget records a synthetic block before constructing or calling provider", async () => {
  let providerFactoryCalls = 0;

  const summary = await validateQwenOnce({
    mode: "shadow",
    autoActionsEnabled: false,
    aiConfig: { ...AI_CONFIG, monthlyBudgetCny: 0 },
    now: NOW,
    ...validationDependencies({
      providerFactory: () => {
        providerFactoryCalls += 1;
        return { analyze: async () => assert.fail("provider must not run") };
      }
    })
  });

  assert.deepEqual(summary, {
    model: AI_CONFIG.model,
    requestId: "",
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostCny: 0,
    pass: false
  });
  assert.equal(providerFactoryCalls, 0);
  assert.deepEqual((await pool.query(
    "SELECT is_synthetic, status, error_code FROM safety_ai_runs"
  )).rows[0], { is_synthetic: true, status: "budget_blocked", error_code: "budget_disabled" });
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM safety_ai_usage")).rows[0].count, 0);
});

function validationDependencies({ provider, providerFactory } = {}) {
  return {
    withTransaction: transaction,
    reserveBudget: reserveAiBudget,
    settleBudget: settleAiBudget,
    releaseBudget: releaseAiBudget,
    buildMessages: buildQwenCaseMessages,
    hashEvidence: hashCaseEvidence,
    validateResult: validateQwenCaseResult,
    providerFactory: providerFactory || (() => provider)
  };
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

function validInvalidContactResult() {
  return {
    category: "invalid_contact",
    subjectType: "collection",
    impactScope: "collection",
    riskLevel: "medium",
    confidence: 0.95,
    evidence: [{ source: "source_snapshot", fact: "The synthetic contact channel is unavailable." }],
    recommendedAction: "request_correction",
    requiresHuman: true,
    summary: "The synthetic collection contact requires correction."
  };
}

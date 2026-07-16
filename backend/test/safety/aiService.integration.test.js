import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSafetyCase } from "../../src/safety/aiService.js";
import { supplementSafetyReport } from "../../src/safety/caseService.js";
import { createAnalyzeCaseJobHandler, startSafetyWorker } from "../../src/safety/jobWorker.js";
import { providerError, QwenCaseProvider } from "../../src/safety/providers/qwenCaseProvider.js";
import { closeDatabase, pool, resetDatabase } from "../helpers/database.js";

const NOW = new Date("2026-07-14T08:00:00.000Z");
const AI_CONFIG = Object.freeze({
  model: "qwen3.7-plus-2026-05-26",
  promptVersion: "safety-case-prompt-v1",
  policyVersion: "safety-policy-v2",
  monthlyBudgetCny: 10,
  inputCnyPerMillion: 2,
  outputCnyPerMillion: 6,
  maxCompletionTokens: 900
});

test.beforeEach(resetDatabase);
test.after(closeDatabase);

test("reuses a completed evidence hash without a duplicate provider call", async () => {
  await seedPostCase({ category: "other" });
  let providerCalls = 0;
  let moderationCalls = 0;
  const provider = {
    async analyze() {
      providerCalls += 1;
      return providerOutput(validResult({ category: "other" }));
    }
  };
  const moderation = async () => {
    moderationCalls += 1;
    return passModeration();
  };

  const first = await analyze({ provider, moderation });
  const second = await analyze({ provider, moderation });

  assert.equal(first.status, "completed");
  assert.equal(second.status, "completed");
  assert.equal(second.cached, true);
  assert.equal(providerCalls, 1);
  assert.equal(moderationCalls, 1);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM safety_ai_runs")).rows[0].count, 1);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM safety_ai_usage")).rows[0].count, 1);
});

test("shadow recommendations never advance the live workflow without their actions", async () => {
  await seedCollectionCase();
  const provider = {
    analyze: async () => providerOutput(validResult({
      category: "invalid_contact",
      subjectType: "collection",
      impactScope: "collection",
      riskLevel: "medium",
      confidence: 0.9,
      recommendedAction: "request_correction"
    }))
  };

  const result = await analyzeSafetyCase({
    caseId: "case-ai",
    mode: "shadow",
    aiConfig: AI_CONFIG,
    withTransaction: transaction,
    moderation: passModeration,
    providerFactory: () => provider,
    now: NOW
  });

  assert.equal(result.policy.nextStatus, "awaiting_correction");
  assert.equal(result.applied, false);
  const safetyCase = await pool.query(
    "SELECT status, correction_due_at FROM safety_cases WHERE id = 'case-ai'"
  );
  assert.equal(safetyCase.rows[0].status, "manual_review");
  assert.equal(safetyCase.rows[0].correction_due_at, null);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM safety_actions")).rows[0].count, 0);
});

test("invalid and restricted reporter clues cannot trigger the invalid-contact threshold", async () => {
  await seedCollectionCase();
  await pool.query(
    `UPDATE reports
     SET status = 'invalid', detail = 'INVALIDATED PRIVATE CLUE'
     WHERE id = 'report-ai-2'`
  );
  await pool.query(
    `INSERT INTO safety_evidence (
       id, case_id, report_id, client_request_id, evidence_type,
       text_snapshot, structured_snapshot, object_keys, created_at
     ) VALUES (
       'evidence-ai-invalid', 'case-ai', 'report-ai-2', 'request-ai-invalid',
       'report_supplement', 'INVALIDATED PRIVATE EVIDENCE', '{}'::jsonb,
       ARRAY[]::text[], $1
     )`,
    [NOW]
  );
  await pool.query(
    `INSERT INTO users (id, nickname, is_restricted)
     VALUES ('reporter-ai-restricted', 'Restricted AI Reporter', true)`
  );
  await pool.query(
    `INSERT INTO reports (
       id, target_type, target_id, reason, detail, reporter_id, status,
       client_request_id, case_id, source_type, source_id,
       subject_type, subject_id, reason_code, reported_field, created_at
     ) VALUES (
       'report-ai-restricted', 'collection', 'collection-ai', 'invalid_contact',
       'Restricted reporter clue', 'reporter-ai-restricted', 'pending',
       'request-ai-restricted', 'case-ai', 'collection', 'collection-ai',
       'collection', 'collection-ai', 'invalid_contact', 'contact_wechat', $1
     )`,
    [NOW]
  );
  const provider = {
    async analyze({ messages }) {
      const prompt = JSON.stringify(messages);
      assert.equal(prompt.includes("INVALIDATED PRIVATE CLUE"), false);
      assert.equal(prompt.includes("INVALIDATED PRIVATE EVIDENCE"), false);
      return providerOutput(validResult({
        category: "invalid_contact",
        subjectType: "collection",
        impactScope: "collection",
        riskLevel: "medium",
        confidence: 0.9,
        recommendedAction: "request_correction"
      }));
    }
  };

  const result = await analyzeSafetyCase({
    caseId: "case-ai",
    mode: "shadow",
    aiConfig: AI_CONFIG,
    withTransaction: transaction,
    moderation: passModeration,
    providerFactory: () => provider,
    now: NOW
  });

  assert.deepEqual(result.policy.proposedActions.map((action) => action.actionType), ["request_correction"]);
  assert.deepEqual(result.policy.reasonCodes, ["invalid_contact_first_report"]);
});

test("enforce mode stores proposals but applies nothing when the runtime gate is closed", async () => {
  await seedPostCase({ category: "suspected_scam" });
  let gateCalls = 0;
  let actionCalls = 0;
  const result = await analyzeSafetyCase({
    caseId: "case-ai",
    mode: "enforce",
    automaticActionsEnabled: true,
    aiConfig: AI_CONFIG,
    withTransaction: transaction,
    moderation: async () => ({
      outcome: "block",
      riskLevel: "high",
      source: "textAgent",
      reason: "Hard scam signal"
    }),
    providerFactory: () => ({
      analyze: async () => providerOutput(validResult({
        category: "suspected_scam",
        riskLevel: "high",
        confidence: 0.99,
        recommendedAction: "no_action"
      }))
    }),
    assertEnforcementAllowed: async () => {
      gateCalls += 1;
      const error = new Error("Automatic safety actions are not allowed");
      error.code = "enforcement_gate_closed";
      throw error;
    },
    applyAction: async () => {
      actionCalls += 1;
      return { syncEvents: [] };
    },
    now: NOW
  });

  assert.equal(gateCalls, 1);
  assert.equal(actionCalls, 0);
  assert.equal(result.status, "completed");
  assert.equal(result.reason, "enforcement_gate_closed");
  assert.equal(result.applied, false);
  const run = await pool.query("SELECT status, error_code, proposed_actions FROM safety_ai_runs");
  assert.equal(run.rows[0].status, "completed");
  assert.equal(run.rows[0].error_code, "enforcement_gate_closed");
  assert.deepEqual(run.rows[0].proposed_actions.map((action) => action.actionType), ["hide_post"]);
  assert.equal((await pool.query("SELECT status FROM safety_cases WHERE id = 'case-ai'")).rows[0].status, "manual_review");
  assert.equal((await pool.query("SELECT safety_status FROM posts WHERE id = 'post-ai'")).rows[0].safety_status, "active");
});

test("rechecks run and case freshness before opening the gate and applying an automatic action", async () => {
  await seedPostCase({ category: "suspected_scam" });
  const order = [];
  const result = await analyzeSafetyCase({
    caseId: "case-ai",
    mode: "enforce",
    automaticActionsEnabled: true,
    aiConfig: AI_CONFIG,
    withTransaction: transaction,
    moderation: async () => ({
      outcome: "block",
      riskLevel: "high",
      source: "textAgent",
      reason: "Hard scam signal"
    }),
    providerFactory: () => ({
      analyze: async () => providerOutput(validResult({
        category: "suspected_scam",
        riskLevel: "high",
        confidence: 0.99,
        recommendedAction: "no_action"
      }))
    }),
    assertEnforcementAllowed: async (client, options) => {
      order.push("gate");
      const run = await client.query(
        "SELECT status, model_version, prompt_version, policy_version FROM safety_ai_runs"
      );
      assert.deepEqual(run.rows[0], {
        status: "running",
        model_version: AI_CONFIG.model,
        prompt_version: AI_CONFIG.promptVersion,
        policy_version: AI_CONFIG.policyVersion
      });
      assert.deepEqual(options.requiredVersions, {
        model: AI_CONFIG.model,
        prompt: AI_CONFIG.promptVersion,
        policy: AI_CONFIG.policyVersion
      });
      return { passed: true };
    },
    applyAction: async (_client, input) => {
      order.push("action");
      assert.equal(input.actionType, "hide_post");
      return { syncEvents: [] };
    },
    now: NOW
  });

  assert.deepEqual(order, ["gate", "action"]);
  assert.equal(result.applied, true);
  assert.equal(result.reason, null);
  assert.equal((await pool.query("SELECT error_code FROM safety_ai_runs")).rows[0].error_code, null);
});

test("zero budget records a blocked run before loading or invoking any provider", async () => {
  await seedPostCase({ category: "other" });
  let providerFactoryCalls = 0;
  const result = await analyzeSafetyCase({
    caseId: "case-ai",
    mode: "shadow",
    aiConfig: { ...AI_CONFIG, monthlyBudgetCny: 0 },
    withTransaction: transaction,
    moderation: passModeration,
    providerFactory: () => {
      providerFactoryCalls += 1;
      return { analyze: async () => assert.fail("provider must not run") };
    },
    now: NOW
  });

  assert.deepEqual(result, {
    status: "budget_blocked",
    reason: "budget_disabled",
    providerCalled: false
  });
  assert.equal(providerFactoryCalls, 0);
  const run = await pool.query("SELECT status, error_code FROM safety_ai_runs");
  assert.deepEqual(run.rows[0], { status: "budget_blocked", error_code: "budget_disabled" });
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM safety_ai_usage")).rows[0].count, 0);
  assert.equal((await pool.query("SELECT status FROM safety_cases WHERE id = 'case-ai'")).rows[0].status, "manual_review");
});

test("zero budget moves a case with a PostgreSQL microsecond timestamp to manual review", async () => {
  await seedPostCase({ category: "other" });
  await pool.query(
    "UPDATE safety_cases SET updated_at = '2026-07-14T08:00:00.000531Z' WHERE id = 'case-ai'"
  );

  const result = await analyzeSafetyCase({
    caseId: "case-ai",
    mode: "shadow",
    aiConfig: { ...AI_CONFIG, monthlyBudgetCny: 0 },
    withTransaction: transaction,
    moderation: passModeration,
    providerFactory: () => ({ analyze: async () => assert.fail("provider must not run") }),
    now: NOW
  });

  assert.equal(result.status, "budget_blocked");
  assert.equal(
    (await pool.query("SELECT status FROM safety_cases WHERE id = 'case-ai'")).rows[0].status,
    "manual_review"
  );
});

test("stores hard signals and proposals but applies nothing in shadow mode", async () => {
  await seedPostCase({ category: "suspected_scam" });
  const provider = {
    analyze: async () => providerOutput(validResult({
      category: "suspected_scam",
      riskLevel: "high",
      confidence: 0.99,
      recommendedAction: "no_action"
    }))
  };
  const moderation = async () => ({
    outcome: "block",
    status: "rejected",
    riskLevel: "high",
    source: "textAgent",
    reason: "Hard scam signal",
    rawSummary: {
      labels: ["fraud"],
      requestId: "provider-private-request-id",
      debugSecret: "must-not-store"
    }
  });

  const result = await analyze({ provider, moderation });

  assert.equal(result.status, "completed");
  assert.deepEqual(result.policy.proposedActions.map((action) => action.actionType), ["hide_post"]);
  const run = await pool.query("SELECT status, hard_signal, proposed_actions, parsed_result FROM safety_ai_runs");
  assert.equal(run.rows[0].status, "completed");
  assert.deepEqual(run.rows[0].hard_signal, {
    labels: ["fraud"],
    outcome: "block",
    reason: "Hard scam signal",
    riskLevel: "high",
    source: "textAgent"
  });
  assert.deepEqual(run.rows[0].proposed_actions.map((action) => action.actionType), ["hide_post"]);
  assert.equal(run.rows[0].parsed_result.category, "suspected_scam");
  assert.equal(JSON.stringify(run.rows[0]).includes("provider-private-request-id"), false);
  assert.equal(JSON.stringify(run.rows[0]).includes("must-not-store"), false);
  assert.equal((await pool.query("SELECT safety_status FROM posts WHERE id = 'post-ai'")).rows[0].safety_status, "active");
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM safety_actions")).rows[0].count, 0);
  const safetyCase = await pool.query("SELECT status, ai_recommendation FROM safety_cases WHERE id = 'case-ai'");
  assert.equal(safetyCase.rows[0].status, "manual_review");
  assert.equal(safetyCase.rows[0].ai_recommendation.mode, "shadow");
});

test("preserves a human terminal state and never opens the automatic-action gate", async () => {
  await seedPostCase({ category: "suspected_scam" });
  await pool.query(
    `UPDATE safety_cases
     SET status = 'resolved_actioned', manual_hold = true, resolved_at = $2
     WHERE id = $1`,
    ["case-ai", NOW]
  );
  let gateCalls = 0;
  const result = await analyzeSafetyCase({
    caseId: "case-ai",
    mode: "enforce",
    automaticActionsEnabled: true,
    aiConfig: AI_CONFIG,
    withTransaction: transaction,
    moderation: async () => ({
      outcome: "block",
      status: "rejected",
      riskLevel: "high",
      source: "textAgent",
      reason: "Synthetic high-risk signal"
    }),
    providerFactory: () => ({
      analyze: async () => providerOutput(validResult({
        category: "suspected_scam",
        riskLevel: "high",
        confidence: 0.99,
        recommendedAction: "hide_content_temporarily"
      }))
    }),
    assertEnforcementAllowed: async () => {
      gateCalls += 1;
      return { passed: true };
    },
    now: NOW
  });

  assert.equal(result.reason, "manual_hold");
  assert.equal(result.applied, false);
  assert.equal(gateCalls, 0);
  const safetyCase = await pool.query(
    "SELECT status, manual_hold FROM safety_cases WHERE id = 'case-ai'"
  );
  assert.deepEqual(safetyCase.rows[0], { status: "resolved_actioned", manual_hold: true });
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM safety_actions")).rows[0].count, 0);
});

test("releases database locks across provider work and stores stale results without changing the case", async () => {
  await seedPostCase({ category: "suspected_scam" });
  const provider = {
    async analyze() {
      await pool.query(
        `UPDATE safety_cases
         SET manual_hold = true, updated_at = '2026-07-14T09:00:00.000Z'
         WHERE id = 'case-ai'`
      );
      return providerOutput(validResult({
        category: "suspected_scam",
        riskLevel: "high",
        confidence: 0.99
      }));
    }
  };

  const result = await analyze({
    provider,
    moderation: async () => ({ outcome: "block", riskLevel: "high", source: "textAgent" })
  });

  assert.equal(result.stale, true);
  const run = await pool.query("SELECT status, error_code FROM safety_ai_runs");
  assert.deepEqual(run.rows[0], { status: "completed", error_code: "stale_case_version" });
  const safetyCase = await pool.query(
    "SELECT manual_hold, status, ai_recommendation FROM safety_cases WHERE id = 'case-ai'"
  );
  assert.equal(safetyCase.rows[0].manual_hold, true);
  assert.equal(safetyCase.rows[0].status, "received");
  assert.deepEqual(safetyCase.rows[0].ai_recommendation, {});
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM safety_actions")).rows[0].count, 0);
});

test("treats a supported evidence supplement during provider work as a stale analysis", async () => {
  await seedPostCase({ category: "other" });
  const provider = {
    async analyze() {
      await transaction((client) => supplementSafetyReport(client, {
        reportId: "report-ai",
        reporterId: "reporter-ai",
        body: {
          clientRequestID: "request-ai-supplement",
          detail: "Evidence added while Qwen was running"
        }
      }));
      return providerOutput(validResult());
    }
  };

  const result = await analyze({ provider });

  assert.equal(result.stale, true);
  assert.deepEqual(
    (await pool.query("SELECT status, error_code FROM safety_ai_runs")).rows[0],
    { status: "completed", error_code: "stale_case_version" }
  );
  const safetyCase = await pool.query(
    "SELECT status, ai_recommendation FROM safety_cases WHERE id = 'case-ai'"
  );
  assert.equal(safetyCase.rows[0].status, "received");
  assert.deepEqual(safetyCase.rows[0].ai_recommendation, {});
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM safety_evidence")).rows[0].count, 2);
});

test("records an accepted revision policy result in shadow without publishing", async () => {
  await seedPostCase({ category: "other" });
  await pool.query("UPDATE safety_cases SET status = 'manual_review' WHERE id = 'case-ai'");
  await pool.query(
    `INSERT INTO content_revisions (
       id, case_id, target_type, target_id, owner_id, revision_number,
       snapshot, status, review_summary, reviewed_at, updated_at
     ) VALUES (
       'revision-ai', 'case-ai', 'post', 'post-ai', 'owner-ai', 1,
       $1::jsonb, 'approved', $2::jsonb, $3, $3
     )`,
    [
      JSON.stringify({ title: "Corrected post", description: "Safe corrected content" }),
      JSON.stringify({
        status: "active",
        outcome: "pass",
        riskLevel: "none",
        source: "textAgent",
        hardSafety: { provider: "aliyun", passed: true }
      }),
      NOW
    ]
  );
  let publishCalls = 0;
  const result = await analyzeSafetyCase({
    caseId: "case-ai",
    revisionId: "revision-ai",
    mode: "shadow",
    aiConfig: AI_CONFIG,
    withTransaction: transaction,
    providerFactory: () => ({
      analyze: async () => providerOutput(validResult({
        category: "other",
        riskLevel: "none",
        confidence: 0.9,
        recommendedAction: "no_action",
        requiresHuman: false
      }))
    }),
    publishRevision: async () => {
      publishCalls += 1;
      return { published: true, syncEvents: [] };
    },
    now: NOW
  });

  assert.deepEqual(result.policy.reasonCodes, ["revision_safe_to_publish"]);
  assert.equal(result.applied, false);
  assert.equal(publishCalls, 0);
  assert.equal(
    (await pool.query("SELECT status FROM content_revisions WHERE id = 'revision-ai'")).rows[0].status,
    "approved"
  );
});

test("invalid JSON, timeout, and 429 fail closed with conservative usage state", async () => {
  const cases = [
    {
      id: "invalid-json",
      provider: new QwenCaseProvider({
        baseUrl: "https://dashscope.example.test/v1",
        apiKey: "test-key",
        timeoutMs: 100,
        fetchImpl: async () => new Response(JSON.stringify({
          choices: [{ message: { content: "not JSON" } }],
          usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 }
        }), { status: 200, headers: { "Content-Type": "application/json" } })
      }),
      runStatus: "invalid",
      errorCode: "qwen_invalid_response",
      usageStatus: "settled",
      rawResponse: "not JSON"
    },
    {
      id: "timeout",
      provider: { analyze: async () => { throw providerError("qwen_timeout", { retryable: true, billingUncertain: true }); } },
      runStatus: "failed",
      errorCode: "qwen_timeout",
      usageStatus: "settled",
      rawResponse: ""
    },
    {
      id: "malformed-usage",
      provider: new QwenCaseProvider({
        baseUrl: "https://dashscope.example.test/v1",
        apiKey: "test-key",
        timeoutMs: 100,
        fetchImpl: async () => new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify(validResult()) } }],
          usage: { prompt_tokens: "unknown", completion_tokens: 4 }
        }), { status: 200, headers: { "Content-Type": "application/json" } })
      }),
      runStatus: "invalid",
      errorCode: "qwen_invalid_response",
      usageStatus: "settled",
      rawResponse: JSON.stringify(validResult())
    },
    {
      id: "rate-limit",
      provider: { analyze: async () => { throw providerError("qwen_rate_limited", { retryable: true, billingUncertain: false, status: 429 }); } },
      runStatus: "failed",
      errorCode: "qwen_rate_limited",
      usageStatus: "released",
      rawResponse: ""
    }
  ];

  for (const item of cases) {
    await resetDatabase();
    await seedPostCase({ category: "other" });
    const result = await analyze({ provider: item.provider });

    assert.equal(result.status, item.runStatus, item.id);
    assert.equal(result.reason, item.errorCode, item.id);
    const run = await pool.query("SELECT status, error_code, raw_response FROM safety_ai_runs");
    assert.deepEqual(run.rows[0], {
      status: item.runStatus,
      error_code: item.errorCode,
      raw_response: item.rawResponse
    }, item.id);
    assert.equal(
      (await pool.query("SELECT status FROM safety_ai_usage")).rows[0].status,
      item.usageStatus,
      item.id
    );
    assert.equal((await pool.query("SELECT status FROM safety_cases WHERE id = 'case-ai'")).rows[0].status, "manual_review");
  }
});

test("worker persists only generic job errors when orchestration throws unexpectedly", async () => {
  await seedPostCase({ category: "other" });
  await pool.query(
    `INSERT INTO safety_jobs (job_type, case_id, unique_key, payload, max_attempts)
     VALUES ('analyze_case', 'case-ai', 'analyze-case-secret-error', '{}'::jsonb, 1)`
  );
  const handler = createAnalyzeCaseJobHandler({
    analyzeSafetyCase: async () => {
      throw new Error("Bearer should-never-persist prompt-private-evidence");
    },
    notifySyncEvents: async () => {}
  });
  const worker = startSafetyWorker({
    concurrency: 1,
    pollIntervalMs: 10,
    workerId: "ai-sanitize-worker",
    handlers: { analyze_case: handler }
  });
  try {
    await waitFor(async () => {
      const job = await pool.query("SELECT status FROM safety_jobs WHERE unique_key = 'analyze-case-secret-error'");
      return job.rows[0]?.status === "failed";
    });
  } finally {
    await worker.stop();
  }

  const job = await pool.query(
    "SELECT error_code, error_summary FROM safety_jobs WHERE unique_key = 'analyze-case-secret-error'"
  );
  assert.deepEqual(job.rows[0], {
    error_code: "SAFETY_JOB_FAILED",
    error_summary: "Safety job failed (SAFETY_JOB_FAILED)."
  });
});

async function analyze({ provider, moderation = passModeration } = {}) {
  return analyzeSafetyCase({
    caseId: "case-ai",
    mode: "shadow",
    aiConfig: AI_CONFIG,
    withTransaction: transaction,
    moderation,
    providerFactory: () => provider,
    now: NOW
  });
}

async function seedPostCase({ category }) {
  await pool.query(
    `INSERT INTO users (id, nickname) VALUES
       ('owner-ai', 'AI Owner'),
       ('reporter-ai', 'AI Reporter')`
  );
  await pool.query(
    `INSERT INTO posts (id, author_id, title, description, deadline)
     VALUES ('post-ai', 'owner-ai', 'AI policy post', 'Bounded source snapshot', now() + interval '1 day')`
  );
  await pool.query(
    `INSERT INTO safety_cases (
       id, subject_type, subject_id, category, impact_scope, status, updated_at
     ) VALUES ('case-ai', 'post', 'post-ai', $1, 'post', 'received', $2)`,
    [category, NOW]
  );
  await pool.query(
    `INSERT INTO reports (
       id, target_type, target_id, reason, detail, reporter_id, status,
       client_request_id, case_id, source_type, source_id,
       subject_type, subject_id, reason_code, reported_field, created_at
     ) VALUES (
       'report-ai', 'post', 'post-ai', $1, 'Anonymous report detail', 'reporter-ai', 'pending',
       'request-ai', 'case-ai', 'post', 'post-ai',
       'post', 'post-ai', $1, 'content', $2
     )`,
    [category, NOW]
  );
  await pool.query(
    `INSERT INTO safety_evidence (
       id, case_id, report_id, client_request_id, evidence_type,
       text_snapshot, structured_snapshot, object_keys, created_at
     ) VALUES (
       'evidence-ai', 'case-ai', 'report-ai', 'request-ai', 'post',
       'Bounded source snapshot',
       $1::jsonb, ARRAY[]::text[], $2
     )`,
    [JSON.stringify({
      source: {
        title: "AI policy post",
        description: "Bounded source snapshot",
        authorId: "owner-ai",
        createdAt: "2026-07-14T07:00:00.000Z"
      },
      report: {
        reasonCode: category,
        reportedField: "content",
        detail: "Anonymous report detail"
      }
    }), NOW]
  );
}

async function seedCollectionCase() {
  await pool.query(
    `INSERT INTO users (id, nickname) VALUES
       ('owner-ai', 'AI Owner'),
       ('reporter-ai', 'AI Reporter'),
       ('reporter-ai-2', 'AI Reporter 2')`
  );
  await pool.query(
    `INSERT INTO group_collections (id, owner_id, name, deadline)
     VALUES ('collection-ai', 'owner-ai', 'AI policy collection', now() + interval '1 day')`
  );
  await pool.query(
    `INSERT INTO safety_cases (
       id, subject_type, subject_id, category, impact_scope, status, updated_at
     ) VALUES ('case-ai', 'collection', 'collection-ai', 'invalid_contact', 'collection', 'received', $1)`,
    [NOW]
  );
  for (const [index, reporterId] of ["reporter-ai", "reporter-ai-2"].entries()) {
    await pool.query(
      `INSERT INTO reports (
         id, target_type, target_id, reason, detail, reporter_id, status,
         client_request_id, case_id, source_type, source_id,
         subject_type, subject_id, reason_code, reported_field, created_at
       ) VALUES (
         $1, 'collection', 'collection-ai', 'invalid_contact', 'Invalid contact detail', $2, 'pending',
         $3, 'case-ai', 'collection', 'collection-ai',
         'collection', 'collection-ai', 'invalid_contact', 'contact_wechat', $4
       )`,
      [`report-ai-${index + 1}`, reporterId, `request-ai-${index + 1}`, NOW]
    );
  }
  await pool.query(
    `INSERT INTO safety_evidence (
       id, case_id, report_id, client_request_id, evidence_type,
       text_snapshot, structured_snapshot, object_keys, created_at
     ) VALUES (
       'evidence-ai', 'case-ai', 'report-ai-1', 'request-ai-1', 'collection',
       'Invalid collection contact', $1::jsonb, ARRAY[]::text[], $2
     )`,
    [JSON.stringify({
      source: {
        name: "AI policy collection",
        contactWechat: "stale-contact"
      }
    }), NOW]
  );
}

function validResult(overrides = {}) {
  return {
    category: "other",
    subjectType: "post",
    impactScope: "post",
    riskLevel: "low",
    confidence: 0.6,
    evidence: [{ source: "source_snapshot", fact: "Bounded source evidence." }],
    recommendedAction: "manual_review",
    requiresHuman: true,
    summary: "Manual review remains the safe default.",
    ...overrides
  };
}

function providerOutput(result) {
  return {
    result,
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    requestId: "mock-ai-request",
    rawContent: JSON.stringify(result)
  };
}

function passModeration() {
  return {
    outcome: "pass",
    status: "active",
    riskLevel: "none",
    source: "textAgent",
    reason: "Hard safety passed",
    rawSummary: { labels: [] }
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

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("timed out waiting for AI job state");
}

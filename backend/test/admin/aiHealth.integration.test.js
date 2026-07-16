import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../../src/app.js";
import { loadAdminAIHealth } from "../../src/admin/aiHealthService.js";
import { hashAdminToken } from "../../src/admin/sessionService.js";
import { closeDatabase, pool, resetDatabase } from "../helpers/database.js";

process.env.ADMIN_RECOVERY_PEPPER = "test-admin-ai-health-pepper-with-32-plus-characters";

const SESSION_TOKEN = "H".repeat(43);
const CSRF_TOKEN = "I".repeat(43);
const ADMIN_COOKIES = new Map([
  ["zbt_admin_session", SESSION_TOKEN],
  ["zbt_admin_csrf", CSRF_TOKEN]
]);
const HEALTH_OPTIONS = Object.freeze({
  safety: { aiMode: "shadow" },
  ai: {
    apiKey: "secret-health-api-key",
    model: "qwen3.7-plus-2026-05-26",
    promptVersion: "safety-case-prompt-v1",
    policyVersion: "safety-policy-v1",
    monthlyBudgetCny: 12,
    inputCnyPerMillion: 2,
    outputCnyPerMillion: 6
  },
  now: new Date("2026-07-14T08:00:00.000Z")
});

test.beforeEach(async () => {
  await resetDatabase();
  await seedAIHealthFixture();
});
test.after(closeDatabase);

test("reports provider, jobs, budget, fixtures, current-version evaluations, and no key", async () => {
  const health = await transaction((client) => loadAdminAIHealth(client, HEALTH_OPTIONS));

  assert.equal(health.mode, "shadow");
  assert.equal(health.providerState, "ready");
  assert.deepEqual(health.jobs, { pending: 1, running: 1, failed: 1 });
  assert.deepEqual(health.budget, {
    month: "2026-07",
    reservedCny: 0.003,
    actualCny: 0.009,
    budgetCny: 12
  });
  assert.equal(health.metrics.fixtureVersion, "safety-policy-fixtures-v1");
  assert.equal(health.metrics.fixtureCount, 100);
  assert.equal(health.metrics.fixtureSchemaFailures, 0);
  assert.equal(health.metrics.fixtureVersionCurrent, true);
  assert.ok(health.metrics.autoHidePrecision >= 0.95);
  assert.equal(health.metrics.realEvaluations, 1);
  assert.equal(health.metrics.categoryCorrect, 1);
  assert.equal(health.metrics.actionCorrect, 1);
  assert.equal(health.metrics.scopeExpansionErrors, 0);
  assert.equal(health.metrics.automaticAccountActions, 0);
  assert.equal(health.metrics.versionsMatch, true);
  assert.equal(health.gate.passed, false);
  assert.deepEqual(health.gate.checks, {
    fixtureCount: true,
    fixtureSchemaValid: true,
    autoHidePrecision: true,
    realComparisons: false,
    noScopeErrors: true,
    noAutomaticAccountActions: true,
    versionsMatch: true,
    fixtureVersionCurrent: true
  });
  assert.deepEqual(health.versions, {
    model: "qwen3.7-plus-2026-05-26",
    prompt: "safety-case-prompt-v1",
    policy: "safety-policy-v1"
  });
  assert.equal(JSON.stringify(health).includes("secret-health-api-key"), false);
  assert.equal(Object.hasOwn(health, "apiKey"), false);
});

test("protects health and records one audited human comparison without changing the case", async () => {
  const app = createApp({
    adminWebEnabled: true,
    adminCaseRouterOptions: { aiHealthOptions: HEALTH_OPTIONS }
  });
  await withServer(app, async (baseUrl) => {
    const unauthenticated = await request(baseUrl, "/admin/api/ai-health");
    assert.equal(unauthenticated.status, 401);

    const health = await request(baseUrl, "/admin/api/ai-health", { cookies: ADMIN_COOKIES });
    assert.equal(health.status, 200);
    assert.equal(health.body.mode, "shadow");
    assert.equal(health.body.metrics.realEvaluations, 1);
    assert.equal(JSON.stringify(health.body).includes("secret-health-api-key"), false);

    const detail = await request(baseUrl, "/admin/api/cases/case-ai-evaluate", {
      cookies: ADMIN_COOKIES
    });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.case.aiComparison.run.id, "run-evaluate");
    assert.equal(detail.body.case.aiComparison.evaluation, null);
    assert.equal(detail.body.case.aiComparison.humanDecision.decision, "no_action");
    assert.equal(JSON.stringify(detail.body).includes("raw-provider-private-output"), false);
    const versionBefore = detail.body.case.version;

    const body = {
      aiRunID: "run-evaluate",
      categoryCorrect: true,
      actionCorrect: false,
      scopeExpansionError: false,
      notes: "分类正确，但动作应保持人工复核。"
    };
    const withoutCSRF = await request(
      baseUrl,
      "/admin/api/cases/case-ai-evaluate/ai-evaluation",
      { method: "POST", body, cookies: ADMIN_COOKIES }
    );
    assert.equal(withoutCSRF.status, 403);

    const invalid = await request(
      baseUrl,
      "/admin/api/cases/case-ai-evaluate/ai-evaluation",
      {
        method: "POST",
        body: { ...body, categoryCorrect: "true" },
        cookies: ADMIN_COOKIES,
        csrf: CSRF_TOKEN
      }
    );
    assert.equal(invalid.status, 400);

    const created = await request(
      baseUrl,
      "/admin/api/cases/case-ai-evaluate/ai-evaluation",
      { method: "POST", body, cookies: ADMIN_COOKIES, csrf: CSRF_TOKEN }
    );
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.evaluation, {
      id: created.body.evaluation.id,
      aiRunID: "run-evaluate",
      categoryCorrect: true,
      actionCorrect: false,
      scopeExpansionError: false,
      notes: "分类正确，但动作应保持人工复核。",
      createdAt: created.body.evaluation.createdAt
    });

    const duplicate = await request(
      baseUrl,
      "/admin/api/cases/case-ai-evaluate/ai-evaluation",
      { method: "POST", body, cookies: ADMIN_COOKIES, csrf: CSRF_TOKEN }
    );
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.code, "ai_evaluation_exists");

    const refreshed = await request(baseUrl, "/admin/api/cases/case-ai-evaluate", {
      cookies: ADMIN_COOKIES
    });
    assert.equal(refreshed.body.case.version, versionBefore);
    assert.equal(refreshed.body.case.aiComparison.evaluation.aiRunID, "run-evaluate");
    const audit = await pool.query(
      `SELECT event_type, subject_type, subject_id, event_data
       FROM admin_audit_events
       WHERE event_type = 'safety.ai_evaluated'`
    );
    assert.equal(audit.rows.length, 1);
    assert.deepEqual(audit.rows[0], {
      event_type: "safety.ai_evaluated",
      subject_type: "safety_ai_run",
      subject_id: "run-evaluate",
      event_data: {
        caseId: "case-ai-evaluate",
        actionCorrect: false,
        categoryCorrect: true,
        scopeExpansionError: false
      }
    });
    assert.equal(JSON.stringify(audit.rows[0]).includes(body.notes), false);
  });
});

async function seedAIHealthFixture() {
  await pool.query(
    `INSERT INTO admin_users (id, username, username_normalized, password_hash)
     VALUES ('admin-ai-health', 'AIHealth', 'aihealth', 'unused-test-hash')`
  );
  await pool.query(
    `INSERT INTO admin_devices (
       id, admin_user_id, display_name, public_key_jwk, fingerprint_hash, is_root
     ) VALUES (
       'device-ai-health', 'admin-ai-health', 'AI Health Browser',
       '{"kty":"EC"}'::jsonb, 'ai-health-fingerprint', true
     )`
  );
  await pool.query(
    `INSERT INTO admin_sessions (
       id, admin_user_id, device_id, token_hash, csrf_hash,
       idle_expires_at, absolute_expires_at
     ) VALUES (
       'session-ai-health', 'admin-ai-health', 'device-ai-health', $1, $2,
       now() + interval '30 minutes', now() + interval '8 hours'
     )`,
    [hashAdminToken(SESSION_TOKEN), hashAdminToken(CSRF_TOKEN)]
  );
  await pool.query(
    `INSERT INTO users (id, nickname) VALUES
       ('owner-ai-health', 'AI Health Owner'),
       ('reporter-ai-health', 'AI Health Reporter')`
  );
  await pool.query(
    `INSERT INTO posts (id, author_id, title, description, deadline) VALUES
       ('post-ai-evaluate', 'owner-ai-health', 'AI comparison case', 'Synthetic source', now() + interval '1 day'),
       ('post-ai-health', 'owner-ai-health', 'AI health aggregate', 'Synthetic source', now() + interval '1 day')`
  );
  await pool.query(
    `INSERT INTO safety_cases (
       id, subject_type, subject_id, category, impact_scope, status, updated_at
     ) VALUES
       ('case-ai-evaluate', 'post', 'post-ai-evaluate', 'other', 'post', 'resolved_no_action', '2026-07-14T07:30:00.000Z'),
       ('case-ai-health', 'post', 'post-ai-health', 'other', 'post', 'manual_review', '2026-07-14T07:20:00.000Z')`
  );
  await pool.query(
    `INSERT INTO safety_case_events (
       case_id, actor_type, actor_id, event_type, event_data, created_at
     ) VALUES (
       'case-ai-evaluate', 'admin', 'admin-ai-health', 'admin_decision_applied',
       '{"decision":"no_action","reason":"人工确认无需处置"}'::jsonb,
       '2026-07-14T07:40:00.000Z'
     )`
  );
  await pool.query(
    `INSERT INTO safety_ai_runs (
       id, case_id, model_version, prompt_version, policy_version,
       evidence_hash, mode, status, parsed_result, proposed_actions,
       raw_response, input_tokens, output_tokens, estimated_cost_cny,
       completed_at, created_at
     ) VALUES
       (
         'run-health', 'case-ai-health', 'qwen3.7-plus-2026-05-26',
         'safety-case-prompt-v1', 'safety-policy-v1', 'hash-health', 'shadow', 'completed',
         $1::jsonb, '[]'::jsonb, 'restricted-health-output', 100, 20, 0.004,
         '2026-07-14T07:20:00.000Z', '2026-07-14T07:19:00.000Z'
       ),
       (
         'run-running', 'case-ai-health', 'qwen3.7-plus-2026-05-26',
         'safety-case-prompt-v1', 'safety-policy-v1', 'hash-running', 'shadow', 'running',
         '{}'::jsonb, '[]'::jsonb, '', 0, 0, 0,
         NULL, '2026-07-14T07:25:00.000Z'
       ),
       (
         'run-evaluate', 'case-ai-evaluate', 'qwen3.7-plus-2026-05-26',
         'safety-case-prompt-v1', 'safety-policy-v1', 'hash-evaluate', 'shadow', 'completed',
         $1::jsonb, '[]'::jsonb, 'raw-provider-private-output', 120, 30, 0.005,
         '2026-07-14T07:50:00.000Z', '2026-07-14T07:49:00.000Z'
       )`,
    [JSON.stringify({
      category: "other",
      subjectType: "post",
      impactScope: "post",
      riskLevel: "low",
      confidence: 0.8,
      evidence: [{ source: "source_snapshot", fact: "Bounded evidence" }],
      recommendedAction: "manual_review",
      requiresHuman: true,
      summary: "Human review remains required."
    })]
  );
  await pool.query(
    `INSERT INTO safety_ai_usage (
       id, ai_run_id, month_key, reserved_cny, actual_cny, status, settled_at
     ) VALUES
       ('usage-health', 'run-health', '2026-07', 0.006, 0.004, 'settled', '2026-07-14T07:20:00.000Z'),
       ('usage-running', 'run-running', '2026-07', 0.003, NULL, 'reserved', NULL),
       ('usage-evaluate', 'run-evaluate', '2026-07', 0.007, 0.005, 'settled', '2026-07-14T07:50:00.000Z')`
  );
  await pool.query(
    `INSERT INTO safety_ai_evaluations (
       id, ai_run_id, admin_user_id, category_correct, action_correct,
       scope_expansion_error, notes, created_at
     ) VALUES (
       'evaluation-health', 'run-health', 'admin-ai-health', true, true,
       false, 'Existing real comparison', '2026-07-14T07:30:00.000Z'
     )`
  );
  await pool.query(
    `INSERT INTO safety_jobs (job_type, case_id, unique_key, status) VALUES
       ('analyze_case', 'case-ai-evaluate', 'health-job-pending', 'pending'),
       ('analyze_case', 'case-ai-evaluate', 'health-job-running', 'running'),
       ('analyze_case', 'case-ai-evaluate', 'health-job-failed', 'failed')`
  );
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

async function request(baseUrl, path, { method = "GET", body, cookies, csrf } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookies?.size) {
    headers.cookie = [...cookies]
      .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
      .join("; ");
  }
  if (csrf) headers["x-csrf-token"] = csrf;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null
  };
}

async function withServer(app, callback) {
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

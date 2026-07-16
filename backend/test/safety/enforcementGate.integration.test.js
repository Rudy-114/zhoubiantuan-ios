import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAutomaticActionsAllowed,
  evaluateEnforcementGate
} from "../../src/safety/enforcementGate.js";
import { closeDatabase, pool, resetDatabase } from "../helpers/database.js";

const VERSIONS = Object.freeze({
  model: "qwen3.7-plus-2026-05-26",
  prompt: "safety-case-prompt-v2",
  policy: "safety-policy-v2"
});

const PASSING_METRICS = Object.freeze({
  fixtureVersion: "safety-policy-fixtures-v2",
  fixtureCount: 100,
  fixtureInvalidCount: 0,
  autoHidePrecision: 0.95,
  realEvaluationCount: 30,
  categoryCorrect: 30,
  actionCorrect: 30,
  scopeExpansionErrors: 0,
  automaticAccountActions: 0,
  versionsMatch: true,
  fixtureVersionCurrent: true,
  versions: VERSIONS
});

test.beforeEach(resetDatabase);
test.after(closeDatabase);

test("fails every enforcement threshold and passes only the complete metric set", async () => {
  const cases = [
    ["fixtureCount", { fixtureCount: 99 }],
    ["fixtureSchemaValid", { fixtureInvalidCount: 1 }],
    ["autoHidePrecision", { autoHidePrecision: 0.949 }],
    ["realComparisons", { realEvaluationCount: 29 }],
    ["noScopeErrors", { scopeExpansionErrors: 1 }],
    ["noAutomaticAccountActions", { automaticAccountActions: 1 }],
    ["versionsMatch", { versionsMatch: false }],
    ["fixtureVersionCurrent", { fixtureVersionCurrent: false }]
  ];

  for (const [failedCheck, override] of cases) {
    const gate = await evaluateEnforcementGate(fakeClient(), {
      loadMetrics: async () => ({ ...PASSING_METRICS, ...override })
    });
    assert.equal(gate.passed, false, failedCheck);
    assert.equal(gate.checks[failedCheck], false, failedCheck);
  }

  const gate = await evaluateEnforcementGate(fakeClient(), {
    loadMetrics: async () => ({ ...PASSING_METRICS })
  });
  assert.equal(gate.passed, true);
  assert.deepEqual(gate.checks, {
    fixtureCount: true,
    fixtureSchemaValid: true,
    autoHidePrecision: true,
    realComparisons: true,
    noScopeErrors: true,
    noAutomaticAccountActions: true,
    versionsMatch: true,
    fixtureVersionCurrent: true
  });
});

test("assertion exposes only a controlled closed-gate error", async () => {
  await assert.rejects(
    assertAutomaticActionsAllowed(fakeClient(), {
      loadMetrics: async () => ({ ...PASSING_METRICS, realEvaluationCount: 29 })
    }),
    (error) => {
      assert.equal(error.code, "enforcement_gate_closed");
      assert.equal(error.message, "Automatic safety actions are not allowed");
      assert.equal(error.gate.passed, false);
      assert.equal(error.gate.checks.realComparisons, false);
      return true;
    }
  );
});

test("counts only current-version real evaluations and fails closed on live scope or account actions", async () => {
  await seedGateEvidence();

  const passing = await transaction((client) => evaluateEnforcementGate(client, {
    ai: VERSIONS,
    requiredVersions: VERSIONS
  }));
  assert.equal(passing.passed, true);
  assert.equal(passing.metrics.realEvaluationCount, 30);
  assert.equal(passing.metrics.scopeExpansionErrors, 0);
  assert.equal(passing.metrics.automaticAccountActions, 0);

  await pool.query(
    `INSERT INTO safety_ai_runs (
       id, case_id, model_version, prompt_version, policy_version,
       evidence_hash, mode, status, completed_at
     ) VALUES (
       'run-gate-duplicate-case', 'case-gate-1', $1, $2, $3,
       'hash-gate-duplicate-case', 'shadow', 'completed', now()
     )`,
    [VERSIONS.model, VERSIONS.prompt, VERSIONS.policy]
  );
  await pool.query(
    `INSERT INTO safety_ai_evaluations (
       id, ai_run_id, admin_user_id, category_correct, action_correct,
       scope_expansion_error
     ) VALUES (
       'evaluation-gate-duplicate-case', 'run-gate-duplicate-case',
       'admin-gate', true, true, false
     )`
  );
  const duplicateCase = await transaction((client) => evaluateEnforcementGate(client, {
    ai: VERSIONS,
    requiredVersions: VERSIONS
  }));
  assert.equal(duplicateCase.metrics.realEvaluationCount, 30);
  assert.equal(duplicateCase.passed, true);

  await pool.query(
    "UPDATE safety_ai_evaluations SET scope_expansion_error = true WHERE id = 'evaluation-gate-1'"
  );
  const scopeFailure = await transaction((client) => evaluateEnforcementGate(client, {
    ai: VERSIONS,
    requiredVersions: VERSIONS
  }));
  assert.equal(scopeFailure.passed, false);
  assert.equal(scopeFailure.checks.noScopeErrors, false);

  await pool.query(
    "UPDATE safety_ai_evaluations SET scope_expansion_error = false WHERE id = 'evaluation-gate-1'"
  );
  await pool.query(
    `INSERT INTO safety_actions (
       id, case_id, idempotency_key, action_type, target_type, target_id,
       actor_type, actor_id, reason, execution_status
     ) VALUES (
       'action-gate-account', 'case-gate-1', 'gate-account-action',
       'restrict_user', 'user', 'owner-gate', 'ai', 'policy:test',
       'must keep the gate closed', 'applied'
     )`
  );
  const accountFailure = await transaction((client) => evaluateEnforcementGate(client, {
    ai: VERSIONS,
    requiredVersions: VERSIONS
  }));
  assert.equal(accountFailure.passed, false);
  assert.equal(accountFailure.checks.noAutomaticAccountActions, false);

  await pool.query("DELETE FROM safety_actions WHERE id = 'action-gate-account'");
  const versionFailure = await transaction((client) => evaluateEnforcementGate(client, {
    ai: VERSIONS,
    requiredVersions: { ...VERSIONS, prompt: "safety-case-prompt-v1" }
  }));
  assert.equal(versionFailure.passed, false);
  assert.equal(versionFailure.checks.versionsMatch, false);
  assert.equal(versionFailure.metrics.realEvaluationCount, 1);

  const staleFixtureFailure = await transaction((client) => evaluateEnforcementGate(client, {
    ai: { ...VERSIONS, policy: "safety-policy-v1" },
    requiredVersions: { ...VERSIONS, policy: "safety-policy-v1" }
  }));
  assert.equal(staleFixtureFailure.passed, false);
  assert.equal(staleFixtureFailure.checks.fixtureVersionCurrent, false);
});

async function seedGateEvidence() {
  await pool.query(
    `INSERT INTO admin_users (id, username, username_normalized, password_hash)
     VALUES ('admin-gate', 'GateAdmin', 'gateadmin', 'unused-test-hash')`
  );
  await pool.query("INSERT INTO users (id, nickname) VALUES ('owner-gate', 'Gate Owner')");
  await pool.query(
    `INSERT INTO posts (id, author_id, title, description, deadline)
     SELECT 'post-gate-' || value, 'owner-gate', 'Gate post ' || value,
            'Gate evidence', now() + interval '1 day'
     FROM generate_series(1, 32) AS value`
  );
  await pool.query(
    `INSERT INTO safety_cases (
       id, subject_type, subject_id, category, impact_scope, status
     )
     SELECT 'case-gate-' || value, 'post', 'post-gate-' || value,
            'other', 'post', 'manual_review'
     FROM generate_series(1, 32) AS value`
  );
  await pool.query(
    `INSERT INTO safety_ai_runs (
       id, case_id, model_version, prompt_version, policy_version,
       evidence_hash, is_synthetic, mode, status, completed_at
     )
     SELECT
       'run-gate-' || value,
       'case-gate-' || value,
       $1,
       CASE WHEN value = 32 THEN 'safety-case-prompt-v1' ELSE $2 END,
       $3,
       'hash-gate-' || value,
       value = 31,
       'shadow',
       'completed',
       now()
     FROM generate_series(1, 32) AS value`,
    [VERSIONS.model, VERSIONS.prompt, VERSIONS.policy]
  );
  await pool.query(
    `INSERT INTO safety_ai_evaluations (
       id, ai_run_id, admin_user_id, category_correct, action_correct,
       scope_expansion_error
     )
     SELECT 'evaluation-gate-' || value, 'run-gate-' || value,
            'admin-gate', true, true, false
     FROM generate_series(1, 32) AS value`
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

function fakeClient() {
  return { query: async () => assert.fail("injected metrics must not query the database") };
}

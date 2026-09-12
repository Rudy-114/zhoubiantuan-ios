import { config } from "../config.js";
import { evaluateSafetyPolicy } from "./policyEngine.js";
import {
  SAFETY_POLICY_FIXTURE_VERSION,
  safetyPolicyFixtures
} from "./fixtures/policyCases.js";
import { validateQwenCaseResult } from "./schemas/qwenCaseResult.js";

const AUTO_HIDE_ACTIONS = new Set([
  "hide_post",
  "hide_comment",
  "hide_message",
  "hide_collection_contact",
  "suspend_collection"
]);

export async function evaluateEnforcementGate(client, {
  loadMetrics = loadGateMetrics,
  ...options
} = {}) {
  requireClient(client);
  if (typeof loadMetrics !== "function") throw new TypeError("loadMetrics must be a function");
  const metrics = await loadMetrics(client, options);
  const checks = {
    fixtureCount: metrics.fixtureCount === 100,
    fixtureSchemaValid: metrics.fixtureInvalidCount === 0,
    autoHidePrecision: metrics.autoHidePrecision >= 0.95,
    realComparisons: metrics.realEvaluationCount >= 30,
    noScopeErrors: metrics.scopeExpansionErrors === 0,
    noAutomaticAccountActions: metrics.automaticAccountActions === 0,
    versionsMatch: metrics.versionsMatch === true,
    fixtureVersionCurrent: metrics.fixtureVersionCurrent === true
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    metrics
  };
}

export async function assertAutomaticActionsAllowed(client, options) {
  const gate = await evaluateEnforcementGate(client, options);
  if (gate.passed) return gate;
  const error = new Error("Automatic safety actions are not allowed");
  error.code = "enforcement_gate_closed";
  error.gate = gate;
  throw error;
}

export async function loadGateMetrics(client, {
  ai = config.safetyAi,
  requiredVersions,
  fixtures = safetyPolicyFixtures,
  fixtureVersion = SAFETY_POLICY_FIXTURE_VERSION
} = {}) {
  requireClient(client);
  const versions = normalizeVersions(ai);
  const evaluationVersions = requiredVersions
    ? normalizeVersions(requiredVersions)
    : versions;
  const evaluations = await client.query(
    `SELECT
       count(DISTINCT run.case_id)::int AS real_evaluations,
       count(*) FILTER (WHERE evaluation.category_correct)::int AS category_correct,
       count(*) FILTER (WHERE evaluation.action_correct)::int AS action_correct,
       count(*) FILTER (WHERE evaluation.scope_expansion_error)::int AS scope_expansion_errors
     FROM safety_ai_evaluations evaluation
     JOIN safety_ai_runs run ON run.id = evaluation.ai_run_id
     WHERE run.is_synthetic = false
       AND run.status = 'completed'
       AND run.model_version = $1
       AND run.prompt_version = $2
       AND run.policy_version = $3`,
    [evaluationVersions.model, evaluationVersions.prompt, evaluationVersions.policy]
  );
  const automaticAccountActions = await client.query(
    `SELECT count(*)::int AS count
     FROM safety_actions
     WHERE actor_type = 'ai'
       AND (target_type = 'user' OR action_type IN ('restrict_user', 'restore_user'))`
  );
  const fixtureMetrics = computeFixtureMetrics(fixtures, fixtureVersion);
  const evaluationMetrics = evaluations.rows[0] || {};

  return {
    fixtureVersion,
    fixtureCount: fixtureMetrics.count,
    fixtureInvalidCount: fixtureMetrics.invalidCount,
    autoHidePrecision: fixtureMetrics.autoHidePrecision,
    realEvaluationCount: evaluationMetrics.real_evaluations || 0,
    categoryCorrect: evaluationMetrics.category_correct || 0,
    actionCorrect: evaluationMetrics.action_correct || 0,
    scopeExpansionErrors: evaluationMetrics.scope_expansion_errors || 0,
    automaticAccountActions:
      fixtureMetrics.automaticAccountActions + (automaticAccountActions.rows[0]?.count || 0),
    versionsMatch: versionsEqual(versions, evaluationVersions),
    fixtureVersionCurrent:
      fixtureMetrics.versionCurrent && fixtureVersion === expectedFixtureVersion(versions.policy),
    versions,
    requiredVersions: evaluationVersions
  };
}

function computeFixtureMetrics(fixtures, fixtureVersion) {
  if (!Array.isArray(fixtures)) throw new TypeError("fixtures must be an array");
  if (typeof fixtureVersion !== "string" || !fixtureVersion) {
    throw new TypeError("fixtureVersion must be a nonempty string");
  }
  let invalidCount = 0;
  let proposedAutoHides = 0;
  let truePositiveAutoHides = 0;
  let automaticAccountActions = 0;
  let versionCurrent = true;

  for (const fixture of fixtures) {
    if (fixture?.version !== fixtureVersion || !String(fixture?.id || "").startsWith(`${fixtureVersion}:`)) {
      versionCurrent = false;
    }
    if (fixture?.qwenResult) {
      try {
        validateQwenCaseResult(fixture.qwenResult);
      } catch {
        invalidCount += 1;
      }
    } else if (!fixture?.providerFailure) {
      invalidCount += 1;
    }

    let result;
    try {
      result = evaluateSafetyPolicy(fixture?.caseInput);
    } catch {
      invalidCount += 1;
      continue;
    }
    for (const action of result.proposedActions) {
      if (action.targetType === "user" || /user|account/u.test(action.actionType)) {
        automaticAccountActions += 1;
      }
      if (AUTO_HIDE_ACTIONS.has(action.actionType)) {
        proposedAutoHides += 1;
        if (fixture.expectedActions?.includes(action.actionType)) truePositiveAutoHides += 1;
      }
    }
  }

  return {
    count: fixtures.length,
    invalidCount,
    autoHidePrecision: proposedAutoHides ? truePositiveAutoHides / proposedAutoHides : 0,
    automaticAccountActions,
    versionCurrent
  };
}

function normalizeVersions(value) {
  return {
    model: requiredVersion(value?.model, "model"),
    prompt: requiredVersion(value?.prompt ?? value?.promptVersion, "prompt"),
    policy: requiredVersion(value?.policy ?? value?.policyVersion, "policy")
  };
}

function versionsEqual(left, right) {
  return left.model === right.model && left.prompt === right.prompt && left.policy === right.policy;
}

function expectedFixtureVersion(policyVersion) {
  const match = /^safety-policy-(.+)$/u.exec(policyVersion);
  return match ? `safety-policy-fixtures-${match[1]}` : "";
}

function requiredVersion(value, name) {
  if (typeof value !== "string" || !value.trim() || Array.from(value.trim()).length > 160 ||
      /[\u0000-\u001F\u007F]/u.test(value)) {
    throw new TypeError(`${name} must be a bounded version`);
  }
  return value.trim();
}

function requireClient(client) {
  if (!client || typeof client.query !== "function") {
    throw new TypeError("enforcement gate requires a database client");
  }
}

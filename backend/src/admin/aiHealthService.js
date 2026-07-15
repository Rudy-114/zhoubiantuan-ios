import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { evaluateSafetyPolicy } from "../safety/policyEngine.js";
import {
  SAFETY_POLICY_FIXTURE_VERSION,
  safetyPolicyFixtures
} from "../safety/fixtures/policyCases.js";
import { validateQwenCaseResult } from "../safety/schemas/qwenCaseResult.js";
import { recordAdminAuditEvent } from "./auditService.js";
import { adminError } from "./deviceService.js";

const AUTO_HIDE_ACTIONS = new Set([
  "hide_post",
  "hide_comment",
  "hide_message",
  "hide_collection_contact",
  "suspend_collection"
]);

export async function loadAdminAIHealth(client, {
  safety = config.safety,
  ai = config.safetyAi,
  now = new Date()
} = {}) {
  requireClient(client);
  const versions = normalizedVersions(ai);
  const safeNow = validDate(now);
  const month = monthKey(safeNow);
  const jobs = await client.query(
    `SELECT
       count(*) FILTER (WHERE status = 'pending')::int AS pending,
       count(*) FILTER (WHERE status = 'running')::int AS running,
       count(*) FILTER (WHERE status = 'failed')::int AS failed
     FROM safety_jobs
     WHERE job_type = 'analyze_case'`
  );
  const budget = await client.query(
    `SELECT
       COALESCE(sum(reserved_cny) FILTER (WHERE status = 'reserved'), 0)::text AS reserved_cny,
       COALESCE(sum(actual_cny) FILTER (WHERE status = 'settled'), 0)::text AS actual_cny
     FROM safety_ai_usage
     WHERE month_key = $1`,
    [month]
  );
  const evaluations = await client.query(
    `SELECT
       count(*)::int AS real_evaluations,
       count(*) FILTER (WHERE evaluation.category_correct)::int AS category_correct,
       count(*) FILTER (WHERE evaluation.action_correct)::int AS action_correct,
       count(*) FILTER (WHERE evaluation.scope_expansion_error)::int AS scope_expansion_errors
     FROM safety_ai_evaluations evaluation
     JOIN safety_ai_runs run ON run.id = evaluation.ai_run_id
     WHERE run.is_synthetic = false
       AND run.model_version = $1
       AND run.prompt_version = $2
       AND run.policy_version = $3`,
    [versions.model, versions.prompt, versions.policy]
  );
  const automaticAccountActions = await client.query(
    `SELECT count(*)::int AS count
     FROM safety_actions
     WHERE actor_type = 'ai'
       AND (target_type = 'user' OR action_type IN ('restrict_user', 'restore_user'))`
  );
  const fixtureMetrics = computeFixtureMetrics();
  const evaluationMetrics = evaluations.rows[0];

  return {
    mode: aiMode(safety?.aiMode),
    providerState: providerState(safety, ai),
    jobs: {
      pending: jobs.rows[0]?.pending || 0,
      running: jobs.rows[0]?.running || 0,
      failed: jobs.rows[0]?.failed || 0
    },
    budget: {
      month,
      reservedCny: moneyNumber(budget.rows[0]?.reserved_cny),
      actualCny: moneyNumber(budget.rows[0]?.actual_cny),
      budgetCny: nonNegativeNumber(ai?.monthlyBudgetCny)
    },
    metrics: {
      fixtureVersion: SAFETY_POLICY_FIXTURE_VERSION,
      fixtureCount: safetyPolicyFixtures.length,
      fixtureSchemaFailures: fixtureMetrics.schemaFailures,
      autoHidePrecision: fixtureMetrics.autoHidePrecision,
      realEvaluations: evaluationMetrics?.real_evaluations || 0,
      categoryCorrect: evaluationMetrics?.category_correct || 0,
      actionCorrect: evaluationMetrics?.action_correct || 0,
      scopeExpansionErrors: evaluationMetrics?.scope_expansion_errors || 0,
      automaticAccountActions:
        fixtureMetrics.automaticAccountActions + (automaticAccountActions.rows[0]?.count || 0)
    },
    versions
  };
}

export async function loadCaseAIComparison(client, caseID) {
  requireClient(client);
  const caseId = requiredIdentifier(caseID, "案件 ID");
  const runResult = await client.query(
    `SELECT
       run.id, run.mode, run.status, run.model_version, run.prompt_version,
       run.policy_version, run.hard_signal, run.parsed_result, run.proposed_actions,
       run.error_code, run.input_tokens, run.output_tokens,
       run.estimated_cost_cny, run.completed_at, run.created_at,
       evaluation.id AS evaluation_id,
       evaluation.category_correct, evaluation.action_correct,
       evaluation.scope_expansion_error, evaluation.notes AS evaluation_notes,
       evaluation.created_at AS evaluation_created_at
     FROM safety_ai_runs run
     LEFT JOIN safety_ai_evaluations evaluation ON evaluation.ai_run_id = run.id
     WHERE run.case_id = $1 AND run.is_synthetic = false
     ORDER BY run.created_at DESC, run.id DESC
     LIMIT 1`,
    [caseId]
  );
  const decisionResult = await client.query(
    `SELECT event_data, created_at
     FROM safety_case_events
     WHERE case_id = $1 AND event_type = 'admin_decision_applied'
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [caseId]
  );
  const row = runResult.rows[0];
  return {
    run: row ? mapRun(row) : null,
    evaluation: row?.evaluation_id ? mapEvaluation(row) : null,
    humanDecision: decisionResult.rows[0] ? mapHumanDecision(decisionResult.rows[0]) : null
  };
}

export async function recordAdminAIEvaluation(client, input = {}) {
  requireClient(client);
  const caseId = requiredIdentifier(input.caseId, "案件 ID");
  const aiRunID = requiredIdentifier(input.aiRunID, "AI 运行 ID");
  const categoryCorrect = requiredBoolean(input.categoryCorrect, "分类判断");
  const actionCorrect = requiredBoolean(input.actionCorrect, "动作判断");
  const scopeExpansionError = requiredBoolean(input.scopeExpansionError, "范围扩张错误");
  const notes = optionalText(input.notes, "评估备注", 1000);
  const runResult = await client.query(
    `SELECT id, status, is_synthetic
     FROM safety_ai_runs
     WHERE id = $1 AND case_id = $2
     FOR UPDATE`,
    [aiRunID, caseId]
  );
  const run = runResult.rows[0];
  if (!run) throw adminError(404, "ai_run_not_found", "案件 AI 分析不存在");
  if (run.is_synthetic || run.status !== "completed") {
    throw adminError(409, "ai_run_not_evaluable", "该 AI 分析当前不能进行人工对比");
  }
  const decision = await client.query(
    `SELECT 1
     FROM safety_case_events
     WHERE case_id = $1 AND event_type = 'admin_decision_applied'
     LIMIT 1`,
    [caseId]
  );
  if (!decision.rows[0]) {
    throw adminError(409, "ai_evaluation_requires_decision", "请先提交最终人工决定");
  }

  let inserted;
  try {
    inserted = await client.query(
      `INSERT INTO safety_ai_evaluations (
         id, ai_run_id, admin_user_id, category_correct, action_correct,
         scope_expansion_error, notes
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        `saie-${randomUUID()}`,
        aiRunID,
        requiredIdentifier(input.adminUserId, "管理员 ID"),
        categoryCorrect,
        actionCorrect,
        scopeExpansionError,
        notes
      ]
    );
  } catch (error) {
    if (error?.code === "23505") {
      throw adminError(409, "ai_evaluation_exists", "该 AI 分析已经记录人工对比");
    }
    throw error;
  }
  await recordAdminAuditEvent(client, {
    adminUserId: input.adminUserId,
    deviceId: input.deviceId,
    sessionId: input.sessionId,
    eventType: "safety.ai_evaluated",
    subjectType: "safety_ai_run",
    subjectId: aiRunID,
    ip: input.ip,
    userAgent: input.userAgent,
    eventData: { caseId, categoryCorrect, actionCorrect, scopeExpansionError }
  });
  return mapInsertedEvaluation(inserted.rows[0]);
}

function computeFixtureMetrics() {
  let schemaFailures = 0;
  let proposedAutoHides = 0;
  let truePositiveAutoHides = 0;
  let automaticAccountActions = 0;
  for (const fixture of safetyPolicyFixtures) {
    if (fixture.qwenResult) {
      try {
        validateQwenCaseResult(fixture.qwenResult);
      } catch {
        schemaFailures += 1;
      }
    } else if (!fixture.providerFailure) {
      schemaFailures += 1;
    }
    const result = evaluateSafetyPolicy(fixture.caseInput);
    for (const action of result.proposedActions) {
      if (action.targetType === "user" || /user|account/u.test(action.actionType)) {
        automaticAccountActions += 1;
      }
      if (AUTO_HIDE_ACTIONS.has(action.actionType)) {
        proposedAutoHides += 1;
        if (fixture.expectedActions.includes(action.actionType)) truePositiveAutoHides += 1;
      }
    }
  }
  return {
    schemaFailures,
    autoHidePrecision: proposedAutoHides ? truePositiveAutoHides / proposedAutoHides : 0,
    automaticAccountActions
  };
}

function mapRun(row) {
  return {
    id: row.id,
    mode: row.mode,
    status: row.status,
    hardSignal: safeObject(row.hard_signal),
    result: safeObject(row.parsed_result),
    proposedActions: Array.isArray(row.proposed_actions) ? row.proposed_actions : [],
    errorCode: row.error_code || null,
    inputTokens: Number(row.input_tokens || 0),
    outputTokens: Number(row.output_tokens || 0),
    estimatedCostCny: moneyNumber(row.estimated_cost_cny),
    versions: {
      model: row.model_version,
      prompt: row.prompt_version,
      policy: row.policy_version
    },
    completedAt: isoDate(row.completed_at),
    createdAt: isoDate(row.created_at)
  };
}

function mapEvaluation(row) {
  return {
    id: row.evaluation_id,
    aiRunID: row.id,
    categoryCorrect: Boolean(row.category_correct),
    actionCorrect: Boolean(row.action_correct),
    scopeExpansionError: Boolean(row.scope_expansion_error),
    notes: row.evaluation_notes || "",
    createdAt: isoDate(row.evaluation_created_at)
  };
}

function mapInsertedEvaluation(row) {
  return {
    id: row.id,
    aiRunID: row.ai_run_id,
    categoryCorrect: Boolean(row.category_correct),
    actionCorrect: Boolean(row.action_correct),
    scopeExpansionError: Boolean(row.scope_expansion_error),
    notes: row.notes || "",
    createdAt: isoDate(row.created_at)
  };
}

function mapHumanDecision(row) {
  const data = safeObject(row.event_data);
  return {
    decision: typeof data.decision === "string" ? data.decision : "",
    reason: typeof data.reason === "string" ? data.reason : "",
    createdAt: isoDate(row.created_at)
  };
}

function providerState(safety, ai) {
  if (aiMode(safety?.aiMode) === "off") return "disabled";
  if (nonNegativeNumber(ai?.monthlyBudgetCny) === 0) return "budget_blocked";
  if (!ai?.apiKey || nonNegativeNumber(ai?.inputCnyPerMillion) === 0 ||
      nonNegativeNumber(ai?.outputCnyPerMillion) === 0) return "not_configured";
  return "ready";
}

function normalizedVersions(ai) {
  return {
    model: requiredIdentifier(ai?.model, "模型版本"),
    prompt: requiredIdentifier(ai?.promptVersion, "提示词版本"),
    policy: requiredIdentifier(ai?.policyVersion, "策略版本")
  };
}

function monthKey(now) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function moneyNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function nonNegativeNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function aiMode(value) {
  return ["off", "shadow", "enforce"].includes(value) ? value : "off";
}

function requiredIdentifier(value, label) {
  if (typeof value !== "string" || !value.trim() || Array.from(value.trim()).length > 160 ||
      /[\u0000-\u001F\u007F]/u.test(value)) {
    throw adminError(400, "admin_request_invalid", `${label}不正确`);
  }
  return value.trim();
}

function requiredBoolean(value, label) {
  if (typeof value !== "boolean") throw adminError(400, "admin_request_invalid", `${label}必须为布尔值`);
  return value;
}

function optionalText(value, label, maximum) {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || Array.from(value.trim()).length > maximum ||
      /[\u0000\u007F]/u.test(value)) {
    throw adminError(400, "admin_request_invalid", `${label}不正确`);
  }
  return value.trim();
}

function validDate(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("AI health now must be a valid date");
  return date;
}

function requireClient(client) {
  if (!client || typeof client.query !== "function") throw new TypeError("AI health requires a database client");
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function isoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

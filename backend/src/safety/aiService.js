import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { withTransaction as defaultWithTransaction } from "../db.js";
import { reviewSubmission } from "../moderation/index.js";
import { applySafetyAction } from "./actionService.js";
import { releaseAiBudget, reserveAiBudget, settleAiBudget } from "./budgetService.js";
import { evaluateSafetyPolicy } from "./policyEngine.js";
import { buildQwenCaseMessages, hashCaseEvidence } from "./promptBuilder.js";
import { MockQwenCaseProvider } from "./providers/mockQwenCaseProvider.js";
import { QwenCaseProvider, RAW_QWEN_CONTENT, providerError } from "./providers/qwenCaseProvider.js";
import { publishApprovedRevision } from "./revisionPublishing.js";
import { validateQwenCaseResult } from "./schemas/qwenCaseResult.js";
import { lockSafetyTarget } from "./safetyTargetLock.js";

const RAW_RESPONSE_LIMIT = 20_000;
const KNOWN_PROVIDER_ERRORS = new Set([
  "invalid_ai_result",
  "qwen_fixture_invalid",
  "qwen_fixture_not_found",
  "qwen_invalid_response",
  "qwen_not_configured",
  "qwen_provider_error",
  "qwen_rate_limited",
  "qwen_request_invalid",
  "qwen_timeout"
]);

export async function analyzeSafetyCase({
  caseId,
  revisionId = null,
  mode = config.safety.aiMode,
  aiConfig = config.safetyAi,
  withTransaction = defaultWithTransaction,
  moderation = reviewSubmission,
  providerFactory = defaultProviderFactory,
  applyAction = applySafetyAction,
  publishRevision = publishApprovedRevision,
  gatePassed = false,
  now = new Date()
} = {}) {
  const safeCaseId = requiredId(caseId, "caseId");
  const safeRevisionId = revisionId == null ? null : requiredId(revisionId, "revisionId");
  const safeMode = aiMode(mode);
  const safeNow = validDate(now);
  const safeAiConfig = normalizeAiConfig(aiConfig);
  if (typeof withTransaction !== "function") throw new TypeError("withTransaction must be a function");
  if (typeof moderation !== "function") throw new TypeError("moderation must be a function");
  if (typeof providerFactory !== "function") throw new TypeError("providerFactory must be a function");

  if (safeMode === "off") {
    await withTransaction((client) => client.query(
      "UPDATE safety_cases SET status = 'manual_review', updated_at = now() WHERE id = $1 AND status = 'received'",
      [safeCaseId]
    ));
    return { status: "manual_review", reason: "ai_off_or_unavailable", providerCalled: false };
  }

  const context = await withTransaction((client) => loadAnalysisContext(client, {
    caseId: safeCaseId,
    revisionId: safeRevisionId,
    now: safeNow
  }));
  const cached = await withTransaction((client) => findCompletedRunForCurrentEvidence(client, {
    context,
    aiConfig: safeAiConfig
  }));
  if (cached) return cachedResult(cached);
  const hardSignal = safeRevisionId
    ? sanitizeHardSignal(context.revision.review_summary)
    : await obtainHardSignal(moderation, context.moderationInput);
  const casePacket = buildCasePacket(context, hardSignal);
  const messages = buildQwenCaseMessages(casePacket);
  const evidenceHash = hashCaseEvidence(casePacket);

  const prepared = await withTransaction((client) => prepareAiRun(client, {
    context,
    mode: safeMode,
    aiConfig: safeAiConfig,
    evidenceHash,
    hardSignal,
    messages,
    now: safeNow
  }));
  if (prepared.kind === "cached") return cachedResult(prepared.run);
  if (prepared.kind === "blocked") {
    return { status: "budget_blocked", reason: prepared.reason, providerCalled: false };
  }
  if (prepared.kind === "existing") return existingRunResult(prepared.run);

  let provider;
  try {
    provider = await providerFactory({ mode: safeMode, aiConfig: safeAiConfig });
  } catch {
    provider = null;
  }
  if (!provider || typeof provider.analyze !== "function") {
    return finishProviderFailure({
      withTransaction,
      runId: prepared.runId,
      context,
      error: providerError("qwen_not_configured", { retryable: false, billingUncertain: false }),
      aiConfig: safeAiConfig,
      now: safeNow
    });
  }

  let providerOutput;
  try {
    providerOutput = await provider.analyze({ messages });
    providerOutput = {
      ...providerOutput,
      result: validateQwenCaseResult(providerOutput?.result)
    };
  } catch (error) {
    return finishProviderFailure({
      withTransaction,
      runId: prepared.runId,
      context,
      error,
      aiConfig: safeAiConfig,
      now: safeNow
    });
  }

  const policy = evaluateSafetyPolicy({
    mode: safeMode,
    caseRecord: context.caseRecord,
    qwenResult: providerOutput.result,
    hardSignal,
    reportCounts: context.reportCounts,
    hasValidRevision: Boolean(context.revision),
    now: safeNow
  });
  return withTransaction((client) => completeSuccessfulRun(client, {
    runId: prepared.runId,
    context,
    mode: safeMode,
    aiConfig: safeAiConfig,
    hardSignal,
    providerOutput,
    policy,
    gatePassed: gatePassed === true,
    applyAction,
    publishRevision,
    now: safeNow
  }));
}

async function loadAnalysisContext(client, { caseId, revisionId, now }) {
  const caseResult = await client.query(
    "SELECT *, updated_at::text AS case_version_exact FROM safety_cases WHERE id = $1 FOR UPDATE",
    [caseId]
  );
  if (!caseResult.rows[0]) throw analysisError("safety_case_not_found");
  const { case_version_exact: caseVersion, ...caseRecord } = caseResult.rows[0];

  const reports = await client.query(
    `SELECT reason_code, reported_field, detail, created_at
     FROM reports
     WHERE case_id = $1
     ORDER BY created_at, id`,
    [caseId]
  );
  const evidence = await client.query(
    `SELECT evidence_type, text_snapshot, structured_snapshot, object_keys, created_at
     FROM safety_evidence
     WHERE case_id = $1
     ORDER BY created_at, id`,
    [caseId]
  );
  const counts = await client.query(
    `SELECT
       count(*)::int AS report_count,
       count(DISTINCT reporter_id) FILTER (WHERE created_at >= $2::timestamptz - interval '7 days')::int AS independent_reporter_count_7d
     FROM reports
     WHERE case_id = $1`,
    [caseId, now]
  );
  const related = await client.query(
    `SELECT count(*)::int AS count
     FROM safety_cases
     WHERE subject_type = $1 AND subject_id = $2`,
    [caseRecord.subject_type, caseRecord.subject_id]
  );

  let revision = null;
  if (revisionId) {
    const revisionResult = await client.query(
      `SELECT * FROM content_revisions
       WHERE id = $1 AND case_id = $2
       FOR UPDATE`,
      [revisionId, caseId]
    );
    revision = revisionResult.rows[0];
    if (!revision) throw analysisError("content_revision_not_found");
  }

  const sourceEvidence = evidence.rows.find((row) => row.evidence_type !== "report_supplement") || evidence.rows[0];
  if (!sourceEvidence && !revision) throw analysisError("safety_evidence_not_found");
  const sourceSnapshot = revision
    ? safeObject(revision.snapshot)
    : safeObject(sourceEvidence.structured_snapshot?.source || sourceEvidence.structured_snapshot);
  const textSnapshot = revision
    ? sourceSnapshotText(sourceSnapshot)
    : sourceEvidence.text_snapshot || "";
  const supplementDetails = evidence.rows
    .filter((row) => row.evidence_type === "report_supplement")
    .map((row) => row.text_snapshot);
  const reportDetails = [...reports.rows.map((row) => row.detail), ...supplementDetails]
    .filter((value) => typeof value === "string" && value.trim());
  const ownerId = revision?.owner_id || await loadSubjectOwner(client, caseRecord);

  return {
    caseRecord,
    caseVersion,
    revision,
    report: {
      reasonCode: reports.rows[0]?.reason_code || caseRecord.category,
      reportedField: reports.rows[0]?.reported_field || "content",
      detail: [...new Set(reportDetails.map((value) => value.trim()))].join("\n---\n")
    },
    evidence: {
      evidenceType: revision?.target_type || sourceEvidence?.evidence_type || caseRecord.subject_type,
      textSnapshot,
      structuredSnapshot: sourceSnapshot
    },
    reportCounts: {
      reportCount: counts.rows[0]?.report_count || 0,
      independentReporterCount7d: counts.rows[0]?.independent_reporter_count_7d || 0,
      relatedCaseCount: related.rows[0]?.count || 0
    },
    moderationInput: {
      targetType: revision?.target_type || caseRecord.subject_type,
      targetId: revision?.id || caseRecord.subject_id,
      ownerId,
      text: textSnapshot,
      imageObjectKeys: revision
        ? revisionObjectKeys(revision)
        : sourceObjectKeys(sourceSnapshot)
    }
  };
}

function buildCasePacket(context, hardSignal) {
  return {
    caseRecord: context.caseRecord,
    report: context.report,
    evidence: context.evidence,
    hardSignal,
    aggregateCounts: context.reportCounts
  };
}

async function obtainHardSignal(moderation, input) {
  try {
    return sanitizeHardSignal(await moderation(input));
  } catch {
    return {
      outcome: "review",
      riskLevel: "medium",
      source: "systemRule",
      reason: "Hard-safety provider unavailable",
      labels: []
    };
  }
}

async function prepareAiRun(client, {
  context,
  mode,
  aiConfig,
  evidenceHash,
  hardSignal,
  messages,
  now
}) {
  const existing = await client.query(
    `SELECT * FROM safety_ai_runs
     WHERE case_id = $1 AND model_version = $2 AND prompt_version = $3
       AND policy_version = $4 AND evidence_hash = $5
     LIMIT 1
     FOR UPDATE`,
    [context.caseRecord.id, aiConfig.model, aiConfig.promptVersion, aiConfig.policyVersion, evidenceHash]
  );
  if (existing.rows[0]) {
    return { kind: existing.rows[0].status === "completed" ? "cached" : "existing", run: existing.rows[0] };
  }

  const runId = `sair-${randomUUID()}`;
  await client.query(
    `INSERT INTO safety_ai_runs (
       id, case_id, model_version, prompt_version, policy_version,
       evidence_hash, mode, status, hard_signal, started_at, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'reserved', $8::jsonb, $9, $9)`,
    [
      runId,
      context.caseRecord.id,
      aiConfig.model,
      aiConfig.promptVersion,
      aiConfig.policyVersion,
      evidenceHash,
      mode,
      JSON.stringify(hardSignal),
      now
    ]
  );
  const reservation = await reserveAiBudget(client, {
    aiRunId: runId,
    messages,
    monthlyBudgetCny: aiConfig.monthlyBudgetCny,
    inputCnyPerMillion: aiConfig.inputCnyPerMillion,
    outputCnyPerMillion: aiConfig.outputCnyPerMillion,
    maxCompletionTokens: aiConfig.maxCompletionTokens,
    now
  });
  if (!reservation.ok) {
    await client.query(
      `UPDATE safety_ai_runs
       SET status = 'budget_blocked', error_code = $2, completed_at = $3
       WHERE id = $1`,
      [runId, reservation.reason, now]
    );
    await moveCaseToManualIfCurrent(client, context, now);
    return { kind: "blocked", reason: reservation.reason, runId };
  }
  await client.query("UPDATE safety_ai_runs SET status = 'running' WHERE id = $1", [runId]);
  return { kind: "ready", runId, reservation };
}

async function findCompletedRunForCurrentEvidence(client, { context, aiConfig }) {
  const candidates = await client.query(
    `SELECT * FROM safety_ai_runs
     WHERE case_id = $1 AND model_version = $2 AND prompt_version = $3
       AND policy_version = $4 AND status = 'completed'
     ORDER BY created_at DESC, id DESC
     LIMIT 20`,
    [context.caseRecord.id, aiConfig.model, aiConfig.promptVersion, aiConfig.policyVersion]
  );
  for (const run of candidates.rows) {
    const priorHardSignal = sanitizeHardSignal(run.hard_signal);
    const currentHash = hashCaseEvidence(buildCasePacket(context, priorHardSignal));
    if (currentHash === run.evidence_hash) return run;
  }
  return null;
}

async function completeSuccessfulRun(client, {
  runId,
  context,
  mode,
  aiConfig,
  hardSignal,
  providerOutput,
  policy,
  gatePassed,
  applyAction,
  publishRevision,
  now
}) {
  await settleAiBudget(client, {
    aiRunId: runId,
    inputTokens: providerOutput.usage.inputTokens,
    outputTokens: providerOutput.usage.outputTokens,
    inputCnyPerMillion: aiConfig.inputCnyPerMillion,
    outputCnyPerMillion: aiConfig.outputCnyPerMillion,
    now
  });

  const apply = mode === "enforce" && gatePassed;
  if (apply) {
    await lockSafetyTarget(client, context.caseRecord.subject_type, context.caseRecord.subject_id);
  }
  const current = await lockCurrentCase(client, context.caseRecord.id, context.caseVersion);
  const stale = current.version_matches !== true;
  await client.query(
    `UPDATE safety_ai_runs
     SET status = 'completed', hard_signal = $2::jsonb, parsed_result = $3::jsonb,
         proposed_actions = $4::jsonb, raw_response = $5, error_code = $6,
         completed_at = $7
     WHERE id = $1`,
    [
      runId,
      JSON.stringify(hardSignal),
      JSON.stringify(providerOutput.result),
      JSON.stringify(policy.proposedActions),
      boundedRaw(providerOutput.rawContent || JSON.stringify(providerOutput.result)),
      stale ? "stale_case_version" : null,
      now
    ]
  );
  if (stale) {
    return { status: "completed", stale: true, policy, providerCalled: true, syncEvents: [] };
  }

  await client.query(
    `UPDATE safety_cases
     SET risk_level = $2, confidence = $3, ai_recommendation = $4::jsonb,
         model_version = $5, prompt_version = $6, policy_version = $7,
         updated_at = $8
     WHERE id = $1`,
    [
      current.id,
      providerOutput.result.riskLevel,
      providerOutput.result.confidence,
      JSON.stringify({
        runID: runId,
        mode,
        proposedActions: policy.proposedActions,
        requiresHuman: policy.requiresHuman,
        reasonCodes: policy.reasonCodes
      }),
      aiConfig.model,
      aiConfig.promptVersion,
      aiConfig.policyVersion,
      now
    ]
  );

  const syncEvents = [];
  let revisionPublished = false;
  if (apply && context.revision && policy.reasonCodes.includes("revision_safe_to_publish")) {
    const published = await publishRevision(client, context.revision.id, {
      actorType: "policy",
      qwenResult: providerOutput.result,
      policyVersion: aiConfig.policyVersion
    });
    revisionPublished = published.published === true;
    syncEvents.push(...(published.syncEvents || []));
  } else if (apply) {
    for (const proposal of policy.proposedActions) {
      const applied = await applyAction(client, {
        caseId: current.id,
        idempotencyKey: `ai:${runId}:${proposal.actionType}`,
        actionType: proposal.actionType,
        targetType: proposal.targetType,
        targetId: proposal.targetId,
        actorType: "ai",
        actorId: `policy:${aiConfig.policyVersion}`,
        reason: policy.reasonCodes.join(","),
        correctionDueAt: proposal.correctionDueAt
      });
      syncEvents.push(...(applied.syncEvents || []));
    }
  }
  if (!revisionPublished) {
    const operationalStatus = apply ? policy.nextStatus : "manual_review";
    await client.query(
      "UPDATE safety_cases SET status = $2, updated_at = $3 WHERE id = $1",
      [current.id, operationalStatus, now]
    );
  }
  return {
    status: "completed",
    stale: false,
    policy,
    providerCalled: true,
    applied: apply && (revisionPublished || policy.proposedActions.length > 0),
    syncEvents
  };
}

async function finishProviderFailure({
  withTransaction,
  runId,
  context,
  error,
  aiConfig,
  now
}) {
  const errorCode = safeProviderErrorCode(error);
  const runStatus = ["invalid_ai_result", "qwen_invalid_response"].includes(errorCode) ? "invalid" : "failed";
  return withTransaction(async (client) => {
    if (validUsage(error?.usage)) {
      await settleAiBudget(client, {
        aiRunId: runId,
        inputTokens: error.usage.inputTokens,
        outputTokens: error.usage.outputTokens,
        inputCnyPerMillion: aiConfig.inputCnyPerMillion,
        outputCnyPerMillion: aiConfig.outputCnyPerMillion,
        now
      });
    } else if (error?.billingUncertain === true) {
      await settleAiBudget(client, {
        aiRunId: runId,
        inputTokens: 0,
        outputTokens: 0,
        uncertain: true,
        now
      });
    } else {
      await releaseAiBudget(client, { aiRunId: runId, now });
    }
    await client.query(
      `UPDATE safety_ai_runs
       SET status = $2, raw_response = $3, error_code = $4, completed_at = $5
       WHERE id = $1`,
      [runId, runStatus, boundedRaw(error?.[RAW_QWEN_CONTENT]), errorCode, now]
    );
    await moveCaseToManualIfCurrent(client, context, now);
    return { status: runStatus, reason: errorCode, providerCalled: true };
  });
}

async function moveCaseToManualIfCurrent(client, context, now) {
  await client.query(
    `UPDATE safety_cases
     SET status = 'manual_review', updated_at = $3
     WHERE id = $1 AND updated_at = $2`,
    [context.caseRecord.id, context.caseVersion, now]
  );
}

async function lockCurrentCase(client, caseId, caseVersion) {
  const result = await client.query(
    `SELECT *, updated_at = $2::timestamptz AS version_matches
     FROM safety_cases
     WHERE id = $1
     FOR UPDATE`,
    [caseId, caseVersion]
  );
  if (!result.rows[0]) throw analysisError("safety_case_not_found");
  return result.rows[0];
}

async function loadSubjectOwner(client, caseRecord) {
  const source = {
    post: { table: "posts", owner: "author_id" },
    comment: { table: "comments", owner: "author_id" },
    user: { table: "users", owner: "id" },
    direct_message: { table: "direct_messages", owner: "sender_id" },
    collection: { table: "group_collections", owner: "owner_id" }
  }[caseRecord.subject_type];
  if (!source) return "";
  const result = await client.query(
    `SELECT ${source.owner} AS owner_id FROM ${source.table} WHERE id = $1`,
    [caseRecord.subject_id]
  );
  return result.rows[0]?.owner_id || "";
}

function sourceObjectKeys(snapshot) {
  const keys = [];
  for (const key of ["imageObjectKeys", "previewImageObjectKeys"]) {
    if (Array.isArray(snapshot[key])) keys.push(...snapshot[key]);
  }
  if (Array.isArray(snapshot.messages)) {
    keys.push(...snapshot.messages.map((message) => message?.imageObjectKey));
  }
  for (const key of ["avatarObjectKey", "backgroundObjectKey"]) keys.push(snapshot[key]);
  return [...new Set(keys.filter((value) => typeof value === "string" && value))];
}

function revisionObjectKeys(revision) {
  const snapshot = safeObject(revision.snapshot);
  return [...new Set([
    ...(Array.isArray(snapshot.imageObjectKeys) ? snapshot.imageObjectKeys : []),
    ...(Array.isArray(snapshot.previewImageObjectKeys) ? snapshot.previewImageObjectKeys : []),
    ...(Array.isArray(revision.object_keys) ? revision.object_keys : [])
  ])];
}

function sourceSnapshotText(snapshot) {
  return Object.values(snapshot)
    .filter((value) => typeof value === "string" || typeof value === "number")
    .map(String)
    .join("\n")
    .slice(0, 6_000);
}

function sanitizeHardSignal(value) {
  const signal = safeObject(value);
  const raw = safeObject(signal.rawSummary || signal.raw_summary);
  const labels = Array.isArray(signal.labels) ? signal.labels : raw.labels;
  const hardSafety = safeObject(signal.hardSafety || signal.hard_safety);
  const result = {
    outcome: allowedValue(signal.outcome, ["pass", "review", "block"], "review"),
    riskLevel: allowedValue(signal.riskLevel || signal.risk_level, ["none", "low", "medium", "high", "urgent"], "medium"),
    source: boundedText(signal.source, 80, "systemRule"),
    reason: boundedText(signal.reason, 1_000, "Hard-safety review required"),
    labels: Array.isArray(labels)
      ? labels.slice(0, 20).map((label) => boundedText(label, 120, "")).filter(Boolean)
      : []
  };
  if (hardSafety.provider === "aliyun" && typeof hardSafety.passed === "boolean") {
    result.hardSafety = { provider: "aliyun", passed: hardSafety.passed };
  }
  return result;
}

function cachedResult(run) {
  return {
    status: "completed",
    cached: true,
    providerCalled: false,
    runId: run.id,
    policy: {
      proposedActions: run.proposed_actions || []
    }
  };
}

function existingRunResult(run) {
  return {
    status: run.status,
    cached: false,
    providerCalled: false,
    runId: run.id
  };
}

function defaultProviderFactory({ aiConfig }) {
  if (config.nodeEnv === "production") {
    if (!aiConfig.apiKey || aiConfig.inputCnyPerMillion <= 0 || aiConfig.outputCnyPerMillion <= 0) return null;
    return new QwenCaseProvider({
      baseUrl: aiConfig.baseUrl,
      apiKey: aiConfig.apiKey,
      timeoutMs: aiConfig.timeoutMs
    });
  }
  return new MockQwenCaseProvider();
}

function normalizeAiConfig(value) {
  const candidate = safeObject(value);
  return {
    baseUrl: typeof candidate.baseUrl === "string" ? candidate.baseUrl : "",
    apiKey: typeof candidate.apiKey === "string" ? candidate.apiKey : "",
    model: requiredVersion(candidate.model, "model"),
    promptVersion: requiredVersion(candidate.promptVersion, "promptVersion"),
    policyVersion: requiredVersion(candidate.policyVersion, "policyVersion"),
    monthlyBudgetCny: nonNegativeNumber(candidate.monthlyBudgetCny, "monthlyBudgetCny"),
    inputCnyPerMillion: nonNegativeNumber(candidate.inputCnyPerMillion, "inputCnyPerMillion"),
    outputCnyPerMillion: nonNegativeNumber(candidate.outputCnyPerMillion, "outputCnyPerMillion"),
    maxCompletionTokens: positiveInteger(candidate.maxCompletionTokens ?? 900, "maxCompletionTokens"),
    timeoutMs: positiveInteger(candidate.timeoutMs ?? 12_000, "timeoutMs")
  };
}

function validUsage(value) {
  return value && Number.isSafeInteger(value.inputTokens) && value.inputTokens >= 0 &&
    Number.isSafeInteger(value.outputTokens) && value.outputTokens >= 0;
}

function safeProviderErrorCode(error) {
  return KNOWN_PROVIDER_ERRORS.has(error?.code) ? error.code : "qwen_provider_error";
}

function boundedRaw(value) {
  return typeof value === "string" ? Array.from(value).slice(0, RAW_RESPONSE_LIMIT).join("") : "";
}

function boundedText(value, limit, fallback) {
  if (typeof value !== "string") return fallback;
  const text = Array.from(value.trim()).slice(0, limit).join("");
  return text || fallback;
}

function allowedValue(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function requiredVersion(value, name) {
  if (typeof value !== "string" || !value.trim() || Array.from(value.trim()).length > 160) {
    throw new TypeError(`${name} must be a bounded string`);
  }
  return value.trim();
}

function nonNegativeNumber(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${name} must be nonnegative`);
  return value;
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be positive`);
  return value;
}

function requiredId(value, name) {
  if (typeof value !== "string" || !value.trim() || Array.from(value.trim()).length > 160) {
    throw new TypeError(`${name} must be a bounded string`);
  }
  return value.trim();
}

function validDate(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("now must be a valid date");
  return date;
}

function aiMode(value) {
  if (!["off", "shadow", "enforce"].includes(value)) throw new TypeError("mode must be off, shadow, or enforce");
  return value;
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function analysisError(code) {
  const error = new Error("Safety AI analysis failed");
  error.code = code;
  return error;
}

import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const FIXED_MODEL = "qwen3.7-plus-2026-05-26";
const MAX_COMPLETION_TOKENS = 900;
const PROVIDER_ATTEMPT_STATUSES = Object.freeze([
  "reserved",
  "running",
  "completed",
  "invalid",
  "failed"
]);
const DIAGNOSTIC_BLOCKING_STATUSES = Object.freeze(["reserved", "running", "completed"]);
const SAFE_VALIDATION_KEYWORDS = new Set([
  "additionalProperties",
  "enum",
  "maximum",
  "maxItems",
  "maxLength",
  "minimum",
  "minLength",
  "required",
  "type"
]);
const SAFE_VALIDATION_SCHEMA_PATHS = new Set([
  "#/type",
  "#/additionalProperties",
  "#/required",
  "#/properties/category/enum",
  "#/properties/subjectType/enum",
  "#/properties/impactScope/enum",
  "#/properties/riskLevel/enum",
  "#/properties/confidence/type",
  "#/properties/confidence/minimum",
  "#/properties/confidence/maximum",
  "#/properties/evidence/type",
  "#/properties/evidence/maxItems",
  "#/properties/evidence/items/type",
  "#/properties/evidence/items/additionalProperties",
  "#/properties/evidence/items/required",
  "#/properties/evidence/items/properties/source/enum",
  "#/properties/evidence/items/properties/fact/type",
  "#/properties/evidence/items/properties/fact/minLength",
  "#/properties/evidence/items/properties/fact/maxLength",
  "#/properties/recommendedAction/enum",
  "#/properties/requiresHuman/type",
  "#/properties/summary/type",
  "#/properties/summary/minLength",
  "#/properties/summary/maxLength"
]);
const SAFE_TOP_LEVEL_INSTANCE_PATHS = new Set([
  "/category",
  "/subjectType",
  "/impactScope",
  "/riskLevel",
  "/confidence",
  "/recommendedAction",
  "/requiresHuman",
  "/summary"
]);
const KNOWN_FAILURE_CODES = new Set([
  "invalid_ai_result",
  "qwen_invalid_response",
  "qwen_not_configured",
  "qwen_provider_error",
  "qwen_rate_limited",
  "qwen_request_invalid",
  "qwen_timeout"
]);

export async function runValidateQwen({
  argv = process.argv.slice(2),
  stdout = process.stdout,
  loadRuntime = loadValidationRuntime
} = {}) {
  const options = parseValidationArguments(argv);
  if (!stdout || typeof stdout.write !== "function") {
    throw new TypeError("stdout must be writable");
  }

  let runtime;
  try {
    runtime = await loadRuntime(options);
    if (!runtime || typeof runtime.validateOnce !== "function") {
      throw new TypeError("validation runtime is invalid");
    }
    const summary = publicValidationSummary(await runtime.validateOnce(), {
      includeValidationIssues: options.diagnosticAttempt === true
    });
    stdout.write(`${JSON.stringify(summary)}\n`);
    return summary;
  } finally {
    if (runtime && typeof runtime.close === "function") await runtime.close();
  }
}

export function parseValidationArguments(argv) {
  if (!Array.isArray(argv)) throw cliError("invalid_validation_arguments", "验证参数无效");
  if (argv.length === 0) {
    throw cliError(
      "spend_confirmation_required",
      "拒绝执行：真实 Qwen 验证需要显式传入 --confirm-spend"
    );
  }
  if (argv.length === 1 && argv[0] === "--confirm-spend") {
    return Object.freeze({ confirmSpend: true });
  }
  if (argv.length === 3 &&
      argv[0] === "--confirm-spend" &&
      argv[1] === "--diagnostic-attempt" &&
      argv[2].startsWith("--hard-cap-cny=")) {
    const hardCapCny = Number(argv[2].slice("--hard-cap-cny=".length));
    if (Number.isFinite(hardCapCny) && hardCapCny > 0 && hardCapCny <= 1) {
      return Object.freeze({ confirmSpend: true, diagnosticAttempt: true, hardCapCny });
    }
  }
  throw cliError(
    "invalid_validation_arguments",
    "用法：node backend/scripts/validate-qwen.js --confirm-spend [--diagnostic-attempt --hard-cap-cny=1]"
  );
}

export async function validateQwenOnce({
  mode,
  autoActionsEnabled,
  diagnosticAttempt = false,
  totalBudgetCny,
  aiConfig,
  withTransaction,
  reserveBudget,
  settleBudget,
  releaseBudget,
  buildMessages,
  hashEvidence,
  validateResult,
  providerFactory,
  randomUUIDImpl = randomUUID,
  now = new Date()
} = {}) {
  assertValidationMode(mode, autoActionsEnabled);
  if (typeof diagnosticAttempt !== "boolean") {
    throw new TypeError("diagnosticAttempt must be boolean");
  }
  const safeTotalBudgetCny = diagnosticAttempt
    ? normalizeDiagnosticTotalBudget(totalBudgetCny)
    : null;
  const safeConfig = normalizeValidationConfig(aiConfig);
  const safeNow = validDate(now);
  assertDependencies({
    withTransaction,
    reserveBudget,
    settleBudget,
    releaseBudget,
    buildMessages,
    hashEvidence,
    validateResult,
    providerFactory,
    randomUUIDImpl
  });

  const casePacket = syntheticInvalidContactPacket();
  const messages = buildMessages(casePacket);
  const evidenceHash = hashEvidence(casePacket);
  const caseId = `sc-qwen-validation-${safeUUID(randomUUIDImpl())}`;
  const runId = `sair-${safeUUID(randomUUIDImpl())}`;
  const subjectId = `synthetic-qwen-validation-${safeUUID(randomUUIDImpl())}`;
  const hardSignal = casePacket.hardSignal;

  const prepared = await withTransaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('safety-ai-validation:' || $1::text))",
      [safeConfig.model]
    );
    const previous = await client.query(
      `SELECT id
       FROM safety_ai_runs
       WHERE is_synthetic = true
         AND model_version = $1
         AND prompt_version = $2
         AND policy_version = $3
         AND status = ANY($4::text[])
       LIMIT 1`,
      [
        safeConfig.model,
        safeConfig.promptVersion,
        safeConfig.policyVersion,
        diagnosticAttempt ? DIAGNOSTIC_BLOCKING_STATUSES : PROVIDER_ATTEMPT_STATUSES
      ]
    );
    if (previous.rows[0]) throw validationError("validation_already_attempted");

    await client.query(
      `INSERT INTO safety_cases (
         id, subject_type, subject_id, category, impact_scope,
         status, resolved_at, created_at, updated_at
       ) VALUES ($1, 'collection', $2, 'invalid_contact', 'collection',
                 'resolved_no_action', $3, $3, $3)`,
      [caseId, subjectId, safeNow]
    );
    await client.query(
      `INSERT INTO safety_ai_runs (
         id, case_id, model_version, prompt_version, policy_version,
         evidence_hash, is_synthetic, mode, status, hard_signal,
         started_at, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, true, 'shadow', 'reserved', $7::jsonb, $8, $8)`,
      [
        runId,
        caseId,
        safeConfig.model,
        safeConfig.promptVersion,
        safeConfig.policyVersion,
        evidenceHash,
        JSON.stringify(hardSignal),
        safeNow
      ]
    );
    const reservation = await reserveBudget(client, {
      aiRunId: runId,
      messages,
      monthlyBudgetCny: safeConfig.monthlyBudgetCny,
      ...(safeTotalBudgetCny == null ? {} : { totalBudgetCny: safeTotalBudgetCny }),
      inputCnyPerMillion: safeConfig.inputCnyPerMillion,
      outputCnyPerMillion: safeConfig.outputCnyPerMillion,
      maxCompletionTokens: MAX_COMPLETION_TOKENS,
      now: safeNow
    });
    if (!reservation.ok) {
      await client.query(
        `UPDATE safety_ai_runs
         SET status = 'budget_blocked', error_code = $2, completed_at = $3
         WHERE id = $1`,
        [runId, safeFailureCode(reservation.reason), safeNow]
      );
      return { ready: false };
    }
    await client.query("UPDATE safety_ai_runs SET status = 'running' WHERE id = $1", [runId]);
    return { ready: true };
  });

  if (!prepared.ready) {
    return publicValidationSummary(emptySummary(safeConfig.model), {
      includeValidationIssues: diagnosticAttempt
    });
  }

  let output;
  let result;
  try {
    const provider = await providerFactory({ aiConfig: safeConfig });
    if (!provider || typeof provider.analyze !== "function") {
      throw providerFailure("qwen_not_configured", { billingUncertain: false });
    }
    output = await provider.analyze({ messages });
    try {
      result = validateResult(output?.result);
    } catch (error) {
      attachBillableContext(error, output);
      throw error;
    }
    if (!validUsage(output?.usage)) {
      throw providerFailure("qwen_invalid_response", {
        billingUncertain: true,
        requestId: safeRequestId(output?.requestId)
      });
    }
  } catch (error) {
    return finishFailedValidation({
      error,
      runId,
      config: safeConfig,
      withTransaction,
      settleBudget,
      releaseBudget,
      includeValidationIssues: diagnosticAttempt,
      now: safeNow
    });
  }

  const passed = expectedSyntheticResult(result);
  const settled = await withTransaction(async (client) => {
    const usage = await settleBudget(client, {
      aiRunId: runId,
      inputTokens: output.usage.inputTokens,
      outputTokens: output.usage.outputTokens,
      inputCnyPerMillion: safeConfig.inputCnyPerMillion,
      outputCnyPerMillion: safeConfig.outputCnyPerMillion,
      now: safeNow
    });
    await client.query(
      `UPDATE safety_ai_runs
       SET status = 'completed', parsed_result = $2::jsonb, raw_response = '',
           error_code = $3, completed_at = $4
       WHERE id = $1`,
      [runId, JSON.stringify(result), passed ? null : "synthetic_expectation_failed", safeNow]
    );
    return usage;
  });

  return publicValidationSummary({
    model: safeConfig.model,
    requestId: safeRequestId(output.requestId),
    inputTokens: output.usage.inputTokens,
    outputTokens: output.usage.outputTokens,
    estimatedCostCny: settled.actualCny,
    pass: passed,
    validationIssues: []
  }, {
    includeValidationIssues: diagnosticAttempt
  });
}

async function finishFailedValidation({
  error,
  runId,
  config,
  withTransaction,
  settleBudget,
  releaseBudget,
  includeValidationIssues,
  now
}) {
  const usage = validUsage(error?.usage) ? error.usage : null;
  const failure = await withTransaction(async (client) => {
    let cost = 0;
    if (usage) {
      const settled = await settleBudget(client, {
        aiRunId: runId,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        inputCnyPerMillion: config.inputCnyPerMillion,
        outputCnyPerMillion: config.outputCnyPerMillion,
        now
      });
      cost = settled.actualCny;
    } else if (error?.billingUncertain === true) {
      const settled = await settleBudget(client, {
        aiRunId: runId,
        inputTokens: 0,
        outputTokens: 0,
        uncertain: true,
        now
      });
      cost = settled.actualCny;
    } else {
      await releaseBudget(client, { aiRunId: runId, now });
    }
    const errorCode = safeFailureCode(error?.code);
    const status = ["invalid_ai_result", "qwen_invalid_response"].includes(errorCode)
      ? "invalid"
      : "failed";
    await client.query(
      `UPDATE safety_ai_runs
       SET status = $2, raw_response = '', error_code = $3, completed_at = $4
       WHERE id = $1`,
      [runId, status, errorCode, now]
    );
    return { cost };
  });

  return publicValidationSummary({
    model: config.model,
    requestId: safeRequestId(error?.requestId),
    inputTokens: usage?.inputTokens || 0,
    outputTokens: usage?.outputTokens || 0,
    estimatedCostCny: failure.cost,
    pass: false,
    validationIssues: error?.validationIssues
  }, {
    includeValidationIssues
  });
}

function syntheticInvalidContactPacket() {
  return {
    caseRecord: {
      category: "invalid_contact",
      impactScope: "collection",
      subjectType: "collection"
    },
    report: {
      reasonCode: "invalid_contact",
      reportedField: "contact_wechat",
      detail: "Synthetic validation only: the collection contact channel is unavailable."
    },
    evidence: {
      evidenceType: "collection",
      textSnapshot: "Synthetic validation collection with an unavailable contact channel.",
      structuredSnapshot: {
        name: "Synthetic Qwen validation collection",
        contactWechat: "synthetic_unavailable",
        contactVisibility: "active",
        safetyStatus: "active",
        status: "active"
      }
    },
    hardSignal: {
      outcome: "pass",
      riskLevel: "none",
      source: "systemRule",
      reason: "Synthetic validation has no hard-safety signal.",
      labels: []
    },
    aggregateCounts: {
      reportCount: 2,
      independentReporterCount: 2,
      relatedCaseCount: 1
    }
  };
}

function expectedSyntheticResult(result) {
  return result?.category === "invalid_contact" &&
    result.subjectType === "collection" &&
    result.impactScope === "collection";
}

function normalizeValidationConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("aiConfig must be an object");
  }
  if (value.model !== FIXED_MODEL) throw validationError("validation_model_mismatch");
  const normalized = {
    baseUrl: typeof value.baseUrl === "string" ? value.baseUrl : "",
    apiKey: typeof value.apiKey === "string" ? value.apiKey : "",
    model: FIXED_MODEL,
    promptVersion: boundedVersion(value.promptVersion, "promptVersion"),
    policyVersion: boundedVersion(value.policyVersion, "policyVersion"),
    monthlyBudgetCny: nonNegativeNumber(value.monthlyBudgetCny, "monthlyBudgetCny"),
    inputCnyPerMillion: nonNegativeNumber(value.inputCnyPerMillion, "inputCnyPerMillion"),
    outputCnyPerMillion: nonNegativeNumber(value.outputCnyPerMillion, "outputCnyPerMillion"),
    timeoutMs: positiveInteger(value.timeoutMs ?? 12_000, "timeoutMs")
  };
  if (normalized.monthlyBudgetCny > 0 && !normalized.apiKey) {
    throw validationError("validation_api_key_missing");
  }
  if (normalized.monthlyBudgetCny > 0 &&
      (normalized.inputCnyPerMillion <= 0 || normalized.outputCnyPerMillion <= 0)) {
    throw validationError("validation_rates_missing");
  }
  if (normalized.monthlyBudgetCny > 0 && !isOfficialValidationBaseUrl(normalized.baseUrl)) {
    throw validationError("validation_base_url_invalid");
  }
  return normalized;
}

function normalizeDiagnosticTotalBudget(value) {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw validationError("validation_total_budget_invalid");
  }
  return value;
}

function isOfficialValidationBaseUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "dashscope.aliyuncs.com" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      url.pathname.replace(/\/+$/u, "") === "/compatible-mode/v1";
  } catch {
    return false;
  }
}

function publicValidationSummary(value, { includeValidationIssues = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("validation summary must be an object");
  }
  if (value.model !== FIXED_MODEL) throw new TypeError("validation summary model is invalid");
  const summary = {
    model: FIXED_MODEL,
    requestId: safeRequestId(value.requestId),
    inputTokens: nonNegativeInteger(value.inputTokens, "inputTokens"),
    outputTokens: nonNegativeInteger(value.outputTokens, "outputTokens"),
    estimatedCostCny: nonNegativeNumber(value.estimatedCostCny, "estimatedCostCny"),
    pass: value.pass === true
  };
  if (includeValidationIssues) {
    summary.validationIssues = safeValidationIssues(value.validationIssues);
  }
  return summary;
}

function safeValidationIssues(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((issue) => {
    if (!issue || typeof issue !== "object" || Array.isArray(issue)) return [];
    const instancePath = boundedDiagnosticString(issue.instancePath, 200);
    const keyword = boundedDiagnosticString(issue.keyword, 80);
    const schemaPath = boundedDiagnosticString(issue.schemaPath, 240);
    if (instancePath == null || keyword == null || schemaPath == null) return [];
    if (!safeValidationInstancePath(instancePath) ||
        !SAFE_VALIDATION_KEYWORDS.has(keyword) ||
        !SAFE_VALIDATION_SCHEMA_PATHS.has(schemaPath)) return [];
    return [{ instancePath, keyword, schemaPath }];
  });
}

function safeValidationInstancePath(value) {
  return value === "" ||
    SAFE_TOP_LEVEL_INSTANCE_PATHS.has(value) ||
    /^\/evidence(?:\/(?:0|[1-9]\d*)(?:\/(?:source|fact))?)?$/u.test(value);
}

function boundedDiagnosticString(value, maxLength) {
  if (typeof value !== "string" || Array.from(value).length > maxLength) return null;
  return value;
}

function emptySummary(model) {
  return {
    model,
    requestId: "",
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostCny: 0,
    pass: false
  };
}

function assertValidationMode(mode, autoActionsEnabled) {
  if (mode !== "shadow") throw validationError("validation_requires_shadow_mode");
  if (autoActionsEnabled !== false) throw validationError("validation_requires_actions_disabled");
}

function assertDependencies(dependencies) {
  for (const [name, dependency] of Object.entries(dependencies)) {
    if (typeof dependency !== "function") throw new TypeError(`${name} must be a function`);
  }
}

function attachBillableContext(error, output) {
  if (!error || typeof error !== "object") return;
  if (validUsage(output?.usage)) error.usage = output.usage;
  error.requestId = safeRequestId(output?.requestId);
  error.billingUncertain = true;
}

function providerFailure(code, { billingUncertain, requestId = "" }) {
  const error = new Error("Qwen validation provider failed");
  error.code = code;
  error.billingUncertain = billingUncertain === true;
  error.requestId = requestId;
  return error;
}

function safeFailureCode(value) {
  if (typeof value === "string" && /^(?:budget_[a-z_]+)$/u.test(value)) return value.slice(0, 80);
  return KNOWN_FAILURE_CODES.has(value) ? value : "qwen_provider_error";
}

function validUsage(value) {
  return value && Number.isSafeInteger(value.inputTokens) && value.inputTokens >= 0 &&
    Number.isSafeInteger(value.outputTokens) && value.outputTokens >= 0;
}

function safeRequestId(value) {
  if (typeof value !== "string") return "";
  return Array.from(value.trim()).slice(0, 160).join("");
}

function safeUUID(value) {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/iu.test(value)) {
    throw new TypeError("randomUUIDImpl must return a UUID");
  }
  return value.toLowerCase();
}

function boundedVersion(value, name) {
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

function nonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be nonnegative`);
  return value;
}

function validDate(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("now must be a valid date");
  return date;
}

function cliError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.safeToDisplay = true;
  return error;
}

function validationError(code) {
  const error = new Error("Qwen validation precondition failed");
  error.code = code;
  return error;
}

async function loadValidationRuntime(options = {}) {
  const [
    { config },
    { pool, withTransaction },
    { reserveAiBudget, settleAiBudget, releaseAiBudget },
    { buildQwenCaseMessages, hashCaseEvidence },
    { QwenCaseProvider },
    { validateQwenCaseResult }
  ] = await Promise.all([
    import("../src/config.js"),
    import("../src/db.js"),
    import("../src/safety/budgetService.js"),
    import("../src/safety/promptBuilder.js"),
    import("../src/safety/providers/qwenCaseProvider.js"),
    import("../src/safety/schemas/qwenCaseResult.js")
  ]);
  const diagnosticAttempt = options.diagnosticAttempt === true;
  const hardCapCny = diagnosticAttempt
    ? normalizeDiagnosticTotalBudget(options.hardCapCny)
    : null;

  return {
    validateOnce: () => validateQwenOnce({
      mode: config.safety.aiMode,
      autoActionsEnabled: config.safety.autoActionsEnabled,
      diagnosticAttempt,
      ...(hardCapCny == null ? {} : { totalBudgetCny: hardCapCny }),
      aiConfig: {
        ...config.safetyAi,
        ...(hardCapCny == null ? {} : { monthlyBudgetCny: hardCapCny }),
        maxCompletionTokens: MAX_COMPLETION_TOKENS
      },
      withTransaction,
      reserveBudget: reserveAiBudget,
      settleBudget: settleAiBudget,
      releaseBudget: releaseAiBudget,
      buildMessages: buildQwenCaseMessages,
      hashEvidence: hashCaseEvidence,
      validateResult: validateQwenCaseResult,
      providerFactory: ({ aiConfig }) => new QwenCaseProvider({
        baseUrl: aiConfig.baseUrl,
        apiKey: aiConfig.apiKey,
        timeoutMs: aiConfig.timeoutMs
      })
    }),
    close: () => pool.end()
  };
}

async function main() {
  try {
    const summary = await runValidateQwen();
    if (!summary.pass) process.exitCode = 1;
  } catch (error) {
    const message = error?.safeToDisplay ? error.message : "Qwen 验证失败";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

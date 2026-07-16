import assert from "node:assert/strict";
import test from "node:test";
import { runValidateQwen, validateQwenOnce } from "../../scripts/validate-qwen.js";

test("refuses to load the validation runtime without explicit spend confirmation", async () => {
  let runtimeLoads = 0;
  const stdout = outputBuffer();

  await assert.rejects(
    runValidateQwen({
      argv: [],
      stdout,
      loadRuntime: async () => {
        runtimeLoads += 1;
        return { validateOnce: async () => assert.fail("validation must not run") };
      }
    }),
    (error) => error?.code === "spend_confirmation_required" && error.safeToDisplay === true
  );

  assert.equal(runtimeLoads, 0);
  assert.equal(stdout.text(), "");
});

test("rejects unknown arguments before loading provider or configuration", async () => {
  let runtimeLoads = 0;

  await assert.rejects(
    runValidateQwen({
      argv: ["--confirm-spend", "--verbose"],
      stdout: outputBuffer(),
      loadRuntime: async () => {
        runtimeLoads += 1;
        return { validateOnce: async () => assert.fail("validation must not run") };
      }
    }),
    (error) => error?.code === "invalid_validation_arguments" && error.safeToDisplay === true
  );

  assert.equal(runtimeLoads, 0);
});

test("passes an explicit diagnostic attempt and one-yuan hard cap into the runtime", async () => {
  const stdout = outputBuffer();
  let runtimeOptions;

  await runValidateQwen({
    argv: ["--confirm-spend", "--diagnostic-attempt", "--hard-cap-cny=1"],
    stdout,
    loadRuntime: async (options) => {
      runtimeOptions = options;
      return {
        validateOnce: async () => ({
          model: "qwen3.7-plus-2026-05-26",
          requestId: "",
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostCny: 0,
          pass: false
        })
      };
    }
  });

  assert.deepEqual(runtimeOptions, {
    confirmSpend: true,
    diagnosticAttempt: true,
    hardCapCny: 1
  });
  assert.equal(Object.isFrozen(runtimeOptions), true);
});

test("rejects a diagnostic cap above one yuan before loading the runtime", async () => {
  let runtimeLoads = 0;

  await assert.rejects(
    runValidateQwen({
      argv: ["--confirm-spend", "--diagnostic-attempt", "--hard-cap-cny=1.000001"],
      stdout: outputBuffer(),
      loadRuntime: async () => {
        runtimeLoads += 1;
        return { validateOnce: async () => assert.fail("validation must not run") };
      }
    }),
    (error) => error?.code === "invalid_validation_arguments" && error.safeToDisplay === true
  );

  assert.equal(runtimeLoads, 0);
});

test("prints only the allowlisted validation summary and closes the runtime", async () => {
  const stdout = outputBuffer();
  let closes = 0;
  const expected = {
    model: "qwen3.7-plus-2026-05-26",
    requestId: "request-safe-1",
    inputTokens: 123,
    outputTokens: 45,
    estimatedCostCny: 0.000516,
    pass: true
  };

  const result = await runValidateQwen({
    argv: ["--confirm-spend"],
    stdout,
    loadRuntime: async () => ({
      validateOnce: async () => ({
        ...expected,
        apiKey: "must-not-print",
        prompt: "must-not-print",
        rawResponse: "must-not-print"
      }),
      close: async () => { closes += 1; }
    })
  });

  assert.deepEqual(result, expected);
  assert.equal(stdout.text(), `${JSON.stringify(expected)}\n`);
  assert.equal(stdout.text().includes("must-not-print"), false);
  assert.equal(closes, 1);
});

test("prints only allowlisted schema locations in diagnostic mode", async () => {
  const stdout = outputBuffer();
  const expected = {
    model: "qwen3.7-plus-2026-05-26",
    requestId: "diagnostic-request-1",
    inputTokens: 288,
    outputTokens: 188,
    estimatedCostCny: 0.00208,
    pass: false,
    validationIssues: [{
      instancePath: "/confidence",
      keyword: "type",
      schemaPath: "#/properties/confidence/type"
    }]
  };

  const result = await runValidateQwen({
    argv: ["--confirm-spend", "--diagnostic-attempt", "--hard-cap-cny=1"],
    stdout,
    loadRuntime: async () => ({
      validateOnce: async () => ({
        ...expected,
        validationIssues: [{
          ...expected.validationIssues[0],
          message: "private provider value",
          value: "private provider value"
        }],
        rawResponse: "private provider response"
      })
    })
  });

  assert.deepEqual(result, expected);
  assert.equal(stdout.text(), `${JSON.stringify(expected)}\n`);
  assert.equal(stdout.text().includes("private provider"), false);
});

test("drops diagnostic locations that are not part of the fixed schema", async () => {
  const stdout = outputBuffer();

  const result = await runValidateQwen({
    argv: ["--confirm-spend", "--diagnostic-attempt", "--hard-cap-cny=1"],
    stdout,
    loadRuntime: async () => ({
      validateOnce: async () => ({
        model: "qwen3.7-plus-2026-05-26",
        requestId: "diagnostic-request-unsafe",
        inputTokens: 1,
        outputTokens: 1,
        estimatedCostCny: 0.00001,
        pass: false,
        validationIssues: [{
          instancePath: "/private-provider-value",
          keyword: "private-provider-value",
          schemaPath: "#/private-provider-value"
        }]
      })
    })
  });

  assert.deepEqual(result.validationIssues, []);
  assert.equal(stdout.text().includes("private-provider-value"), false);
});

test("closes the runtime when validation fails before producing a summary", async () => {
  let closes = 0;
  const stdout = outputBuffer();

  await assert.rejects(
    runValidateQwen({
      argv: ["--confirm-spend"],
      stdout,
      loadRuntime: async () => ({
        validateOnce: async () => { throw new Error("private provider detail"); },
        close: async () => { closes += 1; }
      })
    }),
    /private provider detail/u
  );

  assert.equal(stdout.text(), "");
  assert.equal(closes, 1);
});

test("reserves before one provider call and returns only settled synthetic metrics", async () => {
  const queries = [];
  let reserveCalls = 0;
  let providerFactoryCalls = 0;
  let providerCalls = 0;
  const ids = [
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
    "00000000-0000-4000-8000-000000000003"
  ];
  const summary = await validateQwenOnce({
    mode: "shadow",
    autoActionsEnabled: false,
    aiConfig: aiConfig(),
    now: new Date("2026-07-15T02:00:00.000Z"),
    randomUUIDImpl: () => ids.shift(),
    withTransaction: fakeTransaction(queries),
    reserveBudget: async (_client, input) => {
      reserveCalls += 1;
      assert.equal(input.maxCompletionTokens, 900);
      return { ok: true, reservedCny: 0.01 };
    },
    settleBudget: async (_client, input) => ({
      ok: true,
      actualCny: (input.inputTokens * 2 + input.outputTokens * 6) / 1_000_000
    }),
    releaseBudget: async () => assert.fail("successful validation must settle"),
    buildMessages: () => [{ role: "user", content: "synthetic bounded evidence" }],
    hashEvidence: () => "synthetic-evidence-hash",
    validateResult: (value) => value,
    providerFactory: () => {
      providerFactoryCalls += 1;
      return {
        async analyze() {
          providerCalls += 1;
          return {
            result: validInvalidContactResult(),
            usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
            requestId: "request-unit-1",
            rawContent: "must not be returned"
          };
        }
      };
    }
  });

  assert.deepEqual(summary, {
    model: "qwen3.7-plus-2026-05-26",
    requestId: "request-unit-1",
    inputTokens: 100,
    outputTokens: 50,
    estimatedCostCny: 0.0005,
    pass: true
  });
  assert.equal(reserveCalls, 1);
  assert.equal(providerFactoryCalls, 1);
  assert.equal(providerCalls, 1);
  assert.equal(JSON.stringify(summary).includes("must not be returned"), false);
  assert.equal(queries.some(({ text }) => text.includes("is_synthetic")), true);
  assert.equal(queries.some(({ text }) => text.includes("raw_response = ''")), true);
});

test("a blocked reservation never constructs the provider", async () => {
  let providerFactoryCalls = 0;
  const ids = [
    "00000000-0000-4000-8000-000000000011",
    "00000000-0000-4000-8000-000000000012",
    "00000000-0000-4000-8000-000000000013"
  ];

  const summary = await validateQwenOnce({
    mode: "shadow",
    autoActionsEnabled: false,
    aiConfig: { ...aiConfig(), monthlyBudgetCny: 0 },
    randomUUIDImpl: () => ids.shift(),
    withTransaction: fakeTransaction([]),
    reserveBudget: async () => ({ ok: false, reason: "budget_disabled" }),
    settleBudget: async () => assert.fail("blocked validation must not settle"),
    releaseBudget: async () => assert.fail("blocked validation has no reservation"),
    buildMessages: () => [{ role: "user", content: "synthetic bounded evidence" }],
    hashEvidence: () => "synthetic-evidence-hash",
    validateResult: (value) => value,
    providerFactory: () => {
      providerFactoryCalls += 1;
      return { analyze: async () => assert.fail("provider must not run") };
    }
  });

  assert.deepEqual(summary, {
    model: "qwen3.7-plus-2026-05-26",
    requestId: "",
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostCny: 0,
    pass: false
  });
  assert.equal(providerFactoryCalls, 0);
});

test("nonzero spend fails closed before the database when key, rates, or endpoint are unsafe", async () => {
  for (const [field, value, code] of [
    ["apiKey", "", "validation_api_key_missing"],
    ["inputCnyPerMillion", 0, "validation_rates_missing"],
    ["outputCnyPerMillion", 0, "validation_rates_missing"],
    ["baseUrl", "http://dashscope.aliyuncs.com/compatible-mode/v1", "validation_base_url_invalid"],
    ["baseUrl", "https://provider.example.test/v1", "validation_base_url_invalid"]
  ]) {
    let providerFactoryCalls = 0;
    await assert.rejects(
      validateQwenOnce({
        mode: "shadow",
        autoActionsEnabled: false,
        aiConfig: { ...aiConfig(), [field]: value },
        withTransaction: async () => assert.fail("invalid spend config must not touch the database"),
        reserveBudget: async () => assert.fail("invalid spend config must not reserve"),
        settleBudget: async () => assert.fail("invalid spend config must not settle"),
        releaseBudget: async () => assert.fail("invalid spend config must not release"),
        buildMessages: () => assert.fail("invalid spend config must not build evidence"),
        hashEvidence: () => assert.fail("invalid spend config must not hash evidence"),
        validateResult: (candidate) => candidate,
        providerFactory: () => {
          providerFactoryCalls += 1;
          return { analyze: async () => assert.fail("provider must not run") };
        }
      }),
      (error) => error?.code === code
    );
    assert.equal(providerFactoryCalls, 0);
  }
});

test("an uncertain provider failure settles conservatively and returns no private detail", async () => {
  const queries = [];
  const ids = [
    "00000000-0000-4000-8000-000000000021",
    "00000000-0000-4000-8000-000000000022",
    "00000000-0000-4000-8000-000000000023"
  ];
  let uncertainSettles = 0;
  const summary = await validateQwenOnce({
    mode: "shadow",
    autoActionsEnabled: false,
    aiConfig: aiConfig(),
    randomUUIDImpl: () => ids.shift(),
    withTransaction: fakeTransaction(queries),
    reserveBudget: async () => ({ ok: true, reservedCny: 0.01 }),
    settleBudget: async (_client, input) => {
      assert.equal(input.uncertain, true);
      uncertainSettles += 1;
      return { ok: true, actualCny: 0.01 };
    },
    releaseBudget: async () => assert.fail("uncertain billing must keep the reservation"),
    buildMessages: () => [{ role: "user", content: "synthetic bounded evidence" }],
    hashEvidence: () => "synthetic-evidence-hash",
    validateResult: (value) => value,
    providerFactory: () => ({
      async analyze() {
        const error = new Error("private network failure detail");
        error.code = "qwen_timeout";
        error.billingUncertain = true;
        error.requestId = "request-timeout-1";
        throw error;
      }
    })
  });

  assert.deepEqual(summary, {
    model: "qwen3.7-plus-2026-05-26",
    requestId: "request-timeout-1",
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostCny: 0.01,
    pass: false
  });
  assert.equal(uncertainSettles, 1);
  assert.equal(JSON.stringify(summary).includes("private network failure detail"), false);
  assert.equal(queries.some(({ params }) => params.includes("qwen_timeout")), true);
});

test("a diagnostic schema failure settles usage and returns only safe locations", async () => {
  const queries = [];
  const ids = [
    "00000000-0000-4000-8000-000000000031",
    "00000000-0000-4000-8000-000000000032",
    "00000000-0000-4000-8000-000000000033"
  ];
  const summary = await validateQwenOnce({
    mode: "shadow",
    autoActionsEnabled: false,
    diagnosticAttempt: true,
    totalBudgetCny: 1,
    aiConfig: aiConfig(),
    randomUUIDImpl: () => ids.shift(),
    withTransaction: fakeTransaction(queries),
    reserveBudget: async () => ({ ok: true, reservedCny: 0.01 }),
    settleBudget: async () => ({ ok: true, actualCny: 0.00208 }),
    releaseBudget: async () => assert.fail("billed schema failure must settle"),
    buildMessages: () => [{ role: "user", content: "synthetic bounded evidence" }],
    hashEvidence: () => "synthetic-evidence-hash",
    validateResult: () => {
      const error = new Error("private validation detail");
      error.code = "invalid_ai_result";
      error.validationIssues = [{
        instancePath: "/confidence",
        keyword: "type",
        schemaPath: "#/properties/confidence/type",
        message: "private provider value"
      }];
      throw error;
    },
    providerFactory: () => ({
      async analyze() {
        return {
          result: { confidence: "private provider value" },
          usage: { inputTokens: 288, outputTokens: 188, totalTokens: 476 },
          requestId: "diagnostic-request-2",
          rawContent: "private raw response"
        };
      }
    })
  });

  assert.deepEqual(summary, {
    model: "qwen3.7-plus-2026-05-26",
    requestId: "diagnostic-request-2",
    inputTokens: 288,
    outputTokens: 188,
    estimatedCostCny: 0.00208,
    pass: false,
    validationIssues: [{
      instancePath: "/confidence",
      keyword: "type",
      schemaPath: "#/properties/confidence/type"
    }]
  });
  assert.equal(JSON.stringify(summary).includes("private"), false);
  assert.equal(queries.some(({ text }) => text.includes("raw_response = ''")), true);
});

test("a prior synthetic provider attempt blocks a second construction", async () => {
  let providerFactoryCalls = 0;

  await assert.rejects(
    validateQwenOnce({
      mode: "shadow",
      autoActionsEnabled: false,
      aiConfig: aiConfig(),
      withTransaction: fakeTransaction([], { previousAttempt: true }),
      reserveBudget: async () => assert.fail("duplicate attempt must not reserve"),
      settleBudget: async () => assert.fail("duplicate attempt must not settle"),
      releaseBudget: async () => assert.fail("duplicate attempt must not release"),
      buildMessages: () => [{ role: "user", content: "synthetic bounded evidence" }],
      hashEvidence: () => "synthetic-evidence-hash",
      validateResult: (value) => value,
      providerFactory: () => {
        providerFactoryCalls += 1;
        return { analyze: async () => assert.fail("provider must not run") };
      }
    }),
    (error) => error?.code === "validation_already_attempted"
  );

  assert.equal(providerFactoryCalls, 0);
});

test("diagnostic mode allows a new attempt after a prior invalid run", async () => {
  let providerFactoryCalls = 0;
  let providerCalls = 0;
  const ids = [
    "00000000-0000-4000-8000-000000000041",
    "00000000-0000-4000-8000-000000000042",
    "00000000-0000-4000-8000-000000000043"
  ];

  const summary = await validateQwenOnce({
    mode: "shadow",
    autoActionsEnabled: false,
    diagnosticAttempt: true,
    totalBudgetCny: 1,
    aiConfig: aiConfig(),
    randomUUIDImpl: () => ids.shift(),
    withTransaction: fakeTransaction([], { previousStatus: "invalid" }),
    reserveBudget: async (_client, input) => {
      assert.equal(input.totalBudgetCny, 1);
      return { ok: true, reservedCny: 0.01 };
    },
    settleBudget: async () => ({ ok: true, actualCny: 0.0005 }),
    releaseBudget: async () => assert.fail("successful diagnostic must settle"),
    buildMessages: () => [{ role: "user", content: "synthetic bounded evidence" }],
    hashEvidence: () => "synthetic-evidence-hash",
    validateResult: (value) => value,
    providerFactory: () => {
      providerFactoryCalls += 1;
      return {
        async analyze() {
          providerCalls += 1;
          return {
            result: validInvalidContactResult(),
            usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
            requestId: "diagnostic-retry-1"
          };
        }
      };
    }
  });

  assert.equal(summary.pass, true);
  assert.deepEqual(summary.validationIssues, []);
  assert.equal(providerFactoryCalls, 1);
  assert.equal(providerCalls, 1);
});

test("diagnostic mode blocks while a prior attempt is still active", async () => {
  let providerFactoryCalls = 0;

  await assert.rejects(
    validateQwenOnce({
      mode: "shadow",
      autoActionsEnabled: false,
      diagnosticAttempt: true,
      totalBudgetCny: 1,
      aiConfig: aiConfig(),
      withTransaction: fakeTransaction([], { previousStatus: "running" }),
      reserveBudget: async () => assert.fail("active attempt must not reserve"),
      settleBudget: async () => assert.fail("active attempt must not settle"),
      releaseBudget: async () => assert.fail("active attempt must not release"),
      buildMessages: () => [{ role: "user", content: "synthetic bounded evidence" }],
      hashEvidence: () => "synthetic-evidence-hash",
      validateResult: (value) => value,
      providerFactory: () => {
        providerFactoryCalls += 1;
        return { analyze: async () => assert.fail("provider must not run") };
      }
    }),
    (error) => error?.code === "validation_already_attempted"
  );

  assert.equal(providerFactoryCalls, 0);
});

test("diagnostic mode blocks another paid attempt after a completed run", async () => {
  let providerFactoryCalls = 0;

  await assert.rejects(
    validateQwenOnce({
      mode: "shadow",
      autoActionsEnabled: false,
      diagnosticAttempt: true,
      totalBudgetCny: 1,
      aiConfig: aiConfig(),
      withTransaction: fakeTransaction([], { previousStatus: "completed" }),
      reserveBudget: async () => assert.fail("completed attempt must not reserve"),
      settleBudget: async () => assert.fail("completed attempt must not settle"),
      releaseBudget: async () => assert.fail("completed attempt must not release"),
      buildMessages: () => [{ role: "user", content: "synthetic bounded evidence" }],
      hashEvidence: () => "synthetic-evidence-hash",
      validateResult: (value) => value,
      providerFactory: () => {
        providerFactoryCalls += 1;
        return { analyze: async () => assert.fail("provider must not run") };
      }
    }),
    (error) => error?.code === "validation_already_attempted"
  );

  assert.equal(providerFactoryCalls, 0);
});

test("diagnostic mode rejects a missing or above-one-yuan total cap before database work", async () => {
  for (const totalBudgetCny of [undefined, 1.000001]) {
    await assert.rejects(
      validateQwenOnce({
        mode: "shadow",
        autoActionsEnabled: false,
        diagnosticAttempt: true,
        totalBudgetCny,
        aiConfig: aiConfig(),
        withTransaction: async () => assert.fail("invalid total cap must not touch the database"),
        reserveBudget: async () => assert.fail("invalid total cap must not reserve"),
        settleBudget: async () => assert.fail("invalid total cap must not settle"),
        releaseBudget: async () => assert.fail("invalid total cap must not release"),
        buildMessages: () => assert.fail("invalid total cap must not build evidence"),
        hashEvidence: () => assert.fail("invalid total cap must not hash evidence"),
        validateResult: (value) => value,
        providerFactory: () => assert.fail("invalid total cap must not construct provider")
      }),
      (error) => error?.code === "validation_total_budget_invalid"
    );
  }
});

function outputBuffer() {
  const chunks = [];
  return {
    write(chunk) {
      chunks.push(String(chunk));
      return true;
    },
    text() {
      return chunks.join("");
    }
  };
}

function fakeTransaction(queries, { previousAttempt = false, previousStatus } = {}) {
  const status = previousStatus || (previousAttempt ? "invalid" : null);
  const client = {
    release() {},
    async query(text, params = []) {
      queries.push({ text, params });
      if (text.includes("FROM safety_ai_runs") && text.includes("is_synthetic = true")) {
        return { rows: status && params[3].includes(status) ? [{ id: "prior-run" }] : [] };
      }
      return { rows: [] };
    }
  };
  return (callback) => callback(client);
}

function aiConfig() {
  return {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "unit-test-key-never-print",
    model: "qwen3.7-plus-2026-05-26",
    promptVersion: "safety-case-prompt-v1",
    policyVersion: "safety-policy-v1",
    monthlyBudgetCny: 1,
    inputCnyPerMillion: 2,
    outputCnyPerMillion: 6,
    maxCompletionTokens: 900
  };
}

function validInvalidContactResult() {
  return {
    category: "invalid_contact",
    subjectType: "collection",
    impactScope: "collection",
    riskLevel: "medium",
    confidence: 0.95,
    evidence: [{ source: "source_snapshot", fact: "Synthetic contact is unavailable." }],
    recommendedAction: "request_correction",
    requiresHuman: true,
    summary: "Synthetic contact requires correction."
  };
}

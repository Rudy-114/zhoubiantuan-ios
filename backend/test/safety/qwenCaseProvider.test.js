import assert from "node:assert/strict";
import test from "node:test";
import { MockQwenCaseProvider } from "../../src/safety/providers/mockQwenCaseProvider.js";
import { QwenCaseProvider } from "../../src/safety/providers/qwenCaseProvider.js";

const messages = [
  { role: "system", content: "Return JSON matching qwen-case-result-v1." },
  { role: "user", content: "UNTRUSTED_CASE_DATA_START\n{}\nUNTRUSTED_CASE_DATA_END\nReturn JSON only." }
];

test("sends the exact fixed non-thinking JSON Mode request and validates the response", async () => {
  const requests = [];
  const provider = new QwenCaseProvider({
    baseUrl: "https://dashscope.example.test/compatible-mode/v1/",
    apiKey: "test-api-key-never-log",
    timeoutMs: 500,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return response({
        id: "chatcmpl-test",
        request_id: "body-request-id",
        choices: [{ message: { content: JSON.stringify(validResult()) } }],
        usage: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 }
      }, { headers: { "x-request-id": "header-request-id" } });
    }
  });

  const output = await provider.analyze({ messages });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://dashscope.example.test/compatible-mode/v1/chat/completions");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.headers["Content-Type"], "application/json");
  assert.equal(requests[0].options.headers.Authorization.startsWith("Bearer "), true);
  assert.ok(requests[0].options.signal instanceof AbortSignal);

  const body = JSON.parse(requests[0].options.body);
  assert.deepEqual(body, {
    model: "qwen3.7-plus-2026-05-26",
    messages,
    response_format: { type: "json_object" },
    enable_thinking: false,
    temperature: 0.1,
    max_completion_tokens: 900,
    stream: false
  });
  assert.equal(Object.hasOwn(body, "tools"), false);
  assert.deepEqual(output.result, validResult());
  assert.equal(Object.isFrozen(output.result), true);
  assert.deepEqual(output.usage, { inputTokens: 123, outputTokens: 45, totalTokens: 168 });
  assert.equal(output.requestId, "header-request-id");
  assert.equal(output.rawContent, JSON.stringify(validResult()));
});

test("times out through AbortController without leaking request evidence or credentials", async () => {
  const provider = new QwenCaseProvider({
    baseUrl: "https://dashscope.example.test/v1",
    apiKey: "timeout-secret-key",
    timeoutMs: 5,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("raw timeout detail", "AbortError")), { once: true });
    })
  });

  await assert.rejects(
    provider.analyze({ messages }),
    (error) => {
      assert.equal(error.code, "qwen_timeout");
      assert.equal(error.retryable, true);
      assert.equal(error.billingUncertain, true);
      assert.equal(JSON.stringify(error).includes("timeout-secret-key"), false);
      assert.equal(error.message.includes("UNTRUSTED_CASE_DATA"), false);
      assert.equal(error.message.includes("raw timeout detail"), false);
      return true;
    }
  );
});

test("classifies 429 and rejects malformed or schema-invalid provider responses", async () => {
  const cases = [
    {
      fetchImpl: async () => response({ error: { message: "secret provider payload" } }, { status: 429 }),
      code: "qwen_rate_limited",
      retryable: true
    },
    {
      fetchImpl: async () => new Response("not-json", { status: 200 }),
      code: "qwen_invalid_response",
      retryable: false
    },
    {
      fetchImpl: async () => response({ choices: [{ message: { content: "not JSON" } }], usage: usage() }),
      code: "qwen_invalid_response",
      retryable: false
    },
    {
      fetchImpl: async () => response({
        choices: [{ message: { content: JSON.stringify({ ...validResult(), recommendedAction: "restrict_user" }) } }],
        usage: usage()
      }),
      code: "invalid_ai_result",
      retryable: false,
      validationIssues: [{
        instancePath: "/recommendedAction",
        keyword: "enum",
        schemaPath: "#/properties/recommendedAction/enum"
      }]
    }
  ];

  for (const item of cases) {
    const provider = new QwenCaseProvider({
      baseUrl: "https://dashscope.example.test/v1",
      apiKey: "response-secret-key",
      fetchImpl: item.fetchImpl,
      timeoutMs: 100
    });
    await assert.rejects(
      provider.analyze({ messages }),
      (error) => {
        assert.equal(error.code, item.code);
        assert.equal(error.retryable, item.retryable);
        const serialized = `${error.message} ${JSON.stringify(error)}`;
        assert.equal(serialized.includes("secret provider payload"), false);
        assert.equal(serialized.includes("response-secret-key"), false);
        assert.equal(serialized.includes("restrict_user"), false);
        if (item.validationIssues) {
          assert.deepEqual(error.validationIssues, item.validationIssues);
          assert.equal(Object.isFrozen(error.validationIssues), true);
        }
        return true;
      }
    );
  }
});

test("provides deterministic valid, invalid, timeout, rate-limit, and provider-error fixtures", async () => {
  const provider = new MockQwenCaseProvider();
  const valid = await provider.analyze({ messages, fixtureId: "valid" });
  assert.deepEqual(valid.result, validResult());
  assert.deepEqual(valid.usage, { inputTokens: 100, outputTokens: 50, totalTokens: 150 });
  assert.equal(valid.requestId, "mock-valid");

  for (const [fixtureId, code] of [
    ["invalid", "invalid_ai_result"],
    ["timeout", "qwen_timeout"],
    ["rate_limit", "qwen_rate_limited"],
    ["provider_error", "qwen_provider_error"]
  ]) {
    await assert.rejects(
      provider.analyze({ messages, fixtureId }),
      (error) => error?.code === code
    );
  }

  const marker = await provider.analyze({
    messages: [{ role: "user", content: "fixture:valid" }]
  });
  assert.deepEqual(marker.result, validResult());
});

function validResult() {
  return {
    category: "other",
    subjectType: "post",
    impactScope: "post",
    riskLevel: "low",
    confidence: 0.6,
    evidence: [{ source: "source_snapshot", fact: "Fixture evidence remains bounded." }],
    recommendedAction: "manual_review",
    requiresHuman: true,
    summary: "Fixture result requires human review."
  };
}

function usage() {
  return { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 };
}

function response(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

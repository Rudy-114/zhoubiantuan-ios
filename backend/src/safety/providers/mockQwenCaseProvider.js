import { providerError } from "./qwenCaseProvider.js";
import { validateQwenCaseResult } from "../schemas/qwenCaseResult.js";

const DEFAULT_RESULT = Object.freeze({
  category: "other",
  subjectType: "post",
  impactScope: "post",
  riskLevel: "low",
  confidence: 0.6,
  evidence: [{ source: "source_snapshot", fact: "Fixture evidence remains bounded." }],
  recommendedAction: "manual_review",
  requiresHuman: true,
  summary: "Fixture result requires human review."
});

export class MockQwenCaseProvider {
  constructor({ fixtures = {} } = {}) {
    this.fixtures = { ...fixtures };
  }

  async analyze({ messages = [], fixtureId } = {}) {
    const selectedId = fixtureId || fixtureMarker(messages) || "valid";
    if (Object.hasOwn(this.fixtures, selectedId)) {
      return customFixture(this.fixtures[selectedId], { messages, fixtureId: selectedId });
    }

    switch (selectedId) {
      case "valid":
        return validFixture();
      case "invalid": {
        const error = providerError("invalid_ai_result", { retryable: false, billingUncertain: false });
        throw error;
      }
      case "timeout":
        throw providerError("qwen_timeout", { retryable: true, billingUncertain: true });
      case "rate_limit":
        throw providerError("qwen_rate_limited", { retryable: true, billingUncertain: false, status: 429 });
      case "provider_error":
        throw providerError("qwen_provider_error", { retryable: true, billingUncertain: false, status: 503 });
      default:
        throw providerError("qwen_fixture_not_found", { retryable: false, billingUncertain: false });
    }
  }
}

function validFixture() {
  const result = validateQwenCaseResult(clone(DEFAULT_RESULT));
  return {
    result,
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    requestId: "mock-valid",
    rawContent: JSON.stringify(result)
  };
}

async function customFixture(fixture, context) {
  const value = typeof fixture === "function" ? await fixture(context) : clone(fixture);
  if (!value || typeof value !== "object" || !value.result) {
    throw providerError("qwen_fixture_invalid", { retryable: false, billingUncertain: false });
  }
  const result = validateQwenCaseResult(value.result);
  return {
    result,
    usage: value.usage || { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    requestId: value.requestId || `mock-${context.fixtureId}`,
    rawContent: value.rawContent || JSON.stringify(result)
  };
}

function fixtureMarker(messages) {
  const content = Array.isArray(messages)
    ? messages.map((message) => typeof message?.content === "string" ? message.content : "").join("\n")
    : "";
  return content.match(/\bfixture:(valid|invalid|timeout|rate_limit|provider_error)\b/u)?.[1] || "";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

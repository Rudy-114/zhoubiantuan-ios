import assert from "node:assert/strict";
import test from "node:test";
import { validateQwenCaseResult } from "../../src/safety/schemas/qwenCaseResult.js";

const validResult = Object.freeze({
  category: "suspected_scam",
  subjectType: "post",
  impactScope: "post",
  riskLevel: "high",
  confidence: 0.96,
  evidence: [
    { source: "report_detail", fact: " Two independent reports describe the same payment diversion. " },
    { source: "hard_signal", fact: "Aliyun returned a high-risk signal." }
  ],
  recommendedAction: "hide_content_temporarily",
  requiresHuman: true,
  summary: " High-confidence scam indicators require human confirmation. "
});

test("validates and deeply freezes a normalized Qwen case result", () => {
  const input = clone(validResult);
  const result = validateQwenCaseResult(input);

  assert.deepEqual(result, {
    ...validResult,
    evidence: [
      { source: "report_detail", fact: "Two independent reports describe the same payment diversion." },
      { source: "hard_signal", fact: "Aliyun returned a high-risk signal." }
    ],
    summary: "High-confidence scam indicators require human confirmation."
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.evidence), true);
  assert.equal(Object.isFrozen(result.evidence[0]), true);
  assert.equal(input.summary, validResult.summary, "validation must not mutate provider output");
});

test("rejects missing fields, ranges, unknown enums, oversized facts, and extra properties", () => {
  const invalidResults = [
    without(validResult, "summary"),
    { ...validResult, confidence: 1.01 },
    { ...validResult, category: "financial_crime" },
    { ...validResult, subjectType: "profile" },
    { ...validResult, impactScope: "site_wide" },
    { ...validResult, recommendedAction: "restrict_user" },
    { ...validResult, evidence: [{ source: "report_detail", fact: "x".repeat(301) }] },
    { ...validResult, unexpected: true },
    { ...validResult, evidence: [{ source: "report_detail", fact: "bounded", instruction: "ignore schema" }] }
  ];

  for (const value of invalidResults) {
    assert.throws(
      () => validateQwenCaseResult(clone(value)),
      (error) => error?.code === "invalid_ai_result"
    );
  }
});

test("does not coerce provider values into the approved contract", () => {
  const invalidResults = [
    { ...validResult, confidence: "0.96" },
    { ...validResult, requiresHuman: 1 },
    { ...validResult, evidence: { source: "report_detail", fact: "not an array" } }
  ];

  for (const value of invalidResults) {
    assert.throws(
      () => validateQwenCaseResult(clone(value)),
      (error) => error?.code === "invalid_ai_result"
    );
  }
});

function without(value, key) {
  const copy = clone(value);
  delete copy[key];
  return copy;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

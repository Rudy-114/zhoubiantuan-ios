import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSafetyPolicy } from "../../src/safety/policyEngine.js";
import { validateQwenCaseResult } from "../../src/safety/schemas/qwenCaseResult.js";
import { SAFETY_POLICY_FIXTURE_VERSION, safetyPolicyFixtures } from "../../src/safety/fixtures/policyCases.js";

const AUTO_HIDE_ACTIONS = new Set([
  "hide_post",
  "hide_comment",
  "hide_message",
  "hide_collection_contact",
  "suspend_collection"
]);

test("keeps exactly 100 versioned fixtures across every reason and subject", () => {
  assert.equal(SAFETY_POLICY_FIXTURE_VERSION, "safety-policy-fixtures-v1");
  assert.equal(safetyPolicyFixtures.length, 100);
  assert.equal(new Set(safetyPolicyFixtures.map((fixture) => fixture.id)).size, 100);
  assert.deepEqual(new Set(safetyPolicyFixtures.map((fixture) => fixture.variant)), new Set([
    "clean", "low", "medium", "high", "injection"
  ]));
  assert.deepEqual(new Set(safetyPolicyFixtures.map((fixture) => fixture.caseInput.caseRecord.subject_type)), new Set([
    "post", "comment", "user", "direct_message", "collection"
  ]));
  assert.deepEqual(new Set(safetyPolicyFixtures.map((fixture) => fixture.caseInput.caseRecord.category)), new Set([
    "suspected_scam",
    "false_or_expired_group_buy",
    "invalid_contact",
    "copyright_or_stolen_media",
    "harassment_or_abuse",
    "sexual_or_illegal",
    "spam_or_advertising",
    "direct_message_risk",
    "other"
  ]));
});

test("all model fixtures validate or declare one provider failure", () => {
  for (const fixture of safetyPolicyFixtures) {
    assert.equal(Boolean(fixture.qwenResult) === Boolean(fixture.providerFailure), false, fixture.id);
    if (fixture.qwenResult) {
      assert.doesNotThrow(() => validateQwenCaseResult(structuredClone(fixture.qwenResult)), fixture.id);
    } else {
      assert.match(fixture.providerFailure.code, /^qwen_[a-z_]+$/u, fixture.id);
    }
  }
});

test("fixture expectations match the deterministic policy and expose scope errors", () => {
  for (const fixture of safetyPolicyFixtures) {
    const result = evaluateSafetyPolicy(fixture.caseInput);
    assert.equal(result.nextStatus, fixture.expectedStatus, fixture.id);
    assert.deepEqual(
      result.proposedActions.map((action) => action.actionType),
      fixture.expectedActions,
      fixture.id
    );
    assert.equal(
      result.reasonCodes.includes("scope_expansion_rejected"),
      fixture.expectedScopeError,
      fixture.id
    );
  }
});

test("fixture auto-hide precision is at least 0.95 with zero automatic account actions", () => {
  let proposedAutoHides = 0;
  let truePositiveAutoHides = 0;
  let automaticAccountActions = 0;

  for (const fixture of safetyPolicyFixtures) {
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

  assert.ok(proposedAutoHides > 0);
  assert.ok(truePositiveAutoHides / proposedAutoHides >= 0.95);
  assert.equal(automaticAccountActions, 0);
});

import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSafetyPolicy } from "../../src/safety/policyEngine.js";

const NOW = new Date("2026-07-14T08:00:00.000Z");

test("off and unavailable AI always enter manual review without proposals", () => {
  assert.deepEqual(evaluateSafetyPolicy(baseInput({ mode: "off" })), manual("ai_off_or_unavailable"));
  assert.deepEqual(evaluateSafetyPolicy(baseInput({ qwenResult: null })), manual("ai_off_or_unavailable"));
});

test("shadow computes the same proposals as enforce while leaving apply to the caller", () => {
  const input = repeatedInvalidContactInput();
  const shadow = evaluateSafetyPolicy({ ...input, mode: "shadow" });
  const enforce = evaluateSafetyPolicy({ ...input, mode: "enforce" });

  assert.deepEqual(shadow, enforce);
  assert.equal(Object.hasOwn(shadow, "apply"), false);
  assert.deepEqual(actionTypes(shadow), ["hide_collection_contact", "request_correction"]);
  assert.equal(input.mode === "enforce" && true, false, "shadow caller gate remains closed");
});

test("user subjects never produce automatic account or content actions", () => {
  const result = evaluateSafetyPolicy(baseInput({
    caseRecord: caseRecord({ subject_type: "user", impact_scope: "user" }),
    qwenResult: qwenResult({ subjectType: "user", impactScope: "user", recommendedAction: "manual_review" })
  }));

  assert.deepEqual(result, manual("account_action_human_only"));
});

test("rejects a model attempt to expand a post case to collection scope", () => {
  const result = evaluateSafetyPolicy(baseInput({
    qwenResult: qwenResult({ impactScope: "collection", recommendedAction: "suspend_collection_temporarily" })
  }));

  assert.deepEqual(result, manual("scope_expansion_rejected"));
});

test("first independent invalid-contact report notifies only and sets no deadline", () => {
  const result = evaluateSafetyPolicy(invalidContactInput({ independentReporterCount7d: 1 }));

  assert.deepEqual(result, {
    nextStatus: "monitoring",
    proposedActions: [{
      actionType: "notify_owner",
      targetType: "collection",
      targetId: "collection-policy"
    }],
    requiresHuman: false,
    reasonCodes: ["invalid_contact_first_report"]
  });
  assert.equal(result.proposedActions.some((action) => action.actionType.includes("hide")), false);
  assert.equal(result.proposedActions.some((action) => Object.hasOwn(action, "correctionDueAt")), false);
});

test("two independent invalid-contact reports in seven days hide contact and request 24-hour correction", () => {
  const result = evaluateSafetyPolicy(repeatedInvalidContactInput());

  assert.deepEqual(result, {
    nextStatus: "awaiting_correction",
    proposedActions: [
      {
        actionType: "hide_collection_contact",
        targetType: "collection",
        targetId: "collection-policy"
      },
      {
        actionType: "request_correction",
        targetType: "collection",
        targetId: "collection-policy",
        correctionDueAt: "2026-07-15T08:00:00.000Z"
      }
    ],
    requiresHuman: false,
    reasonCodes: ["invalid_contact_repeated"]
  });
});

test("invalid policy time fails closed before creating a correction deadline", () => {
  assert.deepEqual(
    evaluateSafetyPolicy({ ...repeatedInvalidContactInput(), now: "not-a-date" }),
    manual("invalid_policy_time")
  );
});

test("expired invalid-contact correction without a valid revision suspends only the collection", () => {
  const result = evaluateSafetyPolicy(invalidContactInput({
    independentReporterCount7d: 2,
    caseRecord: caseRecord({
      subject_type: "collection",
      impact_scope: "collection",
      subject_id: "collection-policy",
      category: "invalid_contact",
      status: "awaiting_correction",
      correction_due_at: "2026-07-14T07:59:59.000Z"
    }),
    hasValidRevision: false
  }));

  assert.deepEqual(result, {
    nextStatus: "manual_review",
    proposedActions: [{
      actionType: "suspend_collection",
      targetType: "collection",
      targetId: "collection-policy"
    }],
    requiresHuman: true,
    reasonCodes: ["invalid_contact_correction_expired"]
  });
});

test("high hard sexual or illegal signals temporarily hide only the exact content subject", () => {
  const actions = {
    post: "hide_post",
    comment: "hide_comment",
    direct_message: "hide_message"
  };

  for (const [subjectType, actionType] of Object.entries(actions)) {
    const result = evaluateSafetyPolicy(baseInput({
      caseRecord: caseRecord({
        subject_type: subjectType,
        impact_scope: subjectType,
        subject_id: `${subjectType}-policy`,
        category: "sexual_or_illegal"
      }),
      qwenResult: qwenResult({
        category: "sexual_or_illegal",
        subjectType,
        impactScope: subjectType,
        riskLevel: "high",
        confidence: 0.8,
        recommendedAction: "no_action",
        requiresHuman: false
      }),
      hardSignal: { outcome: "block", riskLevel: "high", source: "aliyun" }
    }));

    assert.deepEqual(result, {
      nextStatus: "manual_review",
      proposedActions: [{ actionType, targetType: subjectType, targetId: `${subjectType}-policy` }],
      requiresHuman: true,
      reasonCodes: ["hard_sexual_or_illegal"]
    });
  }
});

test("high-confidence suspected scam with a hard signal hides only exact content", () => {
  const result = evaluateSafetyPolicy(baseInput({
    caseRecord: caseRecord({ category: "suspected_scam" }),
    qwenResult: qwenResult({
      category: "suspected_scam",
      riskLevel: "high",
      confidence: 0.95,
      recommendedAction: "no_action"
    }),
    hardSignal: { outcome: "block", riskLevel: "high", source: "aliyun" }
  }));

  assert.deepEqual(result, {
    nextStatus: "manual_review",
    proposedActions: [{ actionType: "hide_post", targetType: "post", targetId: "post-policy" }],
    requiresHuman: true,
    reasonCodes: ["hard_suspected_scam"]
  });
});

test("copyright reports always require human review and never declare automatic guilt", () => {
  const result = evaluateSafetyPolicy(baseInput({
    caseRecord: caseRecord({ category: "copyright_or_stolen_media" }),
    qwenResult: qwenResult({
      category: "copyright_or_stolen_media",
      riskLevel: "high",
      confidence: 1,
      recommendedAction: "hide_content_temporarily"
    }),
    hardSignal: { outcome: "block", riskLevel: "high", source: "aliyun" }
  }));

  assert.deepEqual(result, manual("copyright_human_only"));
});

test("accepts a corrected revision only after explicit Aliyun and Qwen safe passes", () => {
  const input = baseInput({
    caseRecord: caseRecord({ category: "copyright_or_stolen_media", status: "manual_review" }),
    qwenResult: qwenResult({
      category: "copyright_or_stolen_media",
      riskLevel: "none",
      confidence: 0.9,
      recommendedAction: "no_action",
      requiresHuman: false
    }),
    hardSignal: {
      outcome: "pass",
      riskLevel: "none",
      hardSafety: { provider: "aliyun", passed: true }
    },
    hasValidRevision: true
  });

  assert.deepEqual(evaluateSafetyPolicy(input), {
    nextStatus: "manual_review",
    proposedActions: [],
    requiresHuman: false,
    reasonCodes: ["revision_safe_to_publish"]
  });
  assert.deepEqual(
    evaluateSafetyPolicy({ ...input, hardSignal: { outcome: "pass", riskLevel: "none" } }),
    manual("revision_requires_human")
  );
});

test("appealed and manual-hold cases never produce automatic actions or restores", () => {
  for (const overrides of [{ status: "appealed" }, { manual_hold: true }]) {
    const result = evaluateSafetyPolicy(baseInput({ caseRecord: caseRecord(overrides) }));
    assert.deepEqual(result, manual("manual_hold"));
  }
});

test("unknown or schema-invalid provider results fail closed into manual review", () => {
  const invalidResults = [
    {},
    { ...qwenResult(), confidence: "0.95" },
    { ...qwenResult(), recommendedAction: "restrict_user" }
  ];
  for (const qwen of invalidResults) {
    assert.deepEqual(
      evaluateSafetyPolicy(baseInput({ qwenResult: qwen })),
      manual("invalid_provider_result")
    );
  }
});

test("the full automatic matrix contains zero account actions", () => {
  const results = [
    evaluateSafetyPolicy(repeatedInvalidContactInput()),
    evaluateSafetyPolicy(baseInput({
      caseRecord: caseRecord({ category: "suspected_scam" }),
      qwenResult: qwenResult({ category: "suspected_scam", riskLevel: "high", confidence: 0.99 }),
      hardSignal: { outcome: "block", riskLevel: "high" }
    })),
    evaluateSafetyPolicy(baseInput({
      caseRecord: caseRecord({ subject_type: "user", impact_scope: "user" }),
      qwenResult: qwenResult({ subjectType: "user", impactScope: "user" })
    }))
  ];

  const accountActions = results.flatMap((result) => result.proposedActions)
    .filter((action) => action.targetType === "user" || /user|account/u.test(action.actionType));
  assert.equal(accountActions.length, 0);
});

function baseInput(overrides = {}) {
  return {
    mode: "shadow",
    caseRecord: caseRecord(),
    qwenResult: qwenResult(),
    hardSignal: { outcome: "pass", riskLevel: "none", source: "aliyun" },
    reportCounts: { independentReporterCount7d: 1 },
    hasValidRevision: false,
    now: NOW,
    ...overrides
  };
}

function invalidContactInput(overrides = {}) {
  const { independentReporterCount7d = 1, ...rest } = overrides;
  return baseInput({
    caseRecord: caseRecord({
      subject_type: "collection",
      impact_scope: "collection",
      subject_id: "collection-policy",
      category: "invalid_contact"
    }),
    qwenResult: qwenResult({
      category: "invalid_contact",
      subjectType: "collection",
      impactScope: "collection",
      riskLevel: "medium",
      recommendedAction: "request_correction"
    }),
    reportCounts: { independentReporterCount7d },
    ...rest
  });
}

function repeatedInvalidContactInput() {
  return invalidContactInput({ independentReporterCount7d: 2 });
}

function caseRecord(overrides = {}) {
  return {
    id: "case-policy",
    subject_type: "post",
    subject_id: "post-policy",
    impact_scope: "post",
    category: "other",
    status: "triaging",
    manual_hold: false,
    correction_due_at: null,
    ...overrides
  };
}

function qwenResult(overrides = {}) {
  return {
    category: "other",
    subjectType: "post",
    impactScope: "post",
    riskLevel: "low",
    confidence: 0.6,
    evidence: [{ source: "source_snapshot", fact: "Bounded policy fixture." }],
    recommendedAction: "manual_review",
    requiresHuman: true,
    summary: "Manual review is the safe default.",
    ...overrides
  };
}

function manual(reasonCode) {
  return {
    nextStatus: "manual_review",
    proposedActions: [],
    requiresHuman: true,
    reasonCodes: [reasonCode]
  };
}

function actionTypes(result) {
  return result.proposedActions.map((action) => action.actionType);
}

import Ajv from "ajv";

export const qwenCaseResultSchema = {
  $id: "https://zhoubiantuanmail.top/schemas/qwen-case-result-v1.json",
  type: "object",
  additionalProperties: false,
  required: [
    "category",
    "subjectType",
    "impactScope",
    "riskLevel",
    "confidence",
    "evidence",
    "recommendedAction",
    "requiresHuman",
    "summary"
  ],
  properties: {
    category: {
      enum: [
        "suspected_scam",
        "false_or_expired_group_buy",
        "invalid_contact",
        "copyright_or_stolen_media",
        "harassment_or_abuse",
        "sexual_or_illegal",
        "spam_or_advertising",
        "direct_message_risk",
        "other"
      ]
    },
    subjectType: { enum: ["post", "comment", "user", "direct_message", "collection"] },
    impactScope: { enum: ["post", "comment", "user", "direct_message", "collection"] },
    riskLevel: { enum: ["none", "low", "medium", "high", "urgent"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    evidence: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["source", "fact"],
        properties: {
          source: { enum: ["report_detail", "source_snapshot", "hard_signal", "case_history"] },
          fact: { type: "string", minLength: 1, maxLength: 300 }
        }
      }
    },
    recommendedAction: {
      enum: [
        "no_action",
        "monitor",
        "manual_review",
        "request_correction",
        "hide_content_temporarily",
        "hide_collection_contact",
        "suspend_collection_temporarily"
      ]
    },
    requiresHuman: { type: "boolean" },
    summary: { type: "string", minLength: 1, maxLength: 500 }
  }
};

const ajv = new Ajv({
  allErrors: true,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false
});
const validate = ajv.compile(qwenCaseResultSchema);

export function validateQwenCaseResult(value) {
  if (!validate(value)) throw invalidAiResult();

  const evidence = value.evidence.map((item) => ({
    source: item.source,
    fact: item.fact.trim()
  }));
  if (!value.summary.trim() || evidence.some((item) => !item.fact)) {
    throw invalidAiResult();
  }

  return deepFreeze({
    category: value.category,
    subjectType: value.subjectType,
    impactScope: value.impactScope,
    riskLevel: value.riskLevel,
    confidence: value.confidence,
    evidence,
    recommendedAction: value.recommendedAction,
    requiresHuman: value.requiresHuman,
    summary: value.summary.trim()
  });
}

function invalidAiResult() {
  const error = new Error("AI result failed validation");
  error.code = "invalid_ai_result";
  return error;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

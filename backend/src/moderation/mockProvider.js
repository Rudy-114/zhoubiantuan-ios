import { normalizeModerationResult } from "./result.js";

export class MockModerationProvider {
  async reviewText({ text }) {
    const value = String(text || "");
    if (value.includes("触发驳回测试") || value.includes("[block]")) {
      return normalizeModerationResult({
        outcome: "block",
        riskLevel: "high",
        source: "textKeyword",
        reason: "内容命中明确违规测试词"
      });
    }
    if (value.includes("触发人工审核") || value.includes("[review]")) {
      return normalizeModerationResult({
        outcome: "review",
        riskLevel: "medium",
        source: "textKeyword",
        reason: "内容命中人工审核测试词"
      });
    }
    return normalizeModerationResult({
      outcome: "pass",
      riskLevel: "none",
      source: "systemRule",
      reason: "模拟文本审核通过"
    });
  }

  async reviewImages({ imageObjectKeys }) {
    const keys = imageObjectKeys.map((key) => String(key));
    if (keys.some((key) => key.includes("block"))) {
      return normalizeModerationResult({
        outcome: "block",
        riskLevel: "high",
        source: "imageSignal",
        reason: "图片命中明确违规测试信号"
      });
    }
    if (keys.some((key) => key.includes("review"))) {
      return normalizeModerationResult({
        outcome: "review",
        riskLevel: "medium",
        source: "imageSignal",
        reason: "图片命中人工审核测试信号"
      });
    }
    return normalizeModerationResult({
      outcome: "pass",
      riskLevel: keys.length ? "low" : "none",
      source: keys.length ? "imageSignal" : "systemRule",
      reason: "模拟图片审核通过"
    });
  }
}

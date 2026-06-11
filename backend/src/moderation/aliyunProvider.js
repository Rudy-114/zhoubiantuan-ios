import RPCClient from "@alicloud/pop-core";
import { config } from "../config.js";
import { signedReadUrl } from "../oss.js";
import { normalizeModerationResult } from "./result.js";

export class AliyunModerationProvider {
  constructor() {
    this.client = new RPCClient({
      accessKeyId: config.oss.accessKeyId,
      accessKeySecret: config.oss.accessKeySecret,
      endpoint: config.moderation.endpoint,
      apiVersion: "2022-03-02"
    });
  }

  async reviewText({ text, ownerId, targetId }) {
    const content = String(text || "").slice(0, 2000);
    if (config.moderation.textAgentAppId) {
      const serviceParameters = {
        content,
        accountId: ownerId || ""
      };
      const dataId = moderationDataId(targetId);
      if (dataId) {
        serviceParameters.dataId = dataId;
      }
      const response = await this.request("MultiModalAgent", {
        AppID: config.moderation.textAgentAppId,
        ServiceParameters: JSON.stringify(serviceParameters)
      });
      return mapAliyunResponse(response, "textAgent", "文本审核智能体通过");
    }

    const response = await this.request("TextModeration", {
      Service: config.moderation.textService,
      ServiceParameters: JSON.stringify({
        content: String(text || "").slice(0, 600),
        accountId: ownerId || ""
      })
    });
    return mapAliyunResponse(response, "textKeyword", "文本审核通过");
  }

  async reviewImages({ imageObjectKeys, ownerId }) {
    const results = await Promise.all(
      imageObjectKeys.map(async (objectKey) => {
        const response = await this.request("ImageModeration", {
          Service: config.moderation.imageService,
          ServiceParameters: JSON.stringify({
            imageUrl: signedReadUrl(objectKey, 600),
            ossBucketName: config.oss.bucket,
            ossObjectName: objectKey,
            ossRegionId: config.oss.region,
            accountId: ownerId || ""
          })
        });
        return mapAliyunResponse(response, "imageSignal", "图片审核通过");
      })
    );
    const blocked = results.find((result) => result.outcome === "block");
    if (blocked) return blocked;
    const review = results.find((result) => result.outcome === "review");
    if (review) return review;
    return normalizeModerationResult({
      outcome: "pass",
      riskLevel: imageObjectKeys.length ? "low" : "none",
      source: imageObjectKeys.length ? "imageSignal" : "systemRule",
      reason: "图片审核通过",
      rawSummary: { count: imageObjectKeys.length }
    });
  }

  async request(action, params) {
    return this.client.request(action, params, {
      method: "POST",
      formatParams: false,
      timeout: 7000
    });
  }
}

function mapAliyunResponse(response, source, passReason) {
  const summary = summarizeAliyunResponse(response);
  if (summary.hasHighRisk || summary.hasBlock) {
    return normalizeModerationResult({
      outcome: "block",
      riskLevel: "high",
      source,
      reason: summary.reason || "内容未通过阿里云审核",
      rawSummary: summary
    });
  }
  if (summary.hasMediumRisk || summary.hasReview || summary.hasRiskLabel || summary.hasNon200Code) {
    return normalizeModerationResult({
      outcome: "review",
      riskLevel: summary.riskLevel || "medium",
      source,
      reason: summary.reason || "内容需人工复核",
      rawSummary: summary
    });
  }
  return normalizeModerationResult({
    outcome: "pass",
    riskLevel: summary.riskLevel || "none",
    source,
    reason: passReason,
    rawSummary: summary
  });
}

function summarizeAliyunResponse(response) {
  const data = response?.Data || response?.data || {};
  const reasonObject = parseMaybeJSON(data.reason || data.Reason || "");
  const resultRiskLevels = Array.isArray(data.Result)
    ? data.Result.map((item) => item?.RiskLevel || item?.riskLevel).filter(Boolean)
    : [];
  const explicitRiskLevel = normalizeRiskLevel(data.RiskLevel || data.riskLevel || reasonObject.riskLevel || highestRiskLevel(resultRiskLevels));
  const values = flattenResponse(response);
  const strings = values.map((value) => String(value).trim()).filter(Boolean);
  const lowered = strings.map((value) => value.toLowerCase());
  const riskWords = [
    reasonObject.riskTips,
    reasonObject.riskWords,
    data.descriptions,
    data.Description,
    data.Msg,
    data.Message
  ].filter(Boolean).map(String);
  const labels = collectLabels(data).filter((value) => !isSafeLabel(value));
  const high = explicitRiskLevel === "high" || lowered.includes("block") || lowered.includes("reject");
  const medium = explicitRiskLevel === "medium";
  const review = lowered.includes("review") || lowered.includes("manualreview") || lowered.includes("疑似");
  const code = response?.Code ?? response?.code ?? response?.StatusCode ?? response?.statusCode;
  return {
    requestId: response?.RequestId || response?.requestId || "",
    code,
    riskLevel: high ? "high" : medium ? "medium" : explicitRiskLevel || (lowered.includes("low") ? "low" : "none"),
    reason: riskWords.slice(0, 3).join("、"),
    labels: labels.slice(0, 8),
    hasHighRisk: high,
    hasMediumRisk: medium,
    hasReview: review,
    hasBlock: lowered.includes("block") || lowered.includes("reject"),
    hasRiskLabel: (explicitRiskLevel === "high" || explicitRiskLevel === "medium") || labels.length > 0,
    hasNon200Code: code != null && String(code) !== "200"
  };
}

function parseMaybeJSON(value) {
  if (!value || typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeRiskLevel(value) {
  const level = String(value || "").trim().toLowerCase();
  return ["high", "medium", "low", "none"].includes(level) ? level : "";
}

function highestRiskLevel(levels) {
  const normalized = levels.map(normalizeRiskLevel);
  if (normalized.includes("high")) return "high";
  if (normalized.includes("medium")) return "medium";
  if (normalized.includes("low")) return "low";
  if (normalized.includes("none")) return "none";
  return "";
}

function moderationDataId(value) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .slice(0, 128);
}

function collectLabels(data) {
  const rawLabels = [
    data.labels,
    data.Labels,
    data.Label,
    ...(Array.isArray(data.Result) ? data.Result.flatMap((item) => [item?.Label, item?.label]) : [])
  ].filter(Boolean);
  return rawLabels.flatMap((value) => String(value).split(",")).map((value) => value.trim()).filter(Boolean);
}

function isSafeLabel(value) {
  const label = String(value || "").trim().toLowerCase();
  const exactSafeLabels = ["200", "success", "pass", "normal", "none", "nonlabel", "low", "未检测出风险", "ok"];
  return exactSafeLabels.includes(label);
}

function flattenResponse(value, output = []) {
  if (value == null) return output;
  if (Array.isArray(value)) {
    for (const item of value) flattenResponse(item, output);
    return output;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) flattenResponse(item, output);
    return output;
  }
  output.push(value);
  return output;
}

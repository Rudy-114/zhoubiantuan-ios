import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { query } from "../db.js";
import { concurrencyGate } from "../concurrency.js";
import { arrayOfStrings } from "../validators.js";
import { AliyunModerationProvider } from "./aliyunProvider.js";
import { MockModerationProvider } from "./mockProvider.js";
import { combineModerationResults, moderationErrorResult, normalizeModerationResult } from "./result.js";

let provider;
const reviewGate = concurrencyGate(4);

export function moderationProvider() {
  if (!provider) {
    provider = config.moderation.provider === "aliyun" ? new AliyunModerationProvider() : new MockModerationProvider();
  }
  return provider;
}

export async function reviewSubmission({ targetType, targetId, ownerId, text = "", imageObjectKeys = [] }) {
  return reviewGate(() => reviewBoundedSubmission({ targetType, targetId, ownerId, text, imageObjectKeys }));
}

async function reviewBoundedSubmission({ targetType, targetId, ownerId, text, imageObjectKeys }) {
  const provider = moderationProvider();
  const checks = [];
  if (String(text || "").trim()) {
    checks.push(safeReview(() => provider.reviewText({ targetType, targetId, ownerId, text }), "textKeyword"));
  }
  const safeImageKeys = arrayOfStrings(imageObjectKeys);
  if (safeImageKeys.length) {
    checks.push(safeReview(() => provider.reviewImages({ targetType, targetId, ownerId, imageObjectKeys: safeImageKeys }), "imageSignal"));
  }
  if (!checks.length) {
    return normalizeModerationResult({ outcome: "pass", source: "systemRule", reason: "无待审核内容" });
  }
  return combineModerationResults(await Promise.all(checks));
}

export async function createModerationReview(client, input) {
  const id = input.id || `mr-${randomUUID()}`;
  const result = normalizeModerationResult(input.result);
  const executor = client || { query };
  const { rows } = await executor.query(
    `INSERT INTO moderation_reviews (
      id, target_type, target_id, owner_id, status, decision, source, risk_level, reason,
      text_snapshot, image_object_keys, snapshot, raw_summary
    ) VALUES (
      $1, $2, $3, NULLIF($4, ''), $5, $6, $7, $8, $9,
      $10, $11, $12::jsonb, $13::jsonb
    )
    RETURNING *`,
    [
      id,
      input.targetType,
      input.targetId,
      input.ownerId || "",
      input.status || result.status,
      result.outcome,
      result.source,
      result.riskLevel,
      input.reason || result.reason,
      input.textSnapshot || "",
      arrayOfStrings(input.imageObjectKeys),
      JSON.stringify(input.snapshot || {}),
      JSON.stringify(result.rawSummary || {})
    ]
  );
  return rows[0];
}

export function assertOwnedObjectKeys(userId, objectKeys, allowedKinds) {
  const keys = arrayOfStrings(objectKeys);
  const kinds = allowedKinds && allowedKinds.length ? allowedKinds : ["post", "avatar", "background"];
  for (const key of keys) {
    const ok = kinds.some((kind) => key.startsWith(`${kind}/${userId}/`) || key.startsWith(`guarded/${kind}/${userId}/`));
    if (!ok || key.includes("..")) {
      const error = new Error("图片上传归属无效，请重新上传");
      error.status = 400;
      throw error;
    }
  }
  return keys;
}

export function isModerationAdmin(user) {
  return Boolean(user?.email_verified && ["moderator", "admin"].includes(user?.moderation_role));
}

async function safeReview(callback, source) {
  try {
    return await callback();
  } catch (error) {
    if (config.moderation.failMode === "block") {
      return normalizeModerationResult({
        outcome: "block",
        riskLevel: "high",
        source,
        reason: "审核服务暂时不可用，内容未发布",
        rawSummary: { error: error?.message || String(error || "unknown") }
      });
    }
    // Default fail-closed behavior: failed provider checks enter manual review, never auto-publish.
    return moderationErrorResult(error, source);
  }
}

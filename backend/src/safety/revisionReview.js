import { config } from "../config.js";
import { reviewSubmission } from "../moderation/index.js";
import { publicContentModerationText } from "../moderation/text.js";
import { createSyncEventsForUsers } from "../sync.js";
import { badRequest } from "../validators.js";
import { lockSafetyTarget } from "./safetyTargetLock.js";

const REVIEW_TRANSACTION_PROBE_SAVEPOINT = "review_content_revision_probe";
const DURABLY_REVIEWED_STATUSES = new Set(["approved", "rejected", "reviewing", "published"]);
const RAW_STRING_FIELDS = new Map([
  ["requestId", 160], ["code", 80], ["riskLevel", 40], ["reason", 1000]
]);
const RAW_BOOLEAN_FIELDS = [
  "hasHighRisk", "hasMediumRisk", "hasReview", "hasBlock", "hasRiskLabel", "hasNon200Code"
];

export async function reviewContentRevision(client, input = {}) {
  assertTransactionScopedClient(client);
  await assertActiveTransaction(client);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw badRequest("整改审核参数不正确");
  if (typeof input.moderation !== "undefined" && typeof input.moderation !== "function") {
    throw new TypeError("reviewContentRevision moderation must be a function");
  }
  const usesDefaultModeration = typeof input.moderation === "undefined";
  const moderation = input.moderation || reviewSubmission;
  const revisionId = requiredBoundedText(input.revisionId, "整改版本 ID", 160);
  const metadata = await loadRevisionMetadata(client, revisionId);
  await lockSafetyTarget(client, metadata.target_type, metadata.target_id);
  const safetyCase = await lockSafetyCase(client, metadata.case_id);
  await lockAndValidateTarget(client, metadata, safetyCase);
  const revision = await lockAndRevalidateRevision(client, metadata);
  if (DURABLY_REVIEWED_STATUSES.has(revision.status)) return unchangedReviewResult(revision);
  if (revision.status !== "pending") throw conflict("整改版本当前不能审核", "revision_not_pending");

  await client.query(
    "UPDATE content_revisions SET status = 'reviewing', updated_at = now() WHERE id = $1",
    [revision.id]
  );
  let result;
  try {
    result = await moderation(moderationInputForRevision(revision));
  } catch {
    result = providerFailureResult();
  }

  const trustedProvider = usesDefaultModeration && config.moderation.provider === "aliyun"
    ? "aliyun"
    : null;
  const reviewSummary = safeReviewSummary(result, trustedProvider);
  const revisionStatus = reviewSummary.status === "active"
    ? "approved"
    : reviewSummary.status === "rejected" ? "rejected" : "reviewing";
  await client.query(
    `UPDATE content_revisions
     SET status = $2, review_summary = $3::jsonb, reviewed_at = now(), updated_at = now()
     WHERE id = $1`,
    [revision.id, revisionStatus, JSON.stringify(reviewSummary)]
  );
  await client.query(
    "UPDATE safety_cases SET status = 'manual_review', updated_at = now() WHERE id = $1",
    [revision.case_id]
  );
  if (revisionStatus === "approved") {
    await insertCaseEvent(client, revision);
  }
  const syncEvents = await createOwnerEntitySync(client, revision);
  if (revisionStatus === "approved") {
    return { published: false, awaiting: "human_or_qwen", result, syncEvents };
  }
  return { published: false, result, syncEvents };
}

function unchangedReviewResult(revision) {
  const result = {
    published: revision.status === "published",
    unchanged: true,
    result: revision.review_summary,
    syncEvents: []
  };
  if (revision.status === "approved") result.awaiting = "human_or_qwen";
  return result;
}

async function loadRevisionMetadata(client, revisionId) {
  const { rows } = await client.query(
    `SELECT id, case_id, target_type, target_id, owner_id
     FROM content_revisions WHERE id = $1`,
    [revisionId]
  );
  if (!rows[0]) throw httpError(404, "整改版本不存在", "content_revision_not_found");
  return rows[0];
}

async function lockSafetyCase(client, caseId) {
  const { rows } = await client.query("SELECT * FROM safety_cases WHERE id = $1 FOR UPDATE", [caseId]);
  if (!rows[0]) throw httpError(404, "安全案件不存在", "safety_case_not_found");
  return rows[0];
}

async function lockAndValidateTarget(client, metadata, safetyCase) {
  if (safetyCase.subject_type !== metadata.target_type || safetyCase.subject_id !== metadata.target_id) {
    throw conflict("整改版本与案件目标不一致", "revision_target_changed");
  }
  const source = metadata.target_type === "post"
    ? { table: "posts", owner: "author_id" }
    : metadata.target_type === "collection" ? { table: "group_collections", owner: "owner_id" } : null;
  if (!source) throw badRequest("该内容类型不支持整改审核");
  const { rows } = await client.query(
    `SELECT *, ${source.owner} AS revision_owner_id FROM ${source.table} WHERE id = $1 FOR UPDATE`,
    [metadata.target_id]
  );
  if (!rows[0]) throw httpError(404, "整改目标不存在", "revision_target_not_found");
  if (rows[0].revision_owner_id !== metadata.owner_id) {
    throw conflict("整改版本所有者已变化", "revision_target_changed");
  }
}

async function lockAndRevalidateRevision(client, metadata) {
  const { rows } = await client.query("SELECT * FROM content_revisions WHERE id = $1 FOR UPDATE", [metadata.id]);
  const revision = rows[0];
  if (!revision) throw httpError(404, "整改版本不存在", "content_revision_not_found");
  for (const key of ["case_id", "target_type", "target_id", "owner_id"]) {
    if (revision[key] !== metadata[key]) throw conflict("整改版本元数据已变化", "revision_target_changed");
  }
  return revision;
}

function moderationInputForRevision(revision) {
  const snapshotImageKeys = revision.target_type === "post"
    ? [...(revision.snapshot.imageObjectKeys || []), ...(revision.snapshot.previewImageObjectKeys || [])]
    : [];
  return {
    targetType: revision.target_type,
    targetId: revision.id,
    ownerId: revision.owner_id,
    text: publicContentModerationText(revision.snapshot),
    imageObjectKeys: [...new Set([...snapshotImageKeys, ...(revision.object_keys || [])])]
  };
}

function providerFailureResult() {
  return {
    outcome: "review",
    status: "review",
    riskLevel: "medium",
    source: "systemRule",
    reason: "审核服务暂时不可用，已转入人工审核",
    rawSummary: { errorCode: "MODERATION_PROVIDER_ERROR" }
  };
}

function safeReviewSummary(result, trustedProvider) {
  const candidate = isPlainObject(result) ? result : {};
  const status = candidate.status === "active" ? "active" : candidate.status === "rejected" ? "rejected" : "review";
  const outcome = ["pass", "review", "block"].includes(candidate.outcome)
    ? candidate.outcome
    : status === "active" ? "pass" : status === "rejected" ? "block" : "review";
  return {
    outcome,
    status,
    riskLevel: ["none", "low", "medium", "high", "urgent"].includes(candidate.riskLevel)
      ? candidate.riskLevel
      : status === "active" ? "none" : "medium",
    source: sanitizeText(candidate.source, "systemRule", 80),
    reason: sanitizeText(candidate.reason, status === "active" ? "审核通过" : "内容需人工复核", 1000),
    rawSummary: allowlistedRawSummary(candidate.rawSummary),
    hardSafety: { provider: trustedProvider === "aliyun" ? "aliyun" : "unknown", passed: status === "active" }
  };
}

function allowlistedRawSummary(value) {
  if (!isPlainObject(value)) return {};
  const summary = {};
  for (const [key, limit] of RAW_STRING_FIELDS) {
    const item = value[key];
    if (typeof item === "string" || typeof item === "number") {
      summary[key] = sanitizeText(String(item), "", limit);
    }
  }
  if (Array.isArray(value.labels)) {
    summary.labels = value.labels.slice(0, 20)
      .filter((item) => typeof item === "string")
      .map((item) => sanitizeText(item, "", 120));
  }
  for (const key of RAW_BOOLEAN_FIELDS) {
    if (typeof value[key] === "boolean") summary[key] = value[key];
  }
  if (Number.isSafeInteger(value.count) && value.count >= 0) summary.count = Math.min(value.count, 1_000_000);
  if (value.errorCode === "MODERATION_PROVIDER_ERROR") summary.errorCode = value.errorCode;
  return summary;
}

function sanitizeText(value, fallback, limit) {
  if (typeof value !== "string") return fallback;
  let text = value.trim();
  text = text.replace(/authorization\s*[:=]\s*bearer\s+[^\s,;]+/gi, "[redacted]");
  text = text.replace(/\bbearer\s+[^\s,;]+/gi, "[redacted]");
  text = text.replace(/https?:\/\/[^\s]+/gi, redactUrlQuery);
  text = text.replace(
    /\b(?:token|password|secret|signature|credential|access.?key(?:id|secret)?)\s*[:=]\s*[^&\s,;]+/gi,
    "[redacted]"
  );
  return Array.from(text).slice(0, limit).join("") || fallback;
}

function redactUrlQuery(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}${url.search || url.hash ? "?[redacted]" : ""}`;
  } catch {
    return "[redacted-url]";
  }
}

async function insertCaseEvent(client, revision) {
  await client.query(
    `INSERT INTO safety_case_events (case_id, actor_type, event_type, event_data)
     VALUES ($1, 'system', 'revision.hard_safety_approved', $2::jsonb)`,
    [revision.case_id, JSON.stringify({ revisionId: revision.id })]
  );
}

function createOwnerEntitySync(client, revision) {
  return createSyncEventsForUsers(client, {
    userIds: [revision.owner_id],
    eventType: `${revision.target_type}.updated`,
    entityType: revision.target_type,
    entityId: revision.target_id
  });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredBoundedText(value, label, limit) {
  if (typeof value !== "string" || !value.trim()) throw badRequest(`${label}不能为空`);
  const text = value.trim();
  if (Array.from(text).length > limit) throw badRequest(`${label}不能超过 ${limit} 个字符`);
  return text;
}

function assertTransactionScopedClient(client) {
  if (!client || typeof client.query !== "function" || typeof client.release !== "function") {
    throw new TypeError(
      "reviewContentRevision requires a transaction-scoped pg PoolClient; caller must BEGIN and own COMMIT/ROLLBACK"
    );
  }
}

async function assertActiveTransaction(client) {
  try {
    await client.query(`SAVEPOINT ${REVIEW_TRANSACTION_PROBE_SAVEPOINT}`);
    await client.query(`RELEASE SAVEPOINT ${REVIEW_TRANSACTION_PROBE_SAVEPOINT}`);
  } catch (error) {
    const developerError = new TypeError(
      "reviewContentRevision requires an active transaction; caller must BEGIN before invoking it"
    );
    developerError.cause = error;
    throw developerError;
  }
}

function conflict(message, apiCode) {
  return httpError(409, message, apiCode);
}

function httpError(status, message, apiCode) {
  const error = new Error(message);
  error.status = status;
  if (apiCode) error.apiCode = apiCode;
  return error;
}

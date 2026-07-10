import { badRequest } from "../validators.js";
import {
  ALLOWED_REASONS_BY_SOURCE,
  COLLECTION_SHARED_FIELDS,
  SAFETY_REASON_CODES,
  SAFETY_REPORTED_FIELDS,
  SAFETY_TARGET_TYPES
} from "./constants.js";

const CONTACT_FIELDS = new Set(["contact_wechat", "contact_qq", "contact_group_number"]);
const COLLECTION_FIELD_REASONS = new Set([
  "suspected_scam",
  "false_or_expired_group_buy",
  "invalid_contact",
  "copyright_or_stolen_media",
  "sexual_or_illegal",
  "spam_or_advertising",
  "other"
]);

export function normalizeReportInput(body = {}) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("请求体必须是对象");
  }

  const clientRequestId = readString(body, ["clientRequestID", "clientRequestId"], "请求 ID");
  const sourceType = readString(body, ["sourceType"], "举报对象");
  const sourceId = readString(body, ["sourceID", "sourceId"], "目标 ID");
  const reasonCode = readString(body, ["reasonCode"], "举报原因");
  const reportedField = readString(body, ["reportedField"], "举报字段");
  const detail = readString(body, ["detail"], "详细说明", { optional: true });

  assertRequiredBounded(clientRequestId, "请求 ID");
  assertRequiredBounded(sourceId, "目标 ID");
  if (!SAFETY_TARGET_TYPES.includes(sourceType)) throw badRequest("举报对象不支持");
  if (!SAFETY_REASON_CODES.includes(reasonCode)) throw badRequest("举报原因不支持");
  if (!SAFETY_REPORTED_FIELDS.includes(reportedField)) throw badRequest("举报字段不支持");
  if (!ALLOWED_REASONS_BY_SOURCE[sourceType].includes(reasonCode)) {
    throw badRequest("举报原因与举报对象不匹配");
  }
  if (countCodePoints(detail) > 1000) throw badRequest("详细说明不能超过 1000 个字符");

  const objectKeys = normalizeObjectKeys(body.objectKeys);

  if (COLLECTION_SHARED_FIELDS.has(reportedField) && !["post", "collection"].includes(sourceType)) {
    throw badRequest("举报字段与举报对象不匹配");
  }
  if (COLLECTION_SHARED_FIELDS.has(reportedField) && !COLLECTION_FIELD_REASONS.has(reasonCode)) {
    throw badRequest("举报字段与举报原因不匹配");
  }
  if (reasonCode === "other" && !detail) throw badRequest("选择其他原因时请填写详细说明");
  if (reasonCode === "invalid_contact") {
    if (!CONTACT_FIELDS.has(reportedField)) throw badRequest("请选择具体联系方式后再举报");
    if (!detail) throw badRequest("请填写具体说明");
  }

  return {
    clientRequestId,
    sourceType,
    sourceId,
    reasonCode,
    reportedField,
    detail,
    objectKeys
  };
}

function normalizeObjectKeys(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw badRequest("证据必须是数组");
  if (value.length > 6) throw badRequest("证据最多上传 6 项");

  const result = [];
  const seen = new Set();

  for (const item of value) {
    if (typeof item !== "string") throw badRequest("证据必须是字符串");
    const key = item.trim();
    if (!key) throw badRequest("证据不能为空");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }

  return result;
}

function assertRequiredBounded(value, label) {
  if (!value) throw badRequest(`${label}不能为空`);
  if (countCodePoints(value) > 128) throw badRequest(`${label}不能超过 128 个字符`);
}

function readString(body, keys, label, { optional = false } = {}) {
  let selected;

  for (const key of keys) {
    if (!Object.hasOwn(body, key)) continue;
    const value = body[key];
    if (typeof value !== "string") throw badRequest(`${label}必须是字符串`);
    if (selected === undefined) selected = value;
  }

  if (selected === undefined) return optional ? "" : "";
  return selected.trim();
}

function countCodePoints(value) {
  return Array.from(value).length;
}

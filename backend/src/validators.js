export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function assertEmail(email) {
  const normalized = normalizeEmail(email);
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw badRequest("请填写有效邮箱");
  }
  return normalized;
}

export function assertPassword(password) {
  const value = String(password || "");
  if (value.length < 8) {
    throw badRequest("密码至少 8 位");
  }
  if (Buffer.byteLength(value, "utf8") > 72) throw badRequest("密码不能超过 72 字节");
  return value;
}

export function assertEmailCode(code) {
  const value = String(code || "").trim();
  if (!/^\d{6}$/.test(value)) {
    throw badRequest("请填写 6 位验证码");
  }
  return value;
}

export function assertEmailCodePurpose(purpose) {
  const value = String(purpose || "").trim();
  if (!["register", "login", "reset", "delete"].includes(value)) {
    throw badRequest("验证码用途不正确");
  }
  return value;
}

export function trimmedString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

export function arrayOfStrings(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item != null).map((item) => String(item).trim()).filter(Boolean);
}

export function badRequest(message, apiCode) {
  const error = new Error(message);
  error.status = 400;
  if (apiCode) error.apiCode = apiCode;
  return error;
}

/**
 * Trimmed string with a character cap (user-perceived characters, via
 * Array.from, so emoji and CJK count as one). Empty input returns `fallback`;
 * the fallback itself is not checked, so legacy stored values stay editable.
 */
export function boundedString(value, { max, field, fallback = "" }) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  if (Array.from(text).length > max) throw badRequest(`${field}最多 ${max} 字`);
  return text;
}

/** Each tag ≤ maxLength characters, at most maxCount tags per category. */
export function boundedTags(value, { field, maxLength = 20, maxCount = 10 }) {
  const tags = arrayOfStrings(value);
  if (tags.length > maxCount) throw badRequest(`${field}最多 ${maxCount} 个`);
  for (const tag of tags) {
    if (Array.from(tag).length > maxLength) throw badRequest(`单个${field}最多 ${maxLength} 字`);
  }
  return tags;
}

/** External links must be https:// and ≤ 500 characters. Empty is allowed. */
export function assertExternalLink(value) {
  const link = boundedString(value, { max: 500, field: "外部链接" });
  if (!link) return "";
  let parsed;
  try { parsed = new URL(link); } catch { throw badRequest("外部链接必须以 https:// 开头"); }
  if (parsed.protocol !== "https:" || !parsed.hostname) throw badRequest("外部链接必须以 https:// 开头");
  return link;
}

/** Card image aspect ratio, clamped to [0.3, 3]; non-numbers fall back to 1.08. */
export function clampImageAspect(value) {
  const number = Number(value);
  if (value === undefined || value === null || value === "" || !Number.isFinite(number) || number <= 0) return 1.08;
  return Math.min(3, Math.max(0.3, number));
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Deadlines must fall between one day ago and two years from now. */
export function assertDeadlineInRange(date, now = new Date()) {
  if (!date) return date;
  const time = date.getTime();
  if (time < now.getTime() - DAY_MS || time > now.getTime() + 2 * 365 * DAY_MS) {
    throw badRequest("截团时间需在一天前到两年内");
  }
  return date;
}

export const MESSAGE_ID_PATTERN = /^m-[A-Za-z0-9_-]{1,120}$/;
export const THREAD_ID_PATTERN = /^t-[A-Za-z0-9_-]{1,200}$/;

/** Post text fields shared by POST /posts. Throws 400 on the first violation. */
export function assertPostTextFields(body = {}) {
  return {
    title: boundedString(body.title, { max: 60, field: "标题" }),
    description: boundedString(body.description, { max: 3000, field: "描述" }),
    price: boundedString(body.price, { max: 40, field: "价格" }),
    deposit: boundedString(body.deposit, { max: 40, field: "定金" }),
    condition: boundedString(body.condition, { max: 40, field: "成色" }),
    pingguAveragePrice: boundedString(body.pingguAveragePrice, { max: 40, field: "拼谷均价" }),
    pingguNote: boundedString(body.pingguNote, { max: 100, field: "拼谷备注" }),
    externalLink: assertExternalLink(body.externalLink),
    categoryTags: boundedTags(body.categoryTags, { field: "分类标签" }),
    fandomTags: boundedTags(body.fandomTags, { field: "作品标签" }),
    wechat: boundedString(body.wechat, { max: 40, field: "微信" }),
    qq: boundedString(body.qq, { max: 40, field: "QQ" }),
    groupNumber: boundedString(body.groupNumber, { max: 40, field: "群号" }),
    groupInfo: boundedString(body.groupInfo, { max: 500, field: "群信息" })
  };
}

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
  if (value !== "register" && value !== "login") {
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

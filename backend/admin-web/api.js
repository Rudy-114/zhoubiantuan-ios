const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_COOKIE_NAME = "zbt_admin_csrf";

export class AdminAPIError extends Error {
  constructor(message, { status = 0, code = "admin_request_failed" } = {}) {
    super(message);
    this.name = "AdminAPIError";
    this.status = status;
    this.code = code;
  }
}

export async function adminFetch(path, options = {}) {
  const origin = globalThis.location?.origin;
  if (!origin) throw new AdminAPIError("无法确认管理员服务来源");
  const url = new URL(path, origin);
  if (url.origin !== origin || !url.pathname.startsWith("/admin/api/")) {
    throw new AdminAPIError("管理员请求必须使用同源 API", { code: "admin_url_invalid" });
  }

  const method = String(options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});
  let body;
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }
  if (!SAFE_METHODS.has(method)) {
    const csrf = readCookie(CSRF_COOKIE_NAME);
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }

  const response = await fetch(url, {
    ...options,
    method,
    headers,
    body,
    credentials: "same-origin"
  });
  if (response.status === 401) notifyUnauthorized();
  const contentType = response.headers.get("content-type") || "";
  let payload = null;
  if (response.status !== 204) {
    if (!contentType.toLowerCase().includes("application/json")) {
      await response.body?.cancel();
      throw new AdminAPIError("管理员服务返回了无效响应", {
        status: response.status,
        code: "admin_response_invalid"
      });
    }
    try {
      payload = await response.json();
    } catch {
      throw new AdminAPIError("管理员服务返回了无效 JSON", {
        status: response.status,
        code: "admin_response_invalid"
      });
    }
  }

  if (!response.ok) {
    throw new AdminAPIError(payload?.error || "管理员请求失败", {
      status: response.status,
      code: payload?.code || "admin_request_failed"
    });
  }
  return payload;
}

function readCookie(name) {
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of String(globalThis.document?.cookie || "").split(";")) {
    const value = part.trim();
    if (value.startsWith(prefix)) return decodeURIComponent(value.slice(prefix.length));
  }
  return "";
}

function notifyUnauthorized() {
  if (typeof globalThis.dispatchEvent !== "function" || typeof globalThis.CustomEvent !== "function") return;
  globalThis.dispatchEvent(new CustomEvent("admin:unauthorized"));
}

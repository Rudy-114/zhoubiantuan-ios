import { createHash, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { withTransaction } from "../db.js";
import { parseRequestedCookies } from "./cookies.js";
import { authenticateAdminSession } from "./sessionService.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function requireAdminSession(req, res, next) {
  const cookies = parseRequestedCookies(req.headers?.cookie, [config.admin.sessionCookieName]);
  const sessionToken = cookies[config.admin.sessionCookieName];
  try {
    const authenticated = await withTransaction((client) => authenticateAdminSession(client, { sessionToken }));
    req.adminSession = authenticated.session;
    req.adminUser = authenticated.user;
    req.adminDevice = authenticated.device;
    return next();
  } catch (error) {
    if (error?.apiCode === "admin_auth_required") {
      return res.status(401).json({ error: "管理员登录已失效", code: "admin_auth_required" });
    }
    return next(error);
  }
}

export function requireAdminCSRF(req, res, next) {
  if (SAFE_METHODS.has(String(req.method || "").toUpperCase())) return next();
  if (!req.adminSession?.csrfHash) {
    return res.status(401).json({ error: "管理员登录已失效", code: "admin_auth_required" });
  }

  const cookies = parseRequestedCookies(req.headers?.cookie, [config.admin.csrfCookieName]);
  const cookieToken = cookies[config.admin.csrfCookieName];
  const headerToken = req.headers?.["x-csrf-token"];
  if (!sameToken(cookieToken, headerToken) ||
      !sameHash(req.adminSession.csrfHash, tokenHash(headerToken))) {
    return res.status(403).json({ error: "管理员请求验证失败", code: "admin_csrf_invalid" });
  }
  return next();
}

function sameToken(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length > 0 && leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function sameHash(left, right) {
  if (!/^[a-f0-9]{64}$/.test(left || "") || !/^[a-f0-9]{64}$/.test(right || "")) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function tokenHash(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) return "";
  return createHash("sha256").update(value, "utf8").digest("hex");
}

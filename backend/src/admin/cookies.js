import { config } from "../config.js";

const COOKIE_PATH = "/admin";
const COOKIE_MAX_AGE_SECONDS = 8 * 60 * 60;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function parseRequestedCookies(header, requestedNames) {
  const result = {};
  if (typeof header !== "string" || header.length > 8192 || !Array.isArray(requestedNames)) return result;
  const requested = new Set(requestedNames.filter(validCookieName));
  const duplicates = new Set();
  const seen = new Set();

  for (const segment of header.split(";")) {
    const separator = segment.indexOf("=");
    if (separator <= 0) continue;
    const name = segment.slice(0, separator).trim();
    if (!requested.has(name) || duplicates.has(name)) continue;
    if (seen.has(name)) {
      delete result[name];
      duplicates.add(name);
      continue;
    }
    seen.add(name);
    try {
      const value = decodeURIComponent(segment.slice(separator + 1).trim());
      if (!value || /[\u0000-\u001f\u007f]/u.test(value)) continue;
      result[name] = value;
    } catch {
      // Ignore malformed percent-encoding and treat the requested cookie as absent.
    }
  }
  return result;
}

export function adminSessionCookieHeaders({
  sessionToken,
  csrfToken,
  hostname,
  nodeEnv = config.nodeEnv,
  cookieSecure = config.admin.cookieSecure
} = {}) {
  const secure = secureCookiesRequired({ hostname, nodeEnv, cookieSecure });
  return [
    serializeCookie(config.admin.sessionCookieName, sessionToken, { httpOnly: true, secure }),
    serializeCookie(config.admin.csrfCookieName, csrfToken, { httpOnly: false, secure })
  ];
}

export function clearAdminSessionCookieHeaders({
  hostname,
  nodeEnv = config.nodeEnv,
  cookieSecure = config.admin.cookieSecure
} = {}) {
  const secure = secureCookiesRequired({ hostname, nodeEnv, cookieSecure });
  return [
    serializeCookie(config.admin.sessionCookieName, "", { httpOnly: true, secure, maxAge: 0 }),
    serializeCookie(config.admin.csrfCookieName, "", { httpOnly: false, secure, maxAge: 0 })
  ];
}

function serializeCookie(name, value, { httpOnly, secure, maxAge = COOKIE_MAX_AGE_SECONDS }) {
  if (!validCookieName(name) || typeof value !== "string" || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError("Invalid admin cookie");
  }
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${COOKIE_PATH}`
  ];
  if (httpOnly) attributes.push("HttpOnly");
  if (secure) attributes.push("Secure");
  attributes.push("SameSite=Strict", `Max-Age=${maxAge}`);
  return attributes.join("; ");
}

function secureCookiesRequired({ hostname, nodeEnv, cookieSecure }) {
  if (nodeEnv === "production" || cookieSecure) return true;
  if (nodeEnv !== "test" && nodeEnv !== "development") return true;
  return !LOOPBACK_HOSTS.has(normalizedHostname(hostname));
}

function normalizedHostname(value) {
  if (typeof value !== "string") return "";
  const hostname = value.trim().toLowerCase();
  if (hostname.startsWith("[")) {
    const closing = hostname.indexOf("]");
    return closing > 0 ? hostname.slice(1, closing) : "";
  }
  if (hostname === "::1") return hostname;
  const firstColon = hostname.indexOf(":");
  return firstColon < 0 ? hostname : hostname.slice(0, firstColon);
}

function validCookieName(value) {
  return typeof value === "string" && /^[A-Za-z0-9_]+$/.test(value) && value !== "__proto__";
}

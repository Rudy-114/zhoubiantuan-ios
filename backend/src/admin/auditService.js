import { createHmac } from "node:crypto";
import { assertRecoveryPepper } from "./recoveryCodes.js";

const FORBIDDEN_EVENT_KEY = /(?:password|signature|nonce|token|cookie|public.?key|private.?key|hash|short.?code|recovery.?code|bootstrap.?code|ip)/iu;

export async function recordAdminAuditEvent(client, input = {}) {
  if (!client || typeof client.query !== "function") {
    throw new TypeError("admin audit service requires a database client");
  }
  const eventType = boundedIdentifier(input.eventType, 80, "event type");
  const subjectType = optionalIdentifier(input.subjectType, 80);
  const subjectId = optionalText(input.subjectId, 160);
  const eventData = sanitizedEventData(input.eventData);
  const { rows } = await client.query(
    `INSERT INTO admin_audit_events (
       admin_user_id, device_id, session_id, event_type,
       subject_type, subject_id, ip_hash, user_agent_summary, event_data
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     RETURNING id, created_at`,
    [
      input.adminUserId || null,
      input.deviceId || null,
      input.sessionId || null,
      eventType,
      subjectType || null,
      subjectId || null,
      hashAdminSourceIP(input.ip),
      summarizeAdminUserAgent(input.userAgent),
      JSON.stringify(eventData)
    ]
  );
  return rows[0];
}

export function hashAdminSourceIP(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  return createHmac("sha256", assertRecoveryPepper())
    .update(`zbt-admin-ip-v1\n${value.trim()}`, "utf8")
    .digest("hex");
}

export function summarizeAdminUserAgent(value) {
  const source = typeof value === "string" ? value.slice(0, 1000) : "";
  const browser = /Edg\//u.test(source) ? "Edge"
    : /Chrome\//u.test(source) ? "Chrome"
      : /Firefox\//u.test(source) ? "Firefox"
        : /Safari\//u.test(source) ? "Safari"
          : "Other";
  const platform = /Android/u.test(source) ? "Android"
    : /iPhone|iPad/u.test(source) ? "iOS"
      : /Windows/u.test(source) ? "Windows"
        : /Macintosh|Mac OS X/u.test(source) ? "macOS"
          : /Linux/u.test(source) ? "Linux"
            : "Other";
  return `${browser} / ${platform}`.slice(0, 120);
}

function sanitizedEventData(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(key) || FORBIDDEN_EVENT_KEY.test(key)) continue;
    if (typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))) {
      result[key] = item;
    } else if (typeof item === "string") {
      result[key] = item.slice(0, 200);
    }
  }
  return result;
}

function boundedIdentifier(value, limit, name) {
  if (typeof value !== "string" || !/^[a-z0-9_.-]+$/u.test(value) || value.length > limit) {
    throw new TypeError(`Invalid admin audit ${name}`);
  }
  return value;
}

function optionalIdentifier(value, limit) {
  if (value == null || value === "") return "";
  return boundedIdentifier(value, limit, "subject type");
}

function optionalText(value, limit) {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || Array.from(value).length > limit || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError("Invalid admin audit subject");
  }
  return value;
}

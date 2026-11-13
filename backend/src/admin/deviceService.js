import bcrypt from "bcryptjs";
import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { publicKeyFingerprint } from "./crypto.js";
import { assertRecoveryPepper, hashBootstrapCode, hashRecoveryCode } from "./recoveryCodes.js";
import { hashAdminSourceIP, summarizeAdminUserAgent } from "./auditService.js";

const DUMMY_PASSWORD_HASH = "$2b$12$UQYtZhRqshsHs97Ards4BuCerUY4FGqT4CBDcurADQdm9gklyvvA2";
const SHORT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function adminError(status, apiCode, message) {
  const error = new Error(message);
  error.status = status;
  error.apiCode = apiCode;
  error.isAdminClientError = status >= 400 && status < 500;
  return error;
}

export function normalizeAdminUsername(value) {
  if (typeof value !== "string") throw adminBadRequest("管理员名无效");
  const username = value.trim().normalize("NFKC");
  const normalized = username.toLowerCase();
  if (!username || username.startsWith("-") || Array.from(username).length > 64 ||
      Array.from(normalized).length > 64 || !/^[\p{L}\p{N}._-]+$/u.test(username)) {
    throw adminBadRequest("管理员名无效");
  }
  return { username, normalized };
}

export function validateAdminDeviceInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw adminBadRequest("设备信息无效");
  }
  const id = boundedIdentifier(input.deviceID, 160, "deviceID");
  const name = boundedText(input.displayName, 80, "displayName");
  let fingerprint;
  try {
    if (Object.prototype.hasOwnProperty.call(input.publicKeyJWK, "d")) {
      throw new TypeError("Private JWK material is not accepted");
    }
    fingerprint = publicKeyFingerprint(input.publicKeyJWK);
  } catch {
    throw adminBadRequest("设备公钥无效");
  }
  const source = input.publicKeyJWK;
  const publicKeyJwk = { kty: source.kty, crv: source.crv, x: source.x, y: source.y };
  if (source.key_ops !== undefined) publicKeyJwk.key_ops = ["verify"];
  return { id, name, publicKeyJwk, fingerprint };
}

export async function verifyAdminPassword(client, { username, password } = {}) {
  let normalized;
  try {
    normalized = normalizeAdminUsername(username).normalized;
  } catch {
    await bcrypt.compare(validPasswordCandidate(password), DUMMY_PASSWORD_HASH);
    return { ok: false, admin: null };
  }
  const { rows } = await client.query(
    `SELECT * FROM admin_users WHERE username_normalized = $1 FOR UPDATE`,
    [normalized]
  );
  let admin = rows[0] || null;
  if (!admin) {
    await bcrypt.compare(validPasswordCandidate(password), DUMMY_PASSWORD_HASH);
    return { ok: false, admin: null };
  }

  if (admin.status === "locked" && admin.locked_until && admin.locked_until <= new Date()) {
    const unlocked = await client.query(
      `UPDATE admin_users
       SET status = 'active', failed_login_count = 0, locked_until = NULL, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [admin.id]
    );
    admin = unlocked.rows[0];
  }

  const matches = await bcrypt.compare(validPasswordCandidate(password), admin.password_hash);
  if (!matches || admin.status !== "active" || (admin.locked_until && admin.locked_until > new Date())) {
    if (!matches && admin.status !== "disabled") {
      const nextCount = Math.min(Number(admin.failed_login_count || 0) + 1, 10);
      const shouldLock = nextCount >= 10;
      const updated = await client.query(
        `UPDATE admin_users
         SET failed_login_count = $2,
             status = CASE WHEN $3 THEN 'locked' ELSE status END,
             locked_until = CASE WHEN $3 THEN now() + interval '15 minutes' ELSE locked_until END,
             updated_at = now()
         WHERE id = $1 RETURNING *`,
        [admin.id, nextCount, shouldLock]
      );
      admin = updated.rows[0];
    }
    return { ok: false, admin };
  }
  return { ok: true, admin };
}

export async function resetAdminLoginFailures(client, adminUserId) {
  await client.query(
    `UPDATE admin_users
     SET status = 'active', failed_login_count = 0, locked_until = NULL, updated_at = now()
     WHERE id = $1`,
    [adminUserId]
  );
}

export async function enrollRootDevice(client, { admin, device, bootstrapCode, pepper }) {
  let codeHash;
  try {
    codeHash = hashBootstrapCode(bootstrapCode, pepper);
  } catch {
    throw adminError(401, "admin_bootstrap_invalid", "管理员初始化码无效或已过期");
  }
  const bootstrap = await client.query(
    `SELECT id FROM admin_bootstrap_codes
     WHERE admin_user_id = $1 AND code_hash = $2
       AND consumed_at IS NULL AND expires_at > now()
     FOR UPDATE`,
    [admin.id, codeHash]
  );
  const existingDevices = await client.query(
    `SELECT id FROM admin_devices WHERE admin_user_id = $1 FOR UPDATE`,
    [admin.id]
  );
  if (!bootstrap.rows[0] || existingDevices.rows.length > 0) {
    throw adminError(401, "admin_bootstrap_invalid", "管理员初始化码无效或已过期");
  }

  await client.query(
    `INSERT INTO admin_devices (
       id, admin_user_id, display_name, public_key_jwk, fingerprint_hash, is_root
     ) VALUES ($1, $2, $3, $4::jsonb, $5, true)`,
    [device.id, admin.id, device.name, JSON.stringify(device.publicKeyJwk), device.fingerprint]
  );
  await client.query(
    "UPDATE admin_bootstrap_codes SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL",
    [bootstrap.rows[0].id]
  );
  return deviceResponse(device, true);
}

export async function createPendingDeviceRequest(client, {
  admin,
  device,
  ip,
  userAgent,
  pepper
}) {
  assertRecoveryPepper(pepper);
  const root = await client.query(
    `SELECT 1 FROM admin_devices
     WHERE admin_user_id = $1 AND is_root = true AND status = 'approved'
     LIMIT 1`,
    [admin.id]
  );
  if (!root.rows[0]) throw adminError(409, "admin_bootstrap_required", "请先完成根设备初始化");
  const collision = await client.query(
    `SELECT 1 FROM admin_devices
     WHERE id = $1 OR (admin_user_id = $2 AND fingerprint_hash = $3)
     LIMIT 1`,
    [device.id, admin.id, device.fingerprint]
  );
  if (collision.rows[0]) throw adminError(409, "admin_device_invalid", "设备已注册或不可用");

  const existing = await client.query(
    `SELECT id FROM admin_device_requests
     WHERE admin_user_id = $1 AND proposed_device_id = $2 AND status = 'pending'
     ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
    [admin.id, device.id]
  );
  const requestId = existing.rows[0]?.id || `adreq-${randomUUID()}`;
  const shortCode = generateShortCode();
  const shortCodeHash = hashDeviceShortCode(shortCode, pepper);
  const expiresAt = new Date(Date.now() + config.admin.deviceRequestTtlMinutes * 60 * 1000);
  if (existing.rows[0]) {
    await client.query(
      `UPDATE admin_device_requests
       SET display_name = $2, public_key_jwk = $3::jsonb, fingerprint_hash = $4,
           short_code_hash = $5, requested_ip_hash = $6, user_agent_summary = $7,
           expires_at = $8, created_at = now()
       WHERE id = $1`,
      [requestId, device.name, JSON.stringify(device.publicKeyJwk), device.fingerprint,
        shortCodeHash, hashAdminSourceIP(ip), summarizeAdminUserAgent(userAgent), expiresAt]
    );
  } else {
    await client.query(
      `INSERT INTO admin_device_requests (
         id, admin_user_id, proposed_device_id, display_name, public_key_jwk,
         fingerprint_hash, short_code_hash, requested_ip_hash, user_agent_summary, expires_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)`,
      [requestId, admin.id, device.id, device.name, JSON.stringify(device.publicKeyJwk),
        device.fingerprint, shortCodeHash, hashAdminSourceIP(ip), summarizeAdminUserAgent(userAgent), expiresAt]
    );
  }
  return { requestId, shortCode, expiresAt };
}

export async function loadApprovedAdminDevice(client, { adminUserId, deviceId, lock = false }) {
  const { rows } = await client.query(
    `SELECT id, admin_user_id, display_name, public_key_jwk, fingerprint_hash, is_root,
            status, approved_at, last_used_at, revoked_at, created_at
     FROM admin_devices
     WHERE id = $1 AND admin_user_id = $2 AND status = 'approved'
     ${lock ? "FOR SHARE" : ""}`,
    [deviceId, adminUserId]
  );
  return rows[0] || null;
}

export async function listAdminDevices(client, adminUserId) {
  const { rows } = await client.query(
    `SELECT id, display_name, is_root, status, approved_at, last_used_at, revoked_at, created_at
     FROM admin_devices WHERE admin_user_id = $1
     ORDER BY is_root DESC, created_at ASC, id ASC`,
    [adminUserId]
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.display_name,
    isRoot: row.is_root,
    status: row.status,
    approvedAt: row.approved_at?.toISOString() || null,
    lastUsedAt: row.last_used_at?.toISOString() || null,
    revokedAt: row.revoked_at?.toISOString() || null,
    createdAt: row.created_at.toISOString()
  }));
}

export async function listPendingAdminDeviceRequests(client, adminUserId) {
  await client.query(
    `UPDATE admin_device_requests SET status = 'expired'
     WHERE admin_user_id = $1 AND status = 'pending' AND expires_at <= now()`,
    [adminUserId]
  );
  const { rows } = await client.query(
    `SELECT id, proposed_device_id, display_name, status, user_agent_summary,
            expires_at, handled_at, created_at
     FROM admin_device_requests WHERE admin_user_id = $1
     ORDER BY created_at DESC, id DESC`,
    [adminUserId]
  );
  return rows.map((row) => ({
    id: row.id,
    proposedDeviceID: row.proposed_device_id,
    name: row.display_name,
    status: row.status,
    userAgentSummary: row.user_agent_summary,
    expiresAt: row.expires_at.toISOString(),
    handledAt: row.handled_at?.toISOString() || null,
    createdAt: row.created_at.toISOString()
  }));
}

export function hashDeviceShortCode(value, pepper = process.env.ADMIN_RECOVERY_PEPPER) {
  const secret = assertRecoveryPepper(pepper);
  if (typeof value !== "string" || !/^[A-Z2-9]{6}$/u.test(value.trim().toUpperCase())) {
    throw adminError(401, "admin_device_confirmation_invalid", "设备校验码无效");
  }
  return createHmac("sha256", secret)
    .update(`zbt-admin-v1\ndevice-short-code\n${value.trim().toUpperCase()}`, "utf8")
    .digest("hex");
}

export async function consumeRecoveryCode(client, { adminUserId, recoveryCode, pepper }) {
  let hash;
  try {
    hash = hashRecoveryCode(recoveryCode, pepper);
  } catch {
    throw adminError(401, "admin_recovery_invalid", "管理员恢复凭据无效");
  }
  const result = await client.query(
    `UPDATE admin_recovery_codes SET used_at = now()
     WHERE admin_user_id = $1 AND code_hash = $2 AND used_at IS NULL
     RETURNING id`,
    [adminUserId, hash]
  );
  if (!result.rows[0]) throw adminError(401, "admin_recovery_invalid", "管理员恢复凭据无效");
}

export function deviceResponse(device, isRoot) {
  return { id: device.id, name: device.name, isRoot };
}

export function sameSecretHash(left, right) {
  if (!/^[a-f0-9]{64}$/u.test(left || "") || !/^[a-f0-9]{64}$/u.test(right || "")) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function generateShortCode() {
  let value = "";
  for (let index = 0; index < 6; index += 1) value += SHORT_CODE_ALPHABET[randomInt(SHORT_CODE_ALPHABET.length)];
  return value;
}

function validPasswordCandidate(value) {
  return typeof value === "string" && Array.from(value).length <= 256 ? value : "";
}

function boundedIdentifier(value, limit, name) {
  if (typeof value !== "string" || !value || value !== value.trim() ||
      Array.from(value).length > limit || !/^[A-Za-z0-9._:-]+$/u.test(value)) {
    throw adminBadRequest(`${name} 无效`);
  }
  return value;
}

function boundedText(value, limit, name) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() ||
      Array.from(value).length > limit || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw adminBadRequest(`${name} 无效`);
  }
  return value;
}

function adminBadRequest(message) {
  return adminError(400, "admin_request_invalid", message);
}

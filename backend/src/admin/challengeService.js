import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

const PURPOSES = new Set(["login", "approve_device", "reject_device", "revoke_device"]);
const TRANSACTION_PROBE = "admin_challenge_transaction_probe";

export async function createAdminChallenge(client, input = {}) {
  assertTransactionClient(client);
  await assertActiveTransaction(client);
  const adminUserId = requiredString(input.adminUserId, 160);
  const deviceId = requiredString(input.deviceId, 160);
  const purpose = validPurpose(input.purpose);
  const targetId = normalizedTargetId(input.targetId, purpose);

  const identity = await client.query(
    `SELECT au.status AS admin_status, d.status AS device_status,
            d.admin_user_id AS device_admin_user_id
     FROM admin_users au
     JOIN admin_devices d ON d.id = $2
     WHERE au.id = $1
     FOR SHARE OF au, d`,
    [adminUserId, deviceId]
  );
  const row = identity.rows[0];
  if (!row || row.admin_status !== "active" || row.device_status !== "approved" ||
      row.device_admin_user_id !== adminUserId) {
    throw invalidChallenge();
  }

  const challengeId = `ach-${randomUUID()}`;
  const nonce = randomBytes(32).toString("base64url");
  const nonceHash = sha256(nonce);
  const inserted = await client.query(
    `INSERT INTO admin_auth_challenges (
       id, admin_user_id, device_id, purpose, target_id, nonce_hash, expires_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, now() + ($7::integer * interval '1 second')
     )
     RETURNING id, purpose, target_id, expires_at`,
    [challengeId, adminUserId, deviceId, purpose, targetId || null, nonceHash, config.admin.challengeTtlSeconds]
  );
  return {
    challengeId: inserted.rows[0].id,
    purpose: inserted.rows[0].purpose,
    targetId: inserted.rows[0].target_id || "",
    nonce,
    expiresAt: inserted.rows[0].expires_at.toISOString()
  };
}

export async function consumeAdminChallenge(client, input = {}) {
  assertTransactionClient(client);
  await assertActiveTransaction(client);
  const normalized = normalizedConsumeInput(input);
  const { rows } = await client.query(
    `SELECT challenge.*, au.status AS admin_status,
            device.status AS device_status,
            device.admin_user_id AS device_admin_user_id,
            challenge.expires_at > now() AS is_live
     FROM admin_auth_challenges challenge
     JOIN admin_users au ON au.id = challenge.admin_user_id
     JOIN admin_devices device ON device.id = challenge.device_id
     WHERE challenge.id = $1
     FOR UPDATE OF challenge`,
    [normalized.challengeId]
  );
  const challenge = rows[0];
  if (!challenge || challenge.admin_user_id !== normalized.adminUserId ||
      challenge.device_id !== normalized.deviceId || challenge.purpose !== normalized.purpose ||
      (challenge.target_id || "") !== normalized.targetId || challenge.admin_status !== "active" ||
      challenge.device_status !== "approved" ||
      challenge.device_admin_user_id !== normalized.adminUserId || !challenge.is_live ||
      challenge.consumed_at || !sameHash(challenge.nonce_hash, sha256(normalized.nonce))) {
    throw invalidChallenge();
  }

  const consumed = await client.query(
    `UPDATE admin_auth_challenges SET consumed_at = now()
     WHERE id = $1 AND consumed_at IS NULL
     RETURNING *`,
    [normalized.challengeId]
  );
  if (!consumed.rows[0]) throw invalidChallenge();
  return consumed.rows[0];
}

function normalizedConsumeInput(input) {
  try {
    const purpose = validPurpose(input.purpose);
    return {
      challengeId: requiredString(input.challengeId, 160),
      adminUserId: requiredString(input.adminUserId, 160),
      deviceId: requiredString(input.deviceId, 160),
      purpose,
      targetId: normalizedTargetId(input.targetId, purpose),
      nonce: requiredString(input.nonce, 256)
    };
  } catch {
    throw invalidChallenge();
  }
}

function validPurpose(value) {
  if (!PURPOSES.has(value)) throw invalidChallenge();
  return value;
}

function normalizedTargetId(value, purpose) {
  if (purpose === "login") {
    if (value == null || value === "") return "";
    throw invalidChallenge();
  }
  return requiredString(value, 160);
}

function requiredString(value, limit) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() ||
      Array.from(value).length > limit || /[\u0000\r\n]/u.test(value)) {
    throw invalidChallenge();
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sameHash(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.length === 32 && rightBytes.length === 32 && timingSafeEqual(leftBytes, rightBytes);
}

function invalidChallenge() {
  const error = new Error("管理员验证请求无效或已过期");
  error.status = 401;
  error.apiCode = "invalid_admin_challenge";
  return error;
}

function assertTransactionClient(client) {
  if (!client || typeof client.query !== "function" || typeof client.release !== "function") {
    throw new TypeError("admin challenge service requires a transaction-scoped pg PoolClient");
  }
}

async function assertActiveTransaction(client) {
  try {
    await client.query(`SAVEPOINT ${TRANSACTION_PROBE}`);
    await client.query(`RELEASE SAVEPOINT ${TRANSACTION_PROBE}`);
  } catch (error) {
    const developerError = new TypeError("admin challenge service requires an active transaction");
    developerError.cause = error;
    throw developerError;
  }
}

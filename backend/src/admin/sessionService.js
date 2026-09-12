import { createHash, randomBytes, randomUUID } from "node:crypto";
import { config } from "../config.js";

const TRANSACTION_PROBE = "admin_session_transaction_probe";

export async function createAdminSession(client, input = {}) {
  assertTransactionClient(client);
  await assertActiveTransaction(client);
  const adminUserId = requiredIdentifier(input.adminUserId);
  const deviceId = requiredIdentifier(input.deviceId);

  const identity = await client.query(
    `SELECT au.status AS admin_status, device.status AS device_status,
            device.admin_user_id AS device_admin_user_id
     FROM admin_users au
     JOIN admin_devices device ON device.id = $2
     WHERE au.id = $1
     FOR SHARE OF au, device`,
    [adminUserId, deviceId]
  );
  const row = identity.rows[0];
  if (!row || row.admin_status !== "active" || row.device_status !== "approved" ||
      row.device_admin_user_id !== adminUserId) {
    throw adminAuthRequired();
  }

  const sessionId = `asess-${randomUUID()}`;
  const sessionToken = randomToken();
  const csrfToken = randomToken();
  const inserted = await client.query(
    `INSERT INTO admin_sessions (
       id, admin_user_id, device_id, token_hash, csrf_hash,
       idle_expires_at, absolute_expires_at
     ) VALUES (
       $1, $2, $3, $4, $5,
       now() + ($6::integer * interval '1 minute'),
       now() + ($7::integer * interval '1 hour')
     )
     RETURNING id, idle_expires_at, absolute_expires_at`,
    [
      sessionId,
      adminUserId,
      deviceId,
      hashAdminToken(sessionToken),
      hashAdminToken(csrfToken),
      config.admin.sessionIdleMinutes,
      config.admin.sessionAbsoluteHours
    ]
  );
  return {
    sessionId: inserted.rows[0].id,
    sessionToken,
    csrfToken,
    idleExpiresAt: inserted.rows[0].idle_expires_at.toISOString(),
    absoluteExpiresAt: inserted.rows[0].absolute_expires_at.toISOString()
  };
}

export async function authenticateAdminSession(client, input = {}) {
  assertTransactionClient(client);
  await assertActiveTransaction(client);
  let tokenHash;
  try {
    tokenHash = hashAdminToken(strictToken(input.sessionToken));
  } catch {
    throw adminAuthRequired();
  }

  const { rows } = await client.query(
    `SELECT session.id, session.admin_user_id, session.device_id, session.csrf_hash,
            session.absolute_expires_at,
            au.username, au.status AS admin_status,
            device.display_name, device.is_root, device.status AS device_status,
            device.admin_user_id AS device_admin_user_id
     FROM admin_sessions session
     JOIN admin_users au ON au.id = session.admin_user_id
     JOIN admin_devices device ON device.id = session.device_id
     WHERE session.token_hash = $1
       AND session.revoked_at IS NULL
       AND session.idle_expires_at > now()
       AND session.absolute_expires_at > now()
     FOR UPDATE OF session FOR SHARE OF au, device`,
    [tokenHash]
  );
  const session = rows[0];
  if (!session || session.admin_status !== "active" || session.device_status !== "approved" ||
      session.device_admin_user_id !== session.admin_user_id) {
    throw adminAuthRequired();
  }

  const touched = await client.query(
    `UPDATE admin_sessions
     SET last_seen_at = now(),
         idle_expires_at = LEAST(
           now() + ($2::integer * interval '1 minute'),
           absolute_expires_at
         )
     WHERE id = $1 AND revoked_at IS NULL
     RETURNING idle_expires_at`,
    [session.id, config.admin.sessionIdleMinutes]
  );
  if (!touched.rows[0]) throw adminAuthRequired();

  return {
    session: {
      id: session.id,
      adminUserId: session.admin_user_id,
      deviceId: session.device_id,
      csrfHash: session.csrf_hash,
      idleExpiresAt: touched.rows[0].idle_expires_at,
      absoluteExpiresAt: session.absolute_expires_at
    },
    user: {
      id: session.admin_user_id,
      username: session.username
    },
    device: {
      id: session.device_id,
      displayName: session.display_name,
      isRoot: session.is_root
    }
  };
}

export async function revokeAdminSession(client, input = {}) {
  assertTransactionClient(client);
  await assertActiveTransaction(client);
  const sessionId = requiredIdentifier(input.sessionId);
  const revoked = await client.query(
    `UPDATE admin_sessions
     SET revoked_at = COALESCE(revoked_at, now())
     WHERE id = $1
     RETURNING id, revoked_at`,
    [sessionId]
  );
  return revoked.rows[0] || null;
}

export function hashAdminToken(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function randomToken() {
  return randomBytes(32).toString("base64url");
}

function strictToken(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw adminAuthRequired();
  }
  return value;
}

function requiredIdentifier(value) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() ||
      Array.from(value).length > 160 || /[\u0000\r\n]/u.test(value)) {
    throw adminAuthRequired();
  }
  return value;
}

function adminAuthRequired() {
  const error = new Error("管理员登录已失效");
  error.status = 401;
  error.apiCode = "admin_auth_required";
  return error;
}

function assertTransactionClient(client) {
  if (!client || typeof client.query !== "function" || typeof client.release !== "function") {
    throw new TypeError("admin session service requires a transaction-scoped pg PoolClient");
  }
}

async function assertActiveTransaction(client) {
  try {
    await client.query(`SAVEPOINT ${TRANSACTION_PROBE}`);
    await client.query(`RELEASE SAVEPOINT ${TRANSACTION_PROBE}`);
  } catch (error) {
    const developerError = new TypeError("admin session service requires an active transaction");
    developerError.cause = error;
    throw developerError;
  }
}

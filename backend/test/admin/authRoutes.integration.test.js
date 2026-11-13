import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import { createApp } from "../../src/app.js";
import { canonicalChallengePayload } from "../../src/admin/crypto.js";
import { hashBootstrapCode, hashRecoveryCode } from "../../src/admin/recoveryCodes.js";
import { closeDatabase, pool, resetDatabase } from "../helpers/database.js";

const pepper = "test-admin-recovery-pepper-with-32-plus-characters";
const username = "RootAdmin";
const password = "Long admin password 2026";
const bootstrapCode = "ABCD-EFGH-JKLM-NPQR";
const recoveryCode = "QRST-UVWX-YZ23-4567";

process.env.ADMIN_RECOVERY_PEPPER = pepper;

test.beforeEach(async () => {
  await resetDatabase();
  await seedAdminBootstrap();
});

test.after(closeDatabase);

test("runs bootstrap, trusted-device login, approval, recovery, lockout, and logout end to end", async () => {
  await withServer(async (baseUrl) => {
    const rootKey = keyPair();
    const rootEnrollment = await request(baseUrl, "/admin/api/auth/device-requests", {
      method: "POST",
      body: {
        username,
        password,
        deviceID: "device-root",
        displayName: "Root Mac",
        publicKeyJWK: rootKey.jwk,
        bootstrapCode
      },
      origin: "https://attacker.example"
    });
    assert.equal(rootEnrollment.status, 201);
    assert.deepEqual(rootEnrollment.body, {
      status: "approved",
      device: { id: "device-root", name: "Root Mac", isRoot: true }
    });
    assert.equal(rootEnrollment.headers.get("access-control-allow-origin"), null);
    assert.equal(rootEnrollment.headers.get("cache-control"), "no-store");
    assert.deepEqual(rootEnrollment.headers.getSetCookie(), []);

    const replayBootstrap = await request(baseUrl, "/admin/api/auth/device-requests", {
      method: "POST",
      body: {
        username,
        password,
        deviceID: "device-bootstrap-replay",
        displayName: "Replay",
        publicKeyJWK: keyPair().jwk,
        bootstrapCode
      }
    });
    assert.equal(replayBootstrap.status, 401);
    assert.equal(replayBootstrap.body.code, "admin_bootstrap_invalid");
    assert.deepEqual(replayBootstrap.headers.getSetCookie(), []);

    await pool.query(
      "UPDATE admin_users SET failed_login_count = 3 WHERE username_normalized = 'rootadmin'"
    );
    const rootChallenge = await loginChallenge(baseUrl, "device-root");
    const rootLogin = await login(baseUrl, rootChallenge, rootKey.privateKey, "device-root");
    assert.equal(rootLogin.status, 200);
    const rootCookies = cookiesFrom(rootLogin.headers.getSetCookie());
    assert.deepEqual([...rootCookies.keys()].sort(), ["zbt_admin_csrf", "zbt_admin_session"]);
    assert.equal((await adminUserState()).failed_login_count, 0);

    const replayLogin = await login(baseUrl, rootChallenge, rootKey.privateKey, "device-root");
    assert.equal(replayLogin.status, 401);
    assert.deepEqual(replayLogin.body, {
      error: "管理员凭据或设备验证失败",
      code: "admin_auth_invalid"
    });

    const session = await request(baseUrl, "/admin/api/auth/session", { cookies: rootCookies });
    assert.equal(session.status, 200);
    assert.equal(session.body.session.adminID.startsWith("admin-"), true);
    assert.equal(session.body.session.username, username);
    assert.equal(session.body.session.deviceID, "device-root");
    assert.equal(session.body.session.deviceName, "Root Mac");
    assert.equal(session.body.session.isRoot, true);
    assert.deepEqual(Object.keys(session.body.session).sort(), [
      "absoluteExpiresAt", "adminID", "deviceID", "deviceName", "idleExpiresAt", "isRoot", "username"
    ]);

    const secondKey = keyPair();
    const pending = await request(baseUrl, "/admin/api/auth/device-requests", {
      method: "POST",
      body: {
        username,
        password,
        deviceID: "device-second",
        displayName: "Second Browser",
        publicKeyJWK: secondKey.jwk
      }
    });
    assert.equal(pending.status, 202);
    assert.equal(pending.body.status, "pending");
    assert.match(pending.body.requestID, /^adreq-/);
    assert.match(pending.body.shortCode, /^[A-Z2-9]{6}$/);
    assert.deepEqual(pending.headers.getSetCookie(), []);

    const pendingLoginChallenge = await request(baseUrl, "/admin/api/auth/challenges", {
      method: "POST",
      body: { username, deviceID: "device-second", purpose: "login" }
    });
    assert.equal(pendingLoginChallenge.status, 401);
    assert.deepEqual(pendingLoginChallenge.headers.getSetCookie(), []);

    const requests = await request(baseUrl, "/admin/api/auth/device-requests", { cookies: rootCookies });
    assert.equal(requests.status, 200);
    assert.equal(requests.body.requests.length, 1);
    assert.equal(requests.body.requests[0].id, pending.body.requestID);
    assertNoKeys(requests.body, ["publicKeyJWK", "public_key_jwk", "shortCode", "short_code_hash", "requested_ip_hash"]);

    const approveChallenge = await decisionChallenge(
      baseUrl,
      rootCookies,
      "approve_device",
      pending.body.requestID
    );
    const approved = await request(
      baseUrl,
      `/admin/api/auth/device-requests/${pending.body.requestID}/approve`,
      {
        method: "POST",
        cookies: rootCookies,
        csrf: rootCookies.get("zbt_admin_csrf"),
        body: signedDecisionBody(approveChallenge, rootKey.privateKey, pending.body.shortCode)
      }
    );
    assert.equal(approved.status, 200);
    assert.deepEqual(approved.body, {
      status: "approved",
      device: { id: "device-second", name: "Second Browser", isRoot: false }
    });

    const devices = await request(baseUrl, "/admin/api/auth/devices", { cookies: rootCookies });
    assert.equal(devices.status, 200);
    assert.deepEqual(devices.body.devices.map((device) => device.id).sort(), ["device-root", "device-second"]);
    assertNoKeys(devices.body, ["publicKeyJWK", "public_key_jwk", "fingerprint_hash", "token_hash"]);

    const secondChallenge = await loginChallenge(baseUrl, "device-second");
    const secondLogin = await login(baseUrl, secondChallenge, secondKey.privateKey, "device-second");
    assert.equal(secondLogin.status, 200);
    const secondCookies = cookiesFrom(secondLogin.headers.getSetCookie());

    const thirdPending = await request(baseUrl, "/admin/api/auth/device-requests", {
      method: "POST",
      body: {
        username,
        password,
        deviceID: "device-third",
        displayName: "Third Browser",
        publicKeyJWK: keyPair().jwk
      }
    });
    assert.equal(thirdPending.status, 202);
    const nonRootDecisionChallenge = await request(baseUrl, "/admin/api/auth/challenges", {
      method: "POST",
      cookies: secondCookies,
      csrf: secondCookies.get("zbt_admin_csrf"),
      body: { purpose: "approve_device", targetID: thirdPending.body.requestID }
    });
    assert.equal(nonRootDecisionChallenge.status, 403);
    assert.equal(nonRootDecisionChallenge.body.code, "admin_root_required");

    const rejectChallenge = await decisionChallenge(
      baseUrl,
      rootCookies,
      "reject_device",
      thirdPending.body.requestID
    );
    const rejected = await request(
      baseUrl,
      `/admin/api/auth/device-requests/${thirdPending.body.requestID}/reject`,
      {
        method: "POST",
        cookies: rootCookies,
        csrf: rootCookies.get("zbt_admin_csrf"),
        body: {
          ...signedDecisionBody(rejectChallenge, rootKey.privateKey, thirdPending.body.shortCode),
          reason: "无法确认该设备申请"
        }
      }
    );
    assert.equal(rejected.status, 200);
    assert.deepEqual(rejected.body, { status: "rejected" });
    const rejectedRequestState = await pool.query(
      "SELECT count(*)::int AS retained FROM admin_device_requests WHERE id = $1",
      [thirdPending.body.requestID]
    );
    assert.equal(rejectedRequestState.rows[0].retained, 0);

    const selfRevoke = await request(baseUrl, "/admin/api/auth/devices/device-root/revoke", {
      method: "POST",
      cookies: rootCookies,
      csrf: rootCookies.get("zbt_admin_csrf"),
      body: { reason: "Must never revoke the active root" }
    });
    assert.equal(selfRevoke.status, 409);
    assert.equal(selfRevoke.body.code, "admin_device_revoke_invalid");

    const revokeChallenge = await decisionChallenge(
      baseUrl,
      rootCookies,
      "revoke_device",
      "device-second"
    );
    const revoked = await request(baseUrl, "/admin/api/auth/devices/device-second/revoke", {
      method: "POST",
      cookies: rootCookies,
      csrf: rootCookies.get("zbt_admin_csrf"),
      body: {
        ...signedChallengeBody(revokeChallenge, rootKey.privateKey),
        reason: "Second-device verification complete"
      }
    });
    assert.equal(revoked.status, 200);
    assert.deepEqual(revoked.body, {
      status: "revoked",
      device: { id: "device-second", name: "Second Browser", isRoot: false }
    });
    const devicesAfterRevoke = await request(baseUrl, "/admin/api/auth/devices", {
      cookies: rootCookies
    });
    assert.equal(devicesAfterRevoke.status, 200);
    assert.equal(
      devicesAfterRevoke.body.devices.find((device) => device.id === "device-second")?.status,
      "revoked"
    );
    const revokedDeviceSession = await request(baseUrl, "/admin/api/auth/session", {
      cookies: secondCookies
    });
    assert.equal(revokedDeviceSession.status, 401);

    const pendingAtRecovery = await request(baseUrl, "/admin/api/auth/device-requests", {
      method: "POST",
      body: {
        username,
        password,
        deviceID: "device-pending-at-recovery",
        displayName: "Pending At Recovery",
        publicKeyJWK: keyPair().jwk
      }
    });
    assert.equal(pendingAtRecovery.status, 202);

    const badPassword = await request(baseUrl, "/admin/api/auth/device-requests", {
      method: "POST",
      body: {
        username,
        password: "Wrong password value",
        deviceID: "device-wrong-password",
        displayName: "Wrong",
        publicKeyJWK: keyPair().jwk
      }
    });
    const unknownUser = await request(baseUrl, "/admin/api/auth/device-requests", {
      method: "POST",
      body: {
        username: "UnknownAdmin",
        password: "Wrong password value",
        deviceID: "device-unknown",
        displayName: "Unknown",
        publicKeyJWK: keyPair().jwk
      }
    });
    assert.deepEqual(
      { status: badPassword.status, body: badPassword.body },
      { status: unknownUser.status, body: unknownUser.body }
    );
    assert.equal((await adminUserState()).failed_login_count, 1);

    const invalidRecoveryCode = "AAAA-AAAA-AAAA-AAAA";
    const oldDeviceProbe = await request(baseUrl, "/admin/api/auth/recover", {
      method: "POST",
      body: {
        username,
        password,
        recoveryCode: invalidRecoveryCode,
        deviceID: "device-root",
        displayName: "Collision Probe",
        publicKeyJWK: keyPair().jwk
      }
    });
    const unusedDeviceProbe = await request(baseUrl, "/admin/api/auth/recover", {
      method: "POST",
      body: {
        username,
        password,
        recoveryCode: invalidRecoveryCode,
        deviceID: "device-unused",
        displayName: "Unused Probe",
        publicKeyJWK: keyPair().jwk
      }
    });
    assert.deepEqual(
      { status: oldDeviceProbe.status, body: oldDeviceProbe.body },
      { status: unusedDeviceProbe.status, body: unusedDeviceProbe.body }
    );

    const recoveryKey = keyPair();
    const recovered = await request(baseUrl, "/admin/api/auth/recover", {
      method: "POST",
      body: {
        username,
        password,
        recoveryCode,
        deviceID: "device-recovery-root",
        displayName: "Recovered Root",
        publicKeyJWK: recoveryKey.jwk
      }
    });
    assert.equal(recovered.status, 200);
    assert.deepEqual(recovered.body, {
      status: "recovered",
      device: { id: "device-recovery-root", name: "Recovered Root", isRoot: true }
    });
    assert.deepEqual(recovered.headers.getSetCookie(), []);

    const trustState = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM admin_sessions WHERE revoked_at IS NULL) AS active_sessions,
         (SELECT count(*)::int FROM admin_devices WHERE status = 'approved') AS approved_devices,
         (SELECT count(*)::int FROM admin_devices WHERE status = 'revoked') AS revoked_devices,
         (SELECT count(*)::int FROM admin_device_requests WHERE status = 'pending') AS pending_requests,
         (SELECT count(*)::int FROM admin_recovery_codes WHERE used_at IS NOT NULL) AS used_codes`
    );
    assert.deepEqual(trustState.rows[0], {
      active_sessions: 0,
      approved_devices: 1,
      revoked_devices: 2,
      pending_requests: 0,
      used_codes: 1
    });

    const recoveryReplay = await request(baseUrl, "/admin/api/auth/recover", {
      method: "POST",
      body: {
        username,
        password,
        recoveryCode,
        deviceID: "device-recovery-replay",
        displayName: "Replay Root",
        publicKeyJWK: keyPair().jwk
      }
    });
    assert.equal(recoveryReplay.status, 401);
    assert.equal(recoveryReplay.body.code, "admin_recovery_invalid");

    const recoveryChallenge = await loginChallenge(baseUrl, "device-recovery-root");
    const recoveryLogin = await login(
      baseUrl,
      recoveryChallenge,
      recoveryKey.privateKey,
      "device-recovery-root"
    );
    assert.equal(recoveryLogin.status, 200);
    const recoveryCookies = cookiesFrom(recoveryLogin.headers.getSetCookie());
    const logout = await request(baseUrl, "/admin/api/auth/logout", {
      method: "POST",
      cookies: recoveryCookies,
      csrf: recoveryCookies.get("zbt_admin_csrf")
    });
    assert.equal(logout.status, 200);
    assert.deepEqual(logout.body, { ok: true });
    assert.ok(logout.headers.getSetCookie().every((cookie) => cookie.includes("Max-Age=0")));
    const loggedOutSession = await request(baseUrl, "/admin/api/auth/session", { cookies: recoveryCookies });
    assert.equal(loggedOutSession.status, 401);

    await pool.query(
      `UPDATE admin_users
       SET status = 'active', failed_login_count = 9, locked_until = NULL
       WHERE username_normalized = 'rootadmin'`
    );
    const tenthFailure = await request(baseUrl, "/admin/api/auth/device-requests", {
      method: "POST",
      body: {
        username,
        password: "Wrong password value",
        deviceID: "device-lock-test",
        displayName: "Lock Test",
        publicKeyJWK: keyPair().jwk
      }
    });
    assert.equal(tenthFailure.status, 401);
    const locked = await pool.query(
      `SELECT status, failed_login_count,
              locked_until > now() + interval '14 minutes 58 seconds' AS locked_long_enough,
              locked_until <= now() + interval '15 minutes' AS locked_not_too_long
       FROM admin_users WHERE username_normalized = 'rootadmin'`
    );
    assert.deepEqual(locked.rows[0], {
      status: "locked",
      failed_login_count: 10,
      locked_long_enough: true,
      locked_not_too_long: true
    });

    const audits = await pool.query(
      `SELECT event_type, ip_hash, user_agent_summary, event_data::text AS event_data
       FROM admin_audit_events ORDER BY id`
    );
    assert.ok(audits.rows.some((row) => row.event_type === "admin.root_enrolled"));
    assert.ok(audits.rows.some((row) => row.event_type === "admin.device_approved"));
    assert.ok(audits.rows.some((row) => row.event_type === "admin.device_rejected"));
    assert.ok(audits.rows.some((row) => row.event_type === "admin.device_revoked"));
    assert.ok(audits.rows.some((row) => row.event_type === "admin.root_recovered"));
    assert.ok(audits.rows.some((row) => row.event_type === "admin.logout"));
    assert.ok(audits.rows.every((row) => !row.ip_hash || /^[a-f0-9]{64}$/.test(row.ip_hash)));
    const auditText = JSON.stringify(audits.rows);
    for (const secret of [password, bootstrapCode, recoveryCode, pending.body.shortCode, rootChallenge.nonce]) {
      assert.equal(auditText.includes(secret), false, secret);
    }
  });
});

async function seedAdminBootstrap() {
  const adminID = "admin-seeded-root";
  const passwordHash = await bcrypt.hash(password, 4);
  await pool.query(
    `INSERT INTO admin_users (id, username, username_normalized, password_hash)
     VALUES ($1, $2, 'rootadmin', $3)`,
    [adminID, username, passwordHash]
  );
  await pool.query(
    `INSERT INTO admin_bootstrap_codes (id, admin_user_id, code_hash, expires_at)
     VALUES ('bootstrap-test', $1, $2, now() + interval '10 minutes')`,
    [adminID, hashBootstrapCode(bootstrapCode, pepper)]
  );
  await pool.query(
    `INSERT INTO admin_recovery_codes (admin_user_id, code_hash)
     VALUES ($1, $2)`,
    [adminID, hashRecoveryCode(recoveryCode, pepper)]
  );
}

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return { privateKey, jwk: publicKey.export({ format: "jwk" }) };
}

async function loginChallenge(baseUrl, deviceID) {
  const response = await request(baseUrl, "/admin/api/auth/challenges", {
    method: "POST",
    body: { username, deviceID, purpose: "login" }
  });
  assert.equal(response.status, 201);
  return response.body;
}

function login(baseUrl, challenge, privateKey, deviceID) {
  return request(baseUrl, "/admin/api/auth/login", {
    method: "POST",
    body: {
      username,
      password,
      deviceID,
      challengeID: challenge.challengeID,
      nonce: challenge.nonce,
      signature: signChallenge(challenge, privateKey)
    }
  });
}

async function decisionChallenge(baseUrl, cookies, purpose, targetID) {
  const response = await request(baseUrl, "/admin/api/auth/challenges", {
    method: "POST",
    cookies,
    csrf: cookies.get("zbt_admin_csrf"),
    body: { purpose, targetID }
  });
  assert.equal(response.status, 201);
  return response.body;
}

function signedDecisionBody(challenge, privateKey, shortCode) {
  return {
    ...signedChallengeBody(challenge, privateKey),
    shortCode
  };
}

function signedChallengeBody(challenge, privateKey) {
  return {
    challengeID: challenge.challengeID,
    nonce: challenge.nonce,
    signature: signChallenge(challenge, privateKey)
  };
}

function signChallenge(challenge, privateKey) {
  const payload = canonicalChallengePayload({
    challengeId: challenge.challengeID,
    purpose: challenge.purpose,
    nonce: challenge.nonce,
    targetId: challenge.targetID
  });
  return sign("sha256", payload, { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
}

async function adminUserState() {
  const { rows } = await pool.query(
    "SELECT status, failed_login_count, locked_until FROM admin_users WHERE username_normalized = 'rootadmin'"
  );
  return rows[0];
}

function cookiesFrom(setCookies) {
  const cookies = new Map();
  for (const header of setCookies) {
    const [pair] = header.split(";");
    const separator = pair.indexOf("=");
    cookies.set(pair.slice(0, separator), decodeURIComponent(pair.slice(separator + 1)));
  }
  return cookies;
}

async function request(baseUrl, path, {
  method = "GET",
  body,
  cookies,
  csrf,
  origin
} = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookies?.size) {
    headers.cookie = [...cookies].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ");
  }
  if (csrf) headers["x-csrf-token"] = csrf;
  if (origin) headers.origin = origin;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : null
  };
}

function assertNoKeys(value, forbidden) {
  const serialized = JSON.stringify(value);
  for (const key of forbidden) assert.equal(serialized.includes(key), false, key);
}

async function withServer(callback) {
  const server = createApp({ adminWebEnabled: true }).listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

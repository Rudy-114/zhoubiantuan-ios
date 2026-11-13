import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { requireAdminCSRF, requireAdminSession } from "../../src/admin/adminMiddleware.js";
import { adminSessionCookieHeaders, parseRequestedCookies } from "../../src/admin/cookies.js";
import { withTransaction } from "../../src/db.js";
import { createAdminSession, revokeAdminSession } from "../../src/admin/sessionService.js";
import { closeDatabase, pool, resetDatabase } from "../helpers/database.js";

test.beforeEach(async () => {
  await resetDatabase();
  await seedAdminDevice();
});

test.after(closeDatabase);

test("creates hashed 30-minute idle and eight-hour absolute sessions with strict cookies", async () => {
  const session = await createSession();

  assert.match(session.sessionToken, /^[A-Za-z0-9_-]{43}$/);
  assert.match(session.csrfToken, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(session.sessionToken, session.csrfToken);

  const { rows } = await pool.query(
    `SELECT token_hash, csrf_hash,
            idle_expires_at > created_at + interval '29 minutes 59 seconds' AS idle_lower,
            idle_expires_at <= created_at + interval '30 minutes' AS idle_upper,
            absolute_expires_at > created_at + interval '7 hours 59 minutes 59 seconds' AS absolute_lower,
            absolute_expires_at <= created_at + interval '8 hours' AS absolute_upper
     FROM admin_sessions WHERE id = $1`,
    [session.sessionId]
  );
  assert.match(rows[0].token_hash, /^[a-f0-9]{64}$/);
  assert.match(rows[0].csrf_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(rows[0].token_hash, session.sessionToken);
  assert.notEqual(rows[0].csrf_hash, session.csrfToken);
  assert.equal(rows[0].idle_lower, true);
  assert.equal(rows[0].idle_upper, true);
  assert.equal(rows[0].absolute_lower, true);
  assert.equal(rows[0].absolute_upper, true);

  const cookies = adminSessionCookieHeaders({
    sessionToken: session.sessionToken,
    csrfToken: session.csrfToken,
    hostname: "admin.example.com",
    nodeEnv: "production",
    cookieSecure: false
  });
  assert.equal(cookies.length, 2);
  assert.match(cookies[0], /^zbt_admin_session=.+; Path=\/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=28800$/);
  assert.match(cookies[1], /^zbt_admin_csrf=.+; Path=\/admin; Secure; SameSite=Strict; Max-Age=28800$/);
});

test("accepts matching cookies and CSRF header, rejects a missing header, and touches the idle window", async () => {
  const session = await createSession();
  await pool.query(
    "UPDATE admin_sessions SET idle_expires_at = now() + interval '5 minutes' WHERE id = $1",
    [session.sessionId]
  );
  const req = requestFor(session);

  assert.deepEqual(await invoke(requireAdminSession, req), { allowed: true });
  assert.equal(req.adminSession.id, session.sessionId);
  assert.equal(req.adminUser.id, "admin-root");
  assert.equal(req.adminDevice.id, "device-root");
  assert.deepEqual(await invoke(requireAdminCSRF, req), { allowed: true });

  const touched = await pool.query(
    `SELECT idle_expires_at > now() + interval '29 minutes 58 seconds' AS extended,
            idle_expires_at <= absolute_expires_at AS capped
     FROM admin_sessions WHERE id = $1`,
    [session.sessionId]
  );
  assert.deepEqual(touched.rows[0], { extended: true, capped: true });

  const missingHeader = requestFor(session);
  delete missingHeader.headers["x-csrf-token"];
  assert.deepEqual(await invoke(requireAdminSession, missingHeader), { allowed: true });
  assert.deepEqual(await invoke(requireAdminCSRF, missingHeader), {
    allowed: false,
    status: 403,
    body: { error: "管理员请求验证失败", code: "admin_csrf_invalid" }
  });
});

test("rejects idle-expired, absolute-expired, revoked-device, and revoked sessions", async () => {
  const cases = [
    "idle",
    "absolute",
    "device",
    "session"
  ];
  for (const kind of cases) {
    await resetDatabase();
    await seedAdminDevice();
    const session = await createSession();
    if (kind === "idle") {
      await pool.query("UPDATE admin_sessions SET idle_expires_at = now() - interval '1 second' WHERE id = $1", [session.sessionId]);
    } else if (kind === "absolute") {
      await pool.query("UPDATE admin_sessions SET absolute_expires_at = now() - interval '1 second' WHERE id = $1", [session.sessionId]);
    } else if (kind === "device") {
      await pool.query("UPDATE admin_devices SET status = 'revoked', revoked_at = now() WHERE id = 'device-root'");
    } else {
      await withTransaction((client) => revokeAdminSession(client, { sessionId: session.sessionId }));
    }

    assert.deepEqual(await invoke(requireAdminSession, requestFor(session)), {
      allowed: false,
      status: 401,
      body: { error: "管理员登录已失效", code: "admin_auth_required" }
    });
  }
});

test("never touches idle expiry beyond the absolute session boundary", async () => {
  const session = await createSession();
  await pool.query(
    `UPDATE admin_sessions
     SET idle_expires_at = now() + interval '2 minutes',
         absolute_expires_at = now() + interval '10 minutes'
     WHERE id = $1`,
    [session.sessionId]
  );

  assert.deepEqual(await invoke(requireAdminSession, requestFor(session)), { allowed: true });
  const { rows } = await pool.query(
    "SELECT idle_expires_at = absolute_expires_at AS exactly_capped FROM admin_sessions WHERE id = $1",
    [session.sessionId]
  );
  assert.equal(rows[0].exactly_capped, true);
});

test("parses only requested cookies and fails closed on malformed or duplicate values", () => {
  assert.deepEqual(
    parseRequestedCookies("ignored=value; zbt_admin_session=abc%2D123; zbt_admin_csrf=csrf_value", [
      "zbt_admin_session",
      "zbt_admin_csrf"
    ]),
    { zbt_admin_session: "abc-123", zbt_admin_csrf: "csrf_value" }
  );
  assert.deepEqual(parseRequestedCookies("zbt_admin_session=%E0%A4%A", ["zbt_admin_session"]), {});
  assert.deepEqual(
    parseRequestedCookies("zbt_admin_session=first; zbt_admin_session=second", ["zbt_admin_session"]),
    {}
  );
  assert.deepEqual(
    parseRequestedCookies("zbt_admin_session=%E0%A4%A; zbt_admin_session=second", ["zbt_admin_session"]),
    {}
  );

  const local = adminSessionCookieHeaders({
    sessionToken: "session-token",
    csrfToken: "csrf-token",
    hostname: "127.0.0.1",
    nodeEnv: "development",
    cookieSecure: false
  });
  assert.ok(local.every((value) => !value.includes("; Secure")));
  const localIPv6 = adminSessionCookieHeaders({
    sessionToken: "session-token",
    csrfToken: "csrf-token",
    hostname: "::1",
    nodeEnv: "test",
    cookieSecure: false
  });
  assert.ok(localIPv6.every((value) => !value.includes("; Secure")));
  const nonLoopback = adminSessionCookieHeaders({
    sessionToken: "session-token",
    csrfToken: "csrf-token",
    hostname: "admin.example.com",
    nodeEnv: "development",
    cookieSecure: false
  });
  assert.ok(nonLoopback.every((value) => value.includes("; Secure")));
});

function createSession() {
  return withTransaction((client) => createAdminSession(client, {
    adminUserId: "admin-root",
    deviceId: "device-root"
  }));
}

async function seedAdminDevice() {
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  await pool.query(
    `INSERT INTO admin_users (id, username, username_normalized, password_hash)
     VALUES ('admin-root', 'Root', 'root', 'password-hash')`
  );
  await pool.query(
    `INSERT INTO admin_devices (
       id, admin_user_id, display_name, public_key_jwk, fingerprint_hash, is_root
     ) VALUES ('device-root', 'admin-root', 'Root device', $1::jsonb, 'fingerprint-root', true)`,
    [JSON.stringify(jwk)]
  );
}

function requestFor(session) {
  return {
    method: "POST",
    headers: {
      cookie: `zbt_admin_session=${session.sessionToken}; zbt_admin_csrf=${session.csrfToken}`,
      "x-csrf-token": session.csrfToken
    }
  };
}

function invoke(middleware, req) {
  return new Promise((resolve, reject) => {
    const res = {
      status(status) {
        return {
          json(body) {
            resolve({ allowed: false, status, body });
          }
        };
      }
    };
    const next = (error) => error ? reject(error) : resolve({ allowed: true });
    Promise.resolve(middleware(req, res, next)).catch(reject);
  });
}

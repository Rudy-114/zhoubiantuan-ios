import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { withTransaction } from "../../src/db.js";
import {
  consumeAdminChallenge,
  createAdminChallenge
} from "../../src/admin/challengeService.js";
import { closeDatabase, pool, resetDatabase } from "../helpers/database.js";

test.beforeEach(async () => {
  await resetDatabase();
  await seedAdminDevice();
});

test.after(closeDatabase);

test("creates a two-minute challenge while persisting only the nonce hash", async () => {
  const challenge = await withTransaction((client) => createAdminChallenge(client, {
    adminUserId: "admin-root",
    deviceId: "device-root",
    purpose: "approve_device",
    targetId: "request-pending"
  }));

  assert.match(challenge.challengeId, /^ach-/);
  assert.match(challenge.nonce, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(challenge.purpose, "approve_device");
  assert.equal(challenge.targetId, "request-pending");

  const { rows } = await pool.query(
    `SELECT id, admin_user_id, device_id, purpose, target_id, nonce_hash,
            expires_at > created_at + interval '119 seconds' AS ttl_lower_bound,
            expires_at <= created_at + interval '120 seconds' AS ttl_upper_bound,
            consumed_at
     FROM admin_auth_challenges WHERE id = $1`,
    [challenge.challengeId]
  );
  assert.deepEqual(rows[0], {
    id: challenge.challengeId,
    admin_user_id: "admin-root",
    device_id: "device-root",
    purpose: "approve_device",
    target_id: "request-pending",
    nonce_hash: rows[0].nonce_hash,
    ttl_lower_bound: true,
    ttl_upper_bound: true,
    consumed_at: null
  });
  assert.match(rows[0].nonce_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(rows[0].nonce_hash, challenge.nonce);
});

test("consumes an exact challenge once and rejects replay without changing the first result", async () => {
  const challenge = await createLoginChallenge();
  const input = {
    challengeId: challenge.challengeId,
    adminUserId: "admin-root",
    deviceId: "device-root",
    purpose: "login",
    targetId: "",
    nonce: challenge.nonce
  };

  const consumed = await withTransaction((client) => consumeAdminChallenge(client, input));
  assert.equal(consumed.id, challenge.challengeId);
  assert.equal(consumed.device_id, "device-root");
  assert.ok(consumed.consumed_at instanceof Date);

  await assert.rejects(
    withTransaction((client) => consumeAdminChallenge(client, input)),
    isInvalidChallenge
  );
  const state = await pool.query(
    "SELECT count(*)::int AS count FROM admin_auth_challenges WHERE id = $1 AND consumed_at IS NOT NULL",
    [challenge.challengeId]
  );
  assert.equal(state.rows[0].count, 1);
});

test("rejects mismatched, expired, revoked, and cross-admin challenges without consuming them", async () => {
  const mismatches = [
    { adminUserId: "admin-other" },
    { deviceId: "device-other" },
    { purpose: "approve_device" },
    { targetId: "unexpected-target" },
    { nonce: "wrong-nonce" }
  ];
  for (const override of mismatches) {
    const challenge = await createLoginChallenge();
    await assert.rejects(
      withTransaction((client) => consumeAdminChallenge(client, {
        challengeId: challenge.challengeId,
        adminUserId: "admin-root",
        deviceId: "device-root",
        purpose: "login",
        targetId: "",
        nonce: challenge.nonce,
        ...override
      })),
      isInvalidChallenge
    );
    assert.equal(await isConsumed(challenge.challengeId), false);
  }

  const expired = await createLoginChallenge();
  await pool.query(
    "UPDATE admin_auth_challenges SET expires_at = now() - interval '1 second' WHERE id = $1",
    [expired.challengeId]
  );
  await assert.rejects(
    withTransaction((client) => consumeAdminChallenge(client, loginInput(expired))),
    isInvalidChallenge
  );
  assert.equal(await isConsumed(expired.challengeId), false);

  const revoked = await createLoginChallenge();
  await pool.query("UPDATE admin_devices SET status = 'revoked' WHERE id = 'device-root'");
  await assert.rejects(
    withTransaction((client) => consumeAdminChallenge(client, loginInput(revoked))),
    isInvalidChallenge
  );
  assert.equal(await isConsumed(revoked.challengeId), false);
});

async function seedAdminDevice() {
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  await pool.query(
    `INSERT INTO admin_users (id, username, username_normalized, password_hash)
     VALUES
       ('admin-root', 'Root', 'root', 'password-hash'),
       ('admin-other', 'Other', 'other', 'password-hash')`
  );
  await pool.query(
    `INSERT INTO admin_devices (
       id, admin_user_id, display_name, public_key_jwk, fingerprint_hash, is_root
     ) VALUES
       ('device-root', 'admin-root', 'Root device', $1::jsonb, 'fingerprint-root', true),
       ('device-other', 'admin-other', 'Other device', $1::jsonb, 'fingerprint-other', true)`,
    [JSON.stringify(jwk)]
  );
}

function createLoginChallenge() {
  return withTransaction((client) => createAdminChallenge(client, {
    adminUserId: "admin-root",
    deviceId: "device-root",
    purpose: "login"
  }));
}

function loginInput(challenge) {
  return {
    challengeId: challenge.challengeId,
    adminUserId: "admin-root",
    deviceId: "device-root",
    purpose: "login",
    targetId: "",
    nonce: challenge.nonce
  };
}

async function isConsumed(challengeId) {
  const { rows } = await pool.query(
    "SELECT consumed_at IS NOT NULL AS consumed FROM admin_auth_challenges WHERE id = $1",
    [challengeId]
  );
  return rows[0].consumed;
}

function isInvalidChallenge(error) {
  return error?.status === 401 && error?.apiCode === "invalid_admin_challenge";
}

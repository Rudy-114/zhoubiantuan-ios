import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import bcrypt from "bcryptjs";
import { signToken } from "../../src/auth.js";
import { canonicalChallengePayload } from "../../src/admin/crypto.js";
import { hashBootstrapCode, hashRecoveryCode } from "../../src/admin/recoveryCodes.js";
import { hashAdminToken } from "../../src/admin/sessionService.js";
import { createApp } from "../../src/app.js";
import { createSafetyServerRuntime } from "../../src/server.js";
import { pool } from "../helpers/database.js";

process.env.ADMIN_RECOVERY_PEPPER ||= "synthetic-e2e-default-pepper-with-32-characters";

export const E2E_NOW = new Date("2026-07-16T08:00:00.000Z");
export const E2E_AI_CONFIG = Object.freeze({
  model: "qwen3.7-plus-2026-05-26",
  promptVersion: "safety-case-prompt-v2",
  policyVersion: "safety-policy-v2",
  monthlyBudgetCny: 10,
  inputCnyPerMillion: 2,
  outputCnyPerMillion: 6,
  maxCompletionTokens: 900
});

export const ACTORS = Object.freeze({
  owner: "e2e-owner",
  reporterA: "e2e-reporter-a",
  reporterB: "e2e-reporter-b",
  unrelated: "e2e-unrelated",
  messageSender: "e2e-message-sender"
});

export const TARGETS = Object.freeze({
  collection: "e2e-collection",
  cleanPost: "e2e-post-clean",
  independentlyHiddenPost: "e2e-post-hidden",
  comment: "e2e-comment",
  thread: "e2e-thread",
  reportedMessage: "e2e-message-4"
});

const ADMIN_SESSION_TOKEN = "s".repeat(43);
const ADMIN_CSRF_TOKEN = "c".repeat(43);

export async function seedLifecycleActors() {
  await pool.query(
    `INSERT INTO users (id, email, nickname)
     VALUES
       ($1, 'owner@e2e.test', 'Lifecycle owner'),
       ($2, 'reporter-a@e2e.test', 'Reporter A'),
       ($3, 'reporter-b@e2e.test', 'Reporter B'),
       ($4, 'unrelated@e2e.test', 'Unrelated user'),
       ($5, 'message-sender@e2e.test', 'Message sender')`,
    [ACTORS.owner, ACTORS.reporterA, ACTORS.reporterB, ACTORS.unrelated, ACTORS.messageSender]
  );
  await pool.query(
    `INSERT INTO group_collections (
       id, owner_id, name, contact_wechat, group_info, deadline
     ) VALUES ($1, $2, 'Lifecycle collection', 'old-contact', 'Original group info', $3)`,
    [TARGETS.collection, ACTORS.owner, new Date("2026-08-16T08:00:00.000Z")]
  );
  await pool.query(
    `INSERT INTO posts (id, author_id, collection_id, title, description, deadline)
     VALUES
       ($1, $3, $4, 'Clean child post', 'Original clean content', $5),
       ($2, $3, $4, 'Independently hidden child', 'Separate safety issue', $5)`,
    [
      TARGETS.cleanPost,
      TARGETS.independentlyHiddenPost,
      ACTORS.owner,
      TARGETS.collection,
      new Date("2026-08-16T08:00:00.000Z")
    ]
  );
  await pool.query(
    `INSERT INTO comments (id, post_id, author_id, body)
     VALUES ($1, $2, $3, 'Interaction that must survive restoration')`,
    [TARGETS.comment, TARGETS.cleanPost, ACTORS.unrelated]
  );
  await pool.query(
    "INSERT INTO post_likes (user_id, post_id) VALUES ($1, $2)",
    [ACTORS.reporterA, TARGETS.cleanPost]
  );
  await pool.query(
    "INSERT INTO post_favorites (user_id, post_id) VALUES ($1, $2)",
    [ACTORS.reporterA, TARGETS.cleanPost]
  );
  await pool.query(
    `INSERT INTO message_threads (id, buyer_user_id, publisher_user_id)
     VALUES ($1, $2, $3)`,
    [TARGETS.thread, ACTORS.reporterA, ACTORS.messageSender]
  );
  for (let index = 1; index <= 7; index += 1) {
    await pool.query(
      `INSERT INTO direct_messages (id, thread_id, sender_id, body, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        `e2e-message-${index}`,
        TARGETS.thread,
        index % 2 === 0 ? ACTORS.messageSender : ACTORS.reporterA,
        `Immutable message context ${index}`,
        new Date(E2E_NOW.getTime() - (8 - index) * 60_000)
      ]
    );
  }
  return seedReviewAdminSession();
}

export async function seedReviewAdminSession() {
  await pool.query(
    `INSERT INTO admin_users (id, username, username_normalized, password_hash)
     VALUES ('e2e-admin', 'E2EAdmin', 'e2eadmin', 'unused-e2e-hash')`
  );
  await pool.query(
    `INSERT INTO admin_devices (
       id, admin_user_id, display_name, public_key_jwk, fingerprint_hash, is_root
     ) VALUES (
       'e2e-admin-root', 'e2e-admin', 'E2E root device', '{"kty":"EC"}'::jsonb,
       'e2e-review-fingerprint', true
     )`
  );
  await pool.query(
    `INSERT INTO admin_sessions (
       id, admin_user_id, device_id, token_hash, csrf_hash,
       idle_expires_at, absolute_expires_at
     ) VALUES (
       'e2e-admin-session', 'e2e-admin', 'e2e-admin-root', $1, $2,
       now() + interval '30 minutes', now() + interval '8 hours'
     )`,
    [hashAdminToken(ADMIN_SESSION_TOKEN), hashAdminToken(ADMIN_CSRF_TOKEN)]
  );
  return {
    cookies: new Map([
      ["zbt_admin_session", ADMIN_SESSION_TOKEN],
      ["zbt_admin_csrf", ADMIN_CSRF_TOKEN]
    ]),
    csrf: ADMIN_CSRF_TOKEN
  };
}

export async function withE2EServer(callback) {
  const server = createApp({ adminWebEnabled: true }).listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const address = server.address();
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

export async function withE2ESafetyRuntime(callback, { analyzeCase } = {}) {
  if (typeof analyzeCase !== "function") throw new TypeError("analyzeCase must be a function");
  const runtime = createSafetyServerRuntime({
    app: createApp({ adminWebEnabled: true }),
    runtimeConfig: {
      port: 0,
      safety: { enabled: true, aiMode: "shadow", autoActionsEnabled: false },
      safetyAi: E2E_AI_CONFIG
    },
    attachRealtime: () => ({ close: async () => {} }),
    startRateLimitEventPruner: () => null,
    startSyncEventPruner: () => null,
    startSafetyMaintenanceScheduler: () => ({ ready: Promise.resolve(), stop: async () => {} }),
    analyzeSafetyCase: analyzeCase,
    pool: { end: async () => {} },
    clearInterval() {},
    logger: { info() {}, error() {} }
  });
  await runtime.start({ port: 0, host: "127.0.0.1" });
  try {
    const address = runtime.server.address();
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await runtime.shutdown("e2e_complete");
  }
}

export async function waitFor(predicate, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("timed out waiting for E2E state");
}

export async function requestJSON(baseUrl, path, {
  method = "GET",
  body,
  userID,
  cookies,
  csrf
} = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (userID) {
    headers.authorization = `Bearer ${signToken({ id: userID, email: `${userID}@e2e.test` })}`;
  }
  if (cookies?.size) {
    headers.cookie = [...cookies]
      .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
      .join("; ");
  }
  if (csrf) headers["x-csrf-token"] = csrf;
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

export async function adminCase(baseUrl, caseID, admin) {
  const response = await requestJSON(baseUrl, `/admin/api/cases/${caseID}`, {
    cookies: admin.cookies
  });
  assert.equal(response.status, 200);
  return response.body.case;
}

export function adminDecision(baseUrl, caseID, decision, reason, expectedVersion, admin) {
  return requestJSON(baseUrl, `/admin/api/cases/${caseID}/decision`, {
    method: "POST",
    cookies: admin.cookies,
    csrf: admin.csrf,
    body: { decision, reason, expectedVersion }
  });
}

export async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function passModeration() {
  return {
    outcome: "pass",
    status: "active",
    riskLevel: "none",
    source: "mockAliyun",
    reason: "Synthetic Aliyun hard-safety pass",
    rawSummary: { labels: [] }
  };
}

export function qwenResult(overrides = {}) {
  return {
    category: "other",
    subjectType: "post",
    impactScope: "post",
    riskLevel: "low",
    confidence: 0.7,
    evidence: [{ source: "source_snapshot", fact: "Synthetic bounded evidence." }],
    recommendedAction: "manual_review",
    requiresHuman: true,
    summary: "Synthetic Qwen result for the E2E harness.",
    ...overrides
  };
}

export function qwenProvider(result) {
  return {
    async analyze() {
      return {
        result,
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        requestId: "e2e-mock-qwen",
        rawContent: JSON.stringify(result)
      };
    }
  };
}

export async function seedAdminBootstrap({
  username,
  password,
  bootstrapCode,
  recoveryCode,
  pepper
}) {
  const passwordHash = await bcrypt.hash(password, 4);
  await pool.query(
    `INSERT INTO admin_users (id, username, username_normalized, password_hash)
     VALUES ('e2e-auth-admin', $1, lower($1), $2)`,
    [username, passwordHash]
  );
  await pool.query(
    `INSERT INTO admin_bootstrap_codes (id, admin_user_id, code_hash, expires_at)
     VALUES ('e2e-bootstrap', 'e2e-auth-admin', $1, now() + interval '10 minutes')`,
    [hashBootstrapCode(bootstrapCode, pepper)]
  );
  await pool.query(
    `INSERT INTO admin_recovery_codes (admin_user_id, code_hash)
     VALUES ('e2e-auth-admin', $1)`,
    [hashRecoveryCode(recoveryCode, pepper)]
  );
}

export function deviceKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return { privateKey, jwk: publicKey.export({ format: "jwk" }) };
}

export function signedChallengeBody(challenge, privateKey, extra = {}) {
  const payload = canonicalChallengePayload({
    challengeId: challenge.challengeID,
    purpose: challenge.purpose,
    nonce: challenge.nonce,
    targetId: challenge.targetID
  });
  return {
    challengeID: challenge.challengeID,
    nonce: challenge.nonce,
    signature: sign("sha256", payload, {
      key: privateKey,
      dsaEncoding: "ieee-p1363"
    }).toString("base64url"),
    ...extra
  };
}

export function cookiesFrom(headers) {
  const cookies = new Map();
  for (const header of headers.getSetCookie()) {
    const [pair] = header.split(";");
    const separator = pair.indexOf("=");
    cookies.set(pair.slice(0, separator), decodeURIComponent(pair.slice(separator + 1)));
  }
  return cookies;
}

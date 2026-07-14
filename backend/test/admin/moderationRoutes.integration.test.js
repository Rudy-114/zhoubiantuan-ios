import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../../src/app.js";
import { signToken } from "../../src/auth.js";
import { hashAdminToken } from "../../src/admin/sessionService.js";
import { closeDatabase, pool, resetDatabase } from "../helpers/database.js";

const sessionToken = "C".repeat(43);
const csrfToken = "D".repeat(43);
const adminCookies = new Map([
  ["zbt_admin_session", sessionToken],
  ["zbt_admin_csrf", csrfToken]
]);

process.env.ADMIN_RECOVERY_PEPPER = "test-admin-moderation-pepper-with-32-characters";

test.beforeEach(async () => {
  await resetDatabase();
  await seedModerationFixture();
});

test.after(closeDatabase);

test("moves pre-publication moderation behind admin session and audits decisions", async () => {
  await withServer(async (baseUrl) => {
    const unauthenticated = await request(baseUrl, "/admin/api/moderation-reviews");
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.body.code, "admin_auth_required");

    const appJWT = signToken({ id: "u-moderation-owner", email: "owner@example.test" });
    const consumerToken = await request(baseUrl, "/admin/api/moderation-reviews", {
      bearer: appJWT
    });
    assert.equal(consumerToken.status, 401);

    const list = await request(baseUrl, "/admin/api/moderation-reviews?status=review", {
      cookies: adminCookies
    });
    assert.equal(list.status, 200);
    assert.equal(list.body.reviews.length, 1);
    assert.equal(list.body.reviews[0].id, "moderation-admin-review");
    assert.equal(list.body.reviews[0].textSnapshot, "合成待审核文本");

    const missingCSRF = await request(
      baseUrl,
      "/admin/api/moderation-reviews/moderation-admin-review/decision",
      {
        method: "POST",
        cookies: adminCookies,
        body: { decision: "approve", reason: "符合发布规则" }
      }
    );
    assert.equal(missingCSRF.status, 403);
    assert.equal(missingCSRF.body.code, "admin_csrf_invalid");

    const approved = await request(
      baseUrl,
      "/admin/api/moderation-reviews/moderation-admin-review/decision",
      {
        method: "POST",
        cookies: adminCookies,
        csrf: csrfToken,
        body: { decision: "approve", reason: "符合发布规则" }
      }
    );
    assert.equal(approved.status, 200);
    assert.equal(approved.body.review.status, "active");
    assert.equal(approved.body.review.decision, "approve");
    const state = await pool.query(
      `SELECT post.status, review.handled_by
       FROM posts post
       JOIN moderation_reviews review ON review.target_id = post.id
       WHERE review.id = 'moderation-admin-review'`
    );
    assert.deepEqual(state.rows[0], { status: "active", handled_by: null });
    const audit = await pool.query(
      `SELECT admin_user_id, device_id, event_type, subject_type, subject_id, event_data
       FROM admin_audit_events
       WHERE event_type = 'moderation.review_decided'`
    );
    assert.deepEqual(audit.rows[0], {
      admin_user_id: "admin-moderation-reviewer",
      device_id: "device-moderation-reviewer",
      event_type: "moderation.review_decided",
      subject_type: "moderation_review",
      subject_id: "moderation-admin-review",
      event_data: { decision: "approve", reason: "符合发布规则" }
    });

    const legacyConsumerRoute = await request(baseUrl, "/api/moderation/reviews", {
      bearer: appJWT
    });
    assert.equal(legacyConsumerRoute.status, 403);
  });
});

async function seedModerationFixture() {
  await pool.query(
    `INSERT INTO admin_users (id, username, username_normalized, password_hash)
     VALUES ('admin-moderation-reviewer', 'ModerationReviewer', 'moderationreviewer', 'unused-test-hash');
     INSERT INTO admin_devices (
       id, admin_user_id, display_name, public_key_jwk, fingerprint_hash, is_root
     ) VALUES (
       'device-moderation-reviewer', 'admin-moderation-reviewer', 'Moderation Browser',
       '{"kty":"EC"}'::jsonb, 'moderation-fixture-fingerprint', true
     );
     INSERT INTO users (id, email, nickname)
     VALUES ('u-moderation-owner', 'owner@example.test', '内容发布者');
     INSERT INTO posts (id, author_id, title, deadline, description, status)
     VALUES (
       'post-moderation-admin', 'u-moderation-owner', '待审核帖子',
       now() + interval '30 days', '合成帖子说明', 'review'
     );
     INSERT INTO moderation_reviews (
       id, target_type, target_id, owner_id, status, source, risk_level,
       reason, text_snapshot, snapshot
     ) VALUES (
       'moderation-admin-review', 'post', 'post-moderation-admin',
       'u-moderation-owner', 'review', 'textKeyword', 'medium',
       '需要人工确认', '合成待审核文本', '{"title":"待审核帖子"}'::jsonb
     )`
  );
  await pool.query(
    `INSERT INTO admin_sessions (
       id, admin_user_id, device_id, token_hash, csrf_hash,
       idle_expires_at, absolute_expires_at
     ) VALUES (
       'session-moderation-reviewer', 'admin-moderation-reviewer',
       'device-moderation-reviewer', $1, $2,
       now() + interval '30 minutes', now() + interval '8 hours'
     )`,
    [hashAdminToken(sessionToken), hashAdminToken(csrfToken)]
  );
}

async function request(baseUrl, path, {
  method = "GET",
  body,
  cookies,
  csrf,
  bearer
} = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookies?.size) {
    headers.cookie = [...cookies]
      .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
      .join("; ");
  }
  if (csrf) headers["x-csrf-token"] = csrf;
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null
  };
}

async function withServer(callback) {
  const server = createApp().listen(0, "127.0.0.1");
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

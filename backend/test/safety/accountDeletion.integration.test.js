import assert from "node:assert/strict";
import test from "node:test";
import { signToken } from "../../src/auth.js";
import { createApp } from "../../src/app.js";
import { closeDatabase, pool, resetDatabase } from "../helpers/database.js";

test.beforeEach(resetDatabase);
test.after(closeDatabase);

test("account deletion preserves object keys held by active safety evidence", async () => {
  const retainedKey = "post/owner/2026-07-16/retained.jpg";
  const moderationKey = "post/owner/2026-07-16/moderation.jpg";
  const disposablePostKey = "post/owner/2026-07-16/disposable.jpg";
  const disposableAvatarKey = "avatar/owner/2026-07-16/avatar.jpg";
  await pool.query(
    `INSERT INTO users (id, email, nickname, avatar_object_key)
     VALUES
       ('owner', 'owner@example.test', 'Owner', $1),
       ('reporter', 'reporter@example.test', 'Reporter', NULL)`,
    [disposableAvatarKey]
  );
  await pool.query(
    `INSERT INTO posts (id, author_id, title, image_object_keys, deadline)
     VALUES ('reported-post', 'owner', 'Reported post', $1, now() + interval '1 day')`,
    [[retainedKey, moderationKey, disposablePostKey]]
  );
  await pool.query(
    `INSERT INTO moderation_reviews (
       id, target_type, target_id, owner_id, status, image_object_keys
     ) VALUES (
       'retained-moderation', 'post', 'reported-post', 'owner', 'review', ARRAY[$1]::text[]
     )`,
    [moderationKey]
  );
  await pool.query(
    `INSERT INTO safety_cases (
       id, subject_type, subject_id, category, impact_scope, status
     ) VALUES (
       'retained-case', 'post', 'reported-post', 'other', 'post', 'manual_review'
     )`
  );
  await pool.query(
    `INSERT INTO reports (
       id, target_type, target_id, reporter_id, client_request_id, case_id,
       source_type, source_id, subject_type, subject_id, reason_code
     ) VALUES (
       'retained-report', 'post', 'reported-post', 'reporter', 'retained-request',
       'retained-case', 'post', 'reported-post', 'post', 'reported-post', 'other'
     )`
  );
  await pool.query(
    `INSERT INTO safety_evidence (
       id, case_id, report_id, client_request_id, evidence_type, object_keys
     ) VALUES (
       'retained-evidence', 'retained-case', 'retained-report', 'retained-request',
       'source_snapshot', ARRAY[$1]::text[]
     )`,
    [retainedKey]
  );

  const deleteCalls = [];
  const app = createApp({
    routerOptions: {
      deleteObjects: async (objectKeys) => { deleteCalls.push(objectKeys); }
    }
  });
  const response = await withServer(app, (baseUrl) => fetch(`${baseUrl}/api/me`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${signToken({ id: "owner", email: "owner@example.test" })}` }
  }));

  assert.equal(response.status, 204);
  assert.deepEqual(deleteCalls, [[disposableAvatarKey, disposablePostKey]]);
  assert.deepEqual((await pool.query(
    "SELECT object_keys, redacted_at FROM safety_evidence WHERE id = 'retained-evidence'"
  )).rows, [{ object_keys: [retainedKey], redacted_at: null }]);
  assert.equal((await pool.query(
    "SELECT status FROM posts WHERE id = 'reported-post'"
  )).rows[0].status, "deleted");
});

async function withServer(app, callback) {
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise((resolve, reject) => {
      if (server.listening) return resolve();
      server.once("listening", resolve);
      server.once("error", reject);
    });
    return await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

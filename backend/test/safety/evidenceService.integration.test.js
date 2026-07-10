import assert from "node:assert/strict";
import test from "node:test";
import { signToken } from "../../src/auth.js";
import { assertOwnedObjectKeys } from "../../src/moderation/index.js";
import { createUploadTarget } from "../../src/oss.js";
import { createApp } from "../../src/app.js";
import { captureSourceEvidence } from "../../src/safety/evidenceService.js";
import { closeDatabase, pool, resetDatabase } from "../helpers/database.js";

test.beforeEach(async () => {
  await resetDatabase();
  await seedEvidenceSources();
});

test.after(async () => {
  await closeDatabase();
});

test("rejects a pool before querying evidence", async () => {
  const poolLike = {
    connect() {},
    query() {
      throw new Error("evidence query should not run");
    }
  };

  for (const candidate of [pool, poolLike]) {
    await assert.rejects(
      captureSourceEvidence(candidate, {
        reporterId: "u-reporter",
        sourceType: "post",
        sourceId: "p-evidence"
      }),
      (error) => {
        assert.equal(error.name, "TypeError");
        assert.match(error.message, /transaction-scoped.*PoolClient/i);
        return true;
      }
    );
  }
});

test("rejects an acquired client without BEGIN before evidence queries", async () => {
  const client = await pool.connect();
  const queries = [];
  let released = false;
  const recordingClient = {
    query: async (...args) => {
      queries.push(String(args[0]));
      return client.query(...args);
    },
    release: () => {
      if (!released) {
        released = true;
        client.release();
      }
    }
  };

  try {
    await assert.rejects(
      captureSourceEvidence(recordingClient, {
        reporterId: "u-reporter",
        sourceType: "post",
        sourceId: "p-evidence"
      }),
      (error) => {
        assert.equal(error.name, "TypeError");
        assert.match(error.message, /active transaction/i);
        return true;
      }
    );
    assert.deepEqual(queries, ["SAVEPOINT capture_source_evidence_probe"]);
  } finally {
    recordingClient.release();
  }
});

test("locks the DM target and reads context through the same transaction client", async () => {
  const client = await pool.connect();
  const queries = [];
  let released = false;
  const recordingClient = {
    query: async (...args) => {
      queries.push(String(args[0]));
      return client.query(...args);
    },
    release: () => {
      if (!released) {
        released = true;
        client.release();
      }
    }
  };

  try {
    await recordingClient.query("BEGIN");
    await captureSourceEvidence(recordingClient, {
      reporterId: "u-reporter",
      sourceType: "direct_message",
      sourceId: "m-target"
    });
    await recordingClient.query("COMMIT");
  } catch (error) {
    await recordingClient.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    recordingClient.release();
  }

  assert.equal(queries[0], "BEGIN");
  assert.equal(queries[1], "SAVEPOINT capture_source_evidence_probe");
  assert.equal(queries[2], "RELEASE SAVEPOINT capture_source_evidence_probe");
  assert.match(queries[3], /FOR UPDATE OF dm, mt/);
  assert.match(queries[4], /WITH ordered AS/);
  assert.equal(queries[5], "COMMIT");
});

test("captures a bounded direct-message snapshot from server rows only", async () => {
  const evidence = await captureEvidence({
    reporterId: "u-reporter",
    sourceType: "direct_message",
    sourceId: "m-target"
  });

  assert.deepEqual(Object.keys(evidence), [
    "evidenceType",
    "textSnapshot",
    "structuredSnapshot",
    "objectKeys",
    "ownerId",
    "contextStartMessageId",
    "contextEndMessageId",
    "retentionDeleteAt"
  ]);
  assert.equal(evidence.evidenceType, "direct_message");
  assert.equal(evidence.textSnapshot, "target body");
  assert.equal(evidence.ownerId, "u-sender");
  assert.equal(evidence.contextStartMessageId, "m-before-3");
  assert.equal(evidence.contextEndMessageId, "m-after-3");
  assert.equal(evidence.retentionDeleteAt, null);
  assert.deepEqual(evidence.objectKeys, [
    "message/u-reporter/2026-07-10/before-3.jpg",
    "message/u-sender/2026-07-10/target.png",
    "message/u-sender/2026-07-10/after-1.webp"
  ]);

  const { messages } = evidence.structuredSnapshot;
  assert.equal(messages.length, 7);
  assert.deepEqual(messages.map((message) => message.id), [
    "m-before-3",
    "m-before-2",
    "m-before-1",
    "m-target",
    "m-after-1",
    "m-after-2",
    "m-after-3"
  ]);
  assert.equal(messages[3].id, "m-target");
  assert.equal(messages[3].isTarget, true);
  assert.deepEqual(messages.map((message) => message.senderId), [
    "u-reporter",
    "u-sender",
    "u-reporter",
    "u-sender",
    "u-sender",
    "u-reporter",
    "u-sender"
  ]);
  assert.deepEqual(messages.map((message) => message.createdAt), [
    "2026-07-10T12:00:00.000Z",
    "2026-07-10T12:01:00.000Z",
    "2026-07-10T12:02:00.000Z",
    "2026-07-10T12:03:00.000Z",
    "2026-07-10T12:04:00.000Z",
    "2026-07-10T12:05:00.000Z",
    "2026-07-10T12:06:00.000Z"
  ]);
  assert.ok(messages.every((message) => typeof message.isTarget === "boolean"));
  assert.ok(messages.every((message) => !Object.hasOwn(message, "email")));
  assert.deepEqual(JSON.parse(JSON.stringify(evidence)), evidence);
  assertNoAccountPii(evidence);
});

test("captures minimal authoritative snapshots for public source types", async () => {
  const post = await captureEvidence({
    reporterId: "u-reporter",
    sourceType: "post",
    sourceId: "p-evidence"
  });
  assert.equal(post.evidenceType, "post");
  assert.equal(post.ownerId, "u-owner");
  assert.equal(post.textSnapshot, "Evidence post\nPost description\n12\n3\n8");
  assert.deepEqual(post.objectKeys, [
    "post/u-owner/2026-07-10/post-1.jpg",
    "post/u-owner/2026-07-10/post-2.png"
  ]);
  assert.deepEqual(post.structuredSnapshot, {
    id: "p-evidence",
    title: "Evidence post",
    description: "Post description",
    price: "12",
    deposit: "3",
    pingguAveragePrice: "8",
    pingguNote: "Price note",
    imageObjectKeys: [
      "post/u-owner/2026-07-10/post-1.jpg",
      "post/u-owner/2026-07-10/post-2.png"
    ],
    authorId: "u-owner",
    collectionId: "col-evidence",
    wechat: "post-wechat",
    qq: "post-qq",
    groupNumber: "post-group",
    groupInfo: "post group info",
    deadline: "2026-07-15T00:00:00.000Z",
    collectionDefaultNote: "Collection default note",
    createdAt: "2026-07-10T10:00:00.000Z",
    updatedAt: "2026-07-10T11:00:00.000Z",
    status: "active",
    safetyStatus: "active"
  });

  const comment = await captureEvidence({
    reporterId: "u-reporter",
    sourceType: "comment",
    sourceId: "c-evidence"
  });
  assert.equal(comment.evidenceType, "comment");
  assert.equal(comment.textSnapshot, "Comment body");
  assert.equal(comment.ownerId, "u-commenter");
  assert.deepEqual(comment.objectKeys, []);
  assert.deepEqual(comment.structuredSnapshot, {
    id: "c-evidence",
    body: "Comment body",
    authorId: "u-commenter",
    postId: "p-evidence",
    replyToId: null,
    createdAt: "2026-07-10T12:10:00.000Z",
    status: "active",
    safetyStatus: "active"
  });

  const user = await captureEvidence({
    reporterId: "u-reporter",
    sourceType: "user",
    sourceId: "u-owner"
  });
  assert.equal(user.evidenceType, "user");
  assert.equal(user.textSnapshot, "Owner\nOwner bio");
  assert.equal(user.ownerId, "u-owner");
  assert.deepEqual(user.objectKeys, [
    "avatar/u-owner/2026-07-10/avatar.jpg",
    "background/u-owner/2026-07-10/background.png"
  ]);
  assert.deepEqual(user.structuredSnapshot, {
    id: "u-owner",
    nickname: "Owner",
    bio: "Owner bio",
    avatarObjectKey: "avatar/u-owner/2026-07-10/avatar.jpg",
    backgroundObjectKey: "background/u-owner/2026-07-10/background.png",
    createdAt: "2026-07-01T00:00:00.000Z",
    isRestricted: true,
    canShowContact: false,
    status: "active"
  });

  const collection = await captureEvidence({
    reporterId: "u-reporter",
    sourceType: "collection",
    sourceId: "col-evidence"
  });
  assert.equal(collection.evidenceType, "collection");
  assert.equal(collection.textSnapshot, "Evidence collection\ncollection group info\nCollection default note");
  assert.equal(collection.ownerId, "u-owner");
  assert.deepEqual(collection.objectKeys, []);
  assert.deepEqual(collection.structuredSnapshot, {
    id: "col-evidence",
    name: "Evidence collection",
    contactWechat: "collection-wechat",
    contactQQ: "collection-qq",
    contactGroupNumber: "collection-group",
    groupInfo: "collection group info",
    deadline: "2026-07-15T00:00:00.000Z",
    defaultNote: "Collection default note",
    ownerId: "u-owner",
    status: "active",
    safetyStatus: "active",
    contactVisibility: "active",
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z"
  });

  for (const evidence of [post, comment, user, collection]) {
    assert.equal(evidence.contextStartMessageId, null);
    assert.equal(evidence.contextEndMessageId, null);
    assert.equal(evidence.retentionDeleteAt, null);
    assertNoAccountPii(evidence);
  }
});

test("rejects direct-message capture without revealing target existence", async () => {
  await pool.query(
    `INSERT INTO direct_messages (id, thread_id, sender_id, body, created_at)
     VALUES
       ('m-third-party', 't-evidence', 'u-outsider', 'third party body', '2026-07-10T12:07:00.000Z'),
       ('m-deleted-for-reporter', 't-evidence', 'u-sender', 'deleted body', '2026-07-10T12:08:00.000Z')`
  );
  await pool.query(
    "UPDATE direct_messages SET deleted_for_user_ids = ARRAY['u-reporter']::text[] WHERE id = 'm-deleted-for-reporter'"
  );

  for (const input of [
    { reporterId: "u-outsider", sourceId: "m-target" },
    { reporterId: "u-reporter", sourceId: "m-before-3" },
    { reporterId: "u-reporter", sourceId: "m-third-party" },
    { reporterId: "u-reporter", sourceId: "m-deleted-for-reporter" },
    { reporterId: "u-reporter", sourceId: "m-does-not-exist" }
  ]) {
    await assert.rejects(
      captureEvidence({ sourceType: "direct_message", ...input }),
      (error) => {
        assert.equal(error.status, 400);
        assert.equal(error.message, "举报目标不存在或不可见");
        return true;
      }
    );
  }
});

test("rejects nonexistent sources with one controlled response", async () => {
  for (const sourceType of ["post", "comment", "user", "collection", "direct_message"]) {
    await assert.rejects(
      captureEvidence({
        reporterId: "u-reporter",
        sourceType,
        sourceId: `missing-${sourceType}`
      }),
      (error) => {
        assert.equal(error.status, 400);
        assert.equal(error.message, "举报目标不存在或不可见");
        return true;
      }
    );
  }
});

test("keeps report uploads private while accepting owned report targets", async () => {
  const target = createUploadTarget({
    userId: "u-reporter",
    kind: "report",
    filename: "evidence.png",
    contentType: "image/png"
  });
  assert.match(target.objectKey, /^report\/u-reporter\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]+\.png$/);
  assert.match(target.uploadUrl, /^https:\/\//);
  assert.equal(target.expiresIn, 900);
  assert.equal(Object.hasOwn(target, "readUrl"), false);
  assert.deepEqual(assertOwnedObjectKeys("u-reporter", [target.objectKey], ["report"]), [target.objectKey]);
  assert.throws(
    () => assertOwnedObjectKeys("u-reporter", [target.objectKey.replace("u-reporter", "u-other")], ["report"]),
    /图片上传归属无效/
  );
  assert.throws(
    () => assertOwnedObjectKeys("u-reporter", ["report/u-reporter/2026-07-10/../other.png"], ["report"]),
    /图片上传归属无效/
  );

  const server = createApp().listen(0);
  try {
    await onceListening(server);
    const { port } = server.address();
    const reportAsset = await fetch(`http://127.0.0.1:${port}/api/assets/${target.objectKey}`);
    assert.equal(reportAsset.status, 404);

    const token = signToken({ id: "u-reporter", email: "reporter@example.test" });
    const presign = await fetch(`http://127.0.0.1:${port}/api/uploads/presign`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ kind: "report", filename: "route-proof.webp", contentType: "image/webp" })
    });
    assert.equal(presign.status, 200);
    const body = await presign.json();
    assert.match(body.objectKey, /^report\/u-reporter\//);
    assert.equal(Object.hasOwn(body, "readUrl"), false);

    const rejectedType = await fetch(`http://127.0.0.1:${port}/api/uploads/presign`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ kind: "report", filename: "route-proof.gif", contentType: "image/gif" })
    });
    assert.equal(rejectedType.status, 400);
    assert.match((await rejectedType.json()).error, /JPEG \/ PNG \/ WebP/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

function onceListening(server) {
  if (server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
}

function captureEvidence(input) {
  return withEvidenceTransaction((client) => captureSourceEvidence(client, input));
}

async function withEvidenceTransaction(callback) {
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    committed = true;
    return result;
  } catch (error) {
    if (!committed) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function assertNoAccountPii(evidence) {
  const serialized = JSON.stringify(evidence);
  for (const value of [
    "owner@example.test",
    "reporter@example.test",
    "sender@example.test",
    "13800138000",
    "2000-01-01",
    "identity-owner"
  ]) {
    assert.equal(serialized.includes(value), false, `evidence must exclude ${value}`);
  }
}

async function seedEvidenceSources() {
  await pool.query(
    `INSERT INTO users (
      id, email, nickname, bio, phone_number, birthday, avatar_object_key, background_object_key,
      is_restricted, can_show_contact, status, created_at
    ) VALUES
      ('u-owner', 'owner@example.test', 'Owner', 'Owner bio', '13800138000', '2000-01-01',
       'avatar/u-owner/2026-07-10/avatar.jpg', 'background/u-owner/2026-07-10/background.png', true, false, 'active', '2026-07-01T00:00:00.000Z'),
      ('u-reporter', 'reporter@example.test', 'Reporter', 'Reporter bio', '', '选择生日', NULL, NULL, false, true, 'active', '2026-07-01T00:00:00.000Z'),
      ('u-sender', 'sender@example.test', 'Sender', 'Sender bio', '', '选择生日', NULL, NULL, false, true, 'active', '2026-07-01T00:00:00.000Z'),
      ('u-commenter', 'commenter@example.test', 'Commenter', 'Commenter bio', '', '选择生日', NULL, NULL, false, true, 'active', '2026-07-01T00:00:00.000Z'),
      ('u-outsider', 'outsider@example.test', 'Outsider', 'Outsider bio', '', '选择生日', NULL, NULL, false, true, 'active', '2026-07-01T00:00:00.000Z')`
  );
  await pool.query(
    `INSERT INTO auth_identities (id, user_id, provider, provider_subject)
     VALUES ('identity-owner', 'u-owner', 'email', 'identity-owner')`
  );
  await pool.query(
    `INSERT INTO group_collections (
      id, owner_id, name, contact_wechat, contact_qq, contact_group_number, group_info,
      deadline, default_note, status, safety_status, contact_visibility, created_at, updated_at
    ) VALUES (
      'col-evidence', 'u-owner', 'Evidence collection', 'collection-wechat', 'collection-qq', 'collection-group',
      'collection group info', '2026-07-15T00:00:00.000Z', 'Collection default note', 'active', 'active', 'active',
      '2026-07-09T00:00:00.000Z', '2026-07-10T00:00:00.000Z'
    )`
  );
  await pool.query(
    `INSERT INTO posts (
      id, author_id, collection_id, title, description, price, deposit, pinggu_average_price, pinggu_note,
      image_object_keys, wechat, qq, group_number, group_info, deadline, status, safety_status, created_at, updated_at
    ) VALUES (
      'p-evidence', 'u-owner', 'col-evidence', 'Evidence post', 'Post description', '12', '3', '8', 'Price note',
      ARRAY['post/u-owner/2026-07-10/post-1.jpg', 'post/u-owner/2026-07-10/post-2.png']::text[],
      'post-wechat', 'post-qq', 'post-group', 'post group info', '2026-07-15T00:00:00.000Z', 'active', 'active',
      '2026-07-10T10:00:00.000Z', '2026-07-10T11:00:00.000Z'
    )`
  );
  await pool.query(
    `INSERT INTO comments (id, post_id, author_id, body, status, safety_status, created_at)
     VALUES ('c-evidence', 'p-evidence', 'u-commenter', 'Comment body', 'active', 'active', '2026-07-10T12:10:00.000Z')`
  );
  await pool.query(
    `INSERT INTO message_threads (id, buyer_user_id, publisher_user_id)
     VALUES ('t-evidence', 'u-reporter', 'u-sender')`
  );
  await pool.query(
    `INSERT INTO direct_messages (
      id, thread_id, sender_id, body, image_object_key, shared_post_id, shared_profile_user_id, created_at
    ) VALUES
      ('m-before-3', 't-evidence', 'u-reporter', 'before 3', 'message/u-reporter/2026-07-10/before-3.jpg', NULL, NULL, '2026-07-10T12:00:00.000Z'),
      ('m-before-2', 't-evidence', 'u-sender', 'before 2', NULL, 'p-evidence', NULL, '2026-07-10T12:01:00.000Z'),
      ('m-before-1', 't-evidence', 'u-reporter', 'before 1', NULL, NULL, 'u-owner', '2026-07-10T12:02:00.000Z'),
      ('m-target', 't-evidence', 'u-sender', 'target body', 'message/u-sender/2026-07-10/target.png', NULL, NULL, '2026-07-10T12:03:00.000Z'),
      ('m-after-1', 't-evidence', 'u-sender', 'after 1', 'message/u-sender/2026-07-10/after-1.webp', NULL, NULL, '2026-07-10T12:04:00.000Z'),
      ('m-after-2', 't-evidence', 'u-reporter', 'after 2', 'message/u-sender/2026-07-10/target.png', NULL, NULL, '2026-07-10T12:05:00.000Z'),
      ('m-after-3', 't-evidence', 'u-sender', 'after 3', NULL, NULL, NULL, '2026-07-10T12:06:00.000Z')`
  );
}

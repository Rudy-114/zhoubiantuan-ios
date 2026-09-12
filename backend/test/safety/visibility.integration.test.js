import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import test from "node:test";
import { createApp } from "../../src/app.js";
import { loadBootstrap } from "../../src/bootstrap.js";
import { collectionToClient, directMessageToClient, postToClient } from "../../src/mappers.js";
import { loadMessageThreadForUser } from "../../src/messages.js";
import { attachPostCounts } from "../../src/postCounts.js";
import {
  COLLECTION_PUBLIC_VISIBILITY_PREDICATE,
  COMMENT_PUBLIC_VISIBILITY_PREDICATE,
  POST_PUBLIC_VISIBILITY_PREDICATE,
  isPostPubliclyVisible,
  isPostRowPubliclyVisible
} from "../../src/safety/visibility.js";
import { closeDatabase, pool, resetDatabase } from "../helpers/database.js";

test.beforeEach(async () => {
  await resetDatabase();
});

test.after(closeDatabase);

test("uses effective collection context for public post visibility", async () => {
  await pool.query(
    `INSERT INTO users (id, nickname) VALUES ('u-visibility-owner', 'Owner')`
  );
  await pool.query(
    `INSERT INTO group_collections (id, owner_id, name, deadline, safety_status)
     VALUES ('collection-visibility', 'u-visibility-owner', 'Visibility collection', now() + interval '1 day', 'suspended')`
  );
  await pool.query(
    `INSERT INTO posts (id, author_id, collection_id, title, deadline)
     VALUES ('post-visibility', 'u-visibility-owner', 'collection-visibility', 'Visible only through effective state', now() + interval '1 day')`
  );

  const { rows } = await pool.query("SELECT * FROM posts_with_safety_context WHERE id = 'post-visibility'");
  assert.equal(rows[0].safety_status, "active");
  assert.equal(rows[0].collection_safety_status, "suspended");
  assert.equal(isPostRowPubliclyVisible(rows[0]), false);
  const visible = await pool.query(
    `SELECT id FROM posts_with_safety_context p
     WHERE ${POST_PUBLIC_VISIBILITY_PREDICATE}`
  );
  assert.deepEqual(visible.rows, []);
  assert.match(COLLECTION_PUBLIC_VISIBILITY_PREDICATE, /c\.status = 'active'/);
  assert.match(COMMENT_PUBLIC_VISIBILITY_PREDICATE, /cm\.safety_status = 'active'/);
});

test("checks public post visibility through the database interface", async () => {
  await pool.query("INSERT INTO users (id, nickname) VALUES ('u-visible-owner', 'Owner')");
  await pool.query(`INSERT INTO posts (id, author_id, title, deadline) VALUES
    ('post-visible', 'u-visible-owner', 'Visible', now() + interval '1 day'),
    ('post-hidden', 'u-visible-owner', 'Hidden', now() + interval '1 day')`);
  await pool.query("UPDATE posts SET safety_status = 'hidden' WHERE id = 'post-hidden'");
  assert.equal(await isPostPubliclyVisible(pool, "post-visible"), true);
  assert.equal(await isPostPubliclyVisible(pool, "post-hidden"), false);
});

test("excludes hidden comments from public post counts", async () => {
  await pool.query("INSERT INTO users (id, nickname) VALUES ('u-count-owner', 'Owner'), ('u-count-commenter', 'Commenter')");
  await pool.query("INSERT INTO posts (id, author_id, title, deadline) VALUES ('post-count', 'u-count-owner', 'Count post', now() + interval '1 day')");
  await pool.query(`INSERT INTO comments (id, post_id, author_id, body, safety_status) VALUES
    ('comment-count-active', 'post-count', 'u-count-commenter', 'Visible', 'active'),
    ('comment-count-hidden', 'post-count', 'u-count-commenter', 'Hidden', 'hidden')`);
  const post = (await pool.query("SELECT * FROM posts_with_safety_context WHERE id = 'post-count'")).rows[0];
  const [counted] = await attachPostCounts([post]);
  assert.equal(counted.comment_count, 1);
});

test("removes non-public related posts from bootstrap and message-thread payloads", async () => {
  await seedHiddenSharedPostThread();
  const bootstrap = await loadBootstrap("u-thread-owner");
  const thread = await loadMessageThreadForUser(pool, "thread-hidden-post", "u-thread-owner");
  assert.equal(bootstrap.messageThreads[0].relatedPostID, null);
  assert.equal(bootstrap.messageThreads[0].messages[0].sharedPostID, null);
  assert.equal(thread.relatedPostID, null);
  assert.equal(thread.messages[0].sharedPostID, null);
});

test("keeps effective restrictions out of public reads while allowing explicit owner bootstrap rows", async () => {
  await pool.query(`INSERT INTO users (id, nickname) VALUES ('u-owner', 'Owner'), ('u-viewer', 'Viewer'), ('u-commenter', 'Commenter')`);
  await pool.query(
    `INSERT INTO group_collections (id, owner_id, name, deadline, safety_status)
     VALUES ('collection-restricted', 'u-owner', 'Restricted collection', now() + interval '1 day', 'suspended')`
  );
  await pool.query(
    `INSERT INTO posts (id, author_id, collection_id, title, deadline)
     VALUES ('post-restricted', 'u-owner', 'collection-restricted', 'Restricted post', now() + interval '1 day')`
  );
  await pool.query(
    `INSERT INTO comments (id, post_id, author_id, body)
     VALUES ('comment-restricted', 'post-restricted', 'u-commenter', 'Restricted comment')`
  );

  await withServer(async (baseUrl) => {
    const feed = await request(baseUrl, "/api/feed");
    const detail = await request(baseUrl, "/api/posts/post-restricted");
    assert.equal(feed.status, 200);
    assert.equal(feed.body.posts.some((post) => post.id === "post-restricted"), false);
    assert.equal(feed.body.collections.some((collection) => collection.id === "collection-restricted"), false);
    assert.equal(detail.status, 404);
  });

  const viewerBootstrap = await loadBootstrap("u-viewer");
  const ownerBootstrap = await loadBootstrap("u-owner");
  assert.equal(viewerBootstrap.posts.some((post) => post.id === "post-restricted"), false);
  assert.equal(viewerBootstrap.collections.some((collection) => collection.id === "collection-restricted"), false);
  assert.equal(viewerBootstrap.comments.some((comment) => comment.id === "comment-restricted"), false);
  assert.equal(ownerBootstrap.posts.some((post) => post.id === "post-restricted"), true);
  assert.equal(ownerBootstrap.collections.some((collection) => collection.id === "collection-restricted"), true);
  assert.equal(ownerBootstrap.comments.some((comment) => comment.id === "comment-restricted"), false);
});

test("hides collection contacts in client mappers without mutating authoritative values", async () => {
  const row = {
    id: "post-contact",
    author_id: "u-owner",
    collection_id: "collection-contact",
    title: "Contact post",
    deadline: new Date("2026-08-01T00:00:00.000Z"),
    created_at: new Date("2026-07-11T00:00:00.000Z"),
    group_type: "group",
    wechat: "post-wechat",
    qq: "post-qq",
    group_number: "post-group-number",
    group_info: "post group info",
    collection_contact_visibility: "hidden",
    safety_status: "active"
  };
  const collectionRow = {
    id: "collection-contact",
    owner_id: "u-owner",
    name: "Contact collection",
    contact_wechat: "collection-wechat",
    contact_qq: "collection-qq",
    contact_group_number: "collection-group-number",
    group_info: "collection group info",
    deadline: new Date("2026-08-01T00:00:00.000Z"),
    created_at: new Date("2026-07-11T00:00:00.000Z"),
    contact_visibility: "hidden",
    safety_status: "active",
    status: "active"
  };

  const post = postToClient(row);
  const collection = collectionToClient(collectionRow);
  assert.deepEqual(pick(post, ["wechat", "qq", "groupNumber", "groupInfo"]), {
    wechat: "", qq: "", groupNumber: "", groupInfo: ""
  });
  assert.deepEqual(pick(collection, ["contactWechat", "contactQQ", "contactGroupNumber", "groupInfo"]), {
    contactWechat: "", contactQQ: "", contactGroupNumber: "", groupInfo: ""
  });
  assert.equal(post.safetyStatus, "active");
  assert.equal(post.contactVisibility, "hidden");
  assert.equal(collection.safetyStatus, "active");
  assert.equal(collection.contactVisibility, "hidden");
  assert.equal(row.wechat, "post-wechat");
  assert.equal(row.group_info, "post group info");
  assert.equal(collectionRow.contact_wechat, "collection-wechat");
  assert.equal(collectionRow.group_info, "collection group info");
});

test("keeps hidden direct messages distinct from revoked messages", () => {
  const hidden = directMessageToClient({
    id: "message-hidden",
    sender_id: "u-owner",
    body: "sensitive",
    image_object_key: "message/u-owner/hidden.png",
    created_at: new Date("2026-07-11T00:00:00.000Z"),
    safety_status: "hidden",
    shared_post_id: "post-private",
    shared_profile_user_id: "u-private"
  });
  assert.deepEqual(pick(hidden, ["body", "imageURL", "isRevoked", "isSafetyHidden", "sharedPostID", "sharedProfileUserID"]), {
    body: "", imageURL: "", isRevoked: false, isSafetyHidden: true, sharedPostID: null, sharedProfileUserID: null
  });
});

test("redacts shared references for revoked direct messages", () => {
  const revoked = directMessageToClient({
    id: "message-revoked",
    sender_id: "u-owner",
    body: "revoked",
    image_object_key: "message/u-owner/revoked.png",
    created_at: new Date("2026-07-11T00:00:00.000Z"),
    revoked_at: new Date("2026-07-11T00:01:00.000Z"),
    safety_status: "active",
    shared_post_id: "post-private",
    shared_profile_user_id: "u-private"
  });
  assert.deepEqual(pick(revoked, ["body", "imageURL", "isRevoked", "isSafetyHidden", "sharedPostID", "sharedProfileUserID"]), {
    body: "", imageURL: "", isRevoked: true, isSafetyHidden: false, sharedPostID: null, sharedProfileUserID: null
  });
});



function pick(value, keys) {
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}

async function withServer(callback) {
  const server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function request(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, body: await response.json() };
}

async function seedHiddenSharedPostThread() {
  await pool.query("INSERT INTO users (id, nickname) VALUES ('u-thread-owner', 'Owner'), ('u-thread-peer', 'Peer')");
  await pool.query("INSERT INTO posts (id, author_id, title, deadline, safety_status) VALUES ('post-thread-hidden', 'u-thread-owner', 'Hidden post', now() + interval '1 day', 'hidden')");
  await pool.query("INSERT INTO message_threads (id, buyer_user_id, publisher_user_id, related_post_id) VALUES ('thread-hidden-post', 'u-thread-owner', 'u-thread-peer', 'post-thread-hidden')");
  await pool.query("INSERT INTO direct_messages (id, thread_id, sender_id, body, shared_post_id) VALUES ('message-hidden-post', 'thread-hidden-post', 'u-thread-owner', 'shared', 'post-thread-hidden')");
}

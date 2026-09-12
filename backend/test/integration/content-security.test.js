import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { startTestApp, makeUser, query, id } from './helpers.js';
import { moderationProvider } from '../../src/moderation/index.js';
import { cleanupUnusedUploads } from '../../src/uploads.js';

let api, jpeg, png;
const objects = new Map();
let reads = 0;
const storage = {
  putImage: async (key, bytes) => { objects.set(key, bytes); },
  readImage: async key => { reads++; return new Response(objects.get(key) || jpeg, { headers: { 'content-type': 'image/jpeg' } }); },
  removeImage: async key => { objects.delete(key); }
};
before(async () => {
  api = await startTestApp({ objectStorage: storage });
  jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ff0000' } }).jpeg().toBuffer();
  png = await sharp(jpeg).png().toBuffer();
});
after(async () => { await api.close(); });

async function ticket(user, kind = 'post', contentType = 'image/jpeg') {
  const response = await api.request('/uploads/presign', { method: 'POST', token: user.token, body: { kind, contentType, filename: 'test.jpg' } });
  assert.equal(response.status, 200);
  return response.json();
}
async function put(target, bytes = jpeg) {
  const url = new URL(target.uploadUrl);
  return fetch(`${api.base}${url.pathname.replace(/^\/api/, '')}`, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: bytes });
}
async function uploaded(user, kind = 'post') {
  const target = await ticket(user, kind);
  assert.equal((await put(target)).status, 200);
  return target.objectKey;
}
async function makePost(user, key, status = 'active') {
  const postId = id('p');
  await query(`INSERT INTO posts(id,author_id,title,deadline,image_object_keys,status) VALUES($1,$2,'Test',now()+interval '1 day',$3,$4)`, [postId, user.id, [key], status]);
  return postId;
}

test('anonymous and unrelated users cannot read private messages, even with the object key', async () => {
  const [sender, recipient, stranger] = await Promise.all([makeUser(), makeUser(), makeUser()]);
  const key = `message/${sender.id}/${id()}.jpg`, thread = id('t'), message = id('m');
  await query('INSERT INTO message_threads(id,buyer_user_id,publisher_user_id) VALUES($1,$2,$3)', [thread, sender.id, recipient.id]);
  await query('INSERT INTO direct_messages(id,thread_id,sender_id,image_object_key) VALUES($1,$2,$3,$4)', [message, thread, sender.id, key]);
  const path = `/assets/${key}`;
  const count = reads;
  assert.equal((await api.request(path)).status, 404);
  assert.equal((await api.request(path, { token: stranger.token })).status, 404);
  assert.equal(reads, count);
  for (const user of [sender, recipient]) {
    const response = await api.request(path, { token: user.token });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
  await query('UPDATE direct_messages SET deleted_for_user_ids=$2 WHERE id=$1', [message, [recipient.id]]);
  assert.equal((await api.request(path, { token: recipient.token })).status, 404);
  await query('UPDATE direct_messages SET revoked_at=now() WHERE id=$1', [message]);
  assert.equal((await api.request(path, { token: sender.token })).status, 404);
});

test('unpublished, removed and blocked post assets obey server-side visibility', async () => {
  const owner = await makeUser(), viewer = await makeUser();
  const key = `post/${owner.id}/${id()}.jpg`;
  const post = await makePost(owner, key, 'review');
  const path = `/assets/${key}`;
  assert.equal((await api.request(path)).status, 404);
  assert.equal((await api.request(path, { token: owner.token })).status, 200);
  await query("UPDATE posts SET status='active' WHERE id=$1", [post]);
  assert.equal((await api.request(path)).status, 200);
  await query('INSERT INTO user_blocks(blocker_id,blocked_id) VALUES($1,$2)', [viewer.id, owner.id]);
  assert.equal((await api.request(path, { token: viewer.token })).status, 404);
  await query("UPDATE posts SET status='removed' WHERE id=$1", [post]);
  assert.equal((await api.request(path)).status, 404);
});

test('uploads validate actual image bytes, reject large payloads, and cannot be overwritten', async () => {
  const user = await makeUser();
  assert.equal((await put(await ticket(user), Buffer.from('<html>not an image</html>'))).status, 400);
  assert.equal((await put(await ticket(user), png)).status, 400);
  assert.equal((await put(await ticket(user), Buffer.alloc(10 * 1024 * 1024 + 1))).status, 413);
  const target = await ticket(user, 'post', 'image/png');
  const statuses = await Promise.all([put(target, png), put(target, png)]);
  assert.deepEqual(statuses.map(response => response.status).sort(), [200, 410]);
  const info = await sharp(objects.get(target.objectKey)).metadata();
  assert.equal(info.format, 'jpeg');
  assert.equal(info.exif, undefined);
});

test('feed, detail, bootstrap and interactions consistently exclude blocked or unavailable content', async () => {
  const owner = await makeUser(), viewer = await makeUser();
  const post = await makePost(owner, `post/${owner.id}/${id()}.jpg`);
  const comment = id('c');
  await query("INSERT INTO comments(id,post_id,author_id,body) VALUES($1,$2,$3,'Test')", [comment, post, owner.id]);
  await query('INSERT INTO user_blocks(blocker_id,blocked_id) VALUES($1,$2)', [owner.id, viewer.id]);
  for (const path of ['/feed', '/bootstrap']) {
    const response = await api.request(path, { token: viewer.token });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(!payload.posts.some(item => item.id === post));
    assert.ok(!(payload.comments || []).some(item => item.id === comment));
  }
  assert.equal((await api.request(`/posts/${post}`, { token: viewer.token })).status, 404);
  assert.equal((await api.request(`/posts/${post}/like`, { method: 'POST', token: viewer.token })).status, 404);
  assert.equal((await api.request(`/posts/${post}/comments`, { method: 'POST', token: viewer.token, body: { body: 'Reply' } })).status, 400);
  await query('DELETE FROM user_blocks WHERE blocker_id=$1 AND blocked_id=$2', [owner.id, viewer.id]);
  assert.equal((await api.request(`/posts/${post}`, { token: viewer.token })).status, 200);
  await query("UPDATE posts SET status='removed' WHERE id=$1", [post]);
  const bootstrap = await (await api.request('/bootstrap', { token: viewer.token })).json();
  assert.ok(!bootstrap.comments.some(item => item.id === comment));
  await query("UPDATE posts SET status='active' WHERE id=$1", [post]);
  await query('UPDATE users SET deleted_at=now() WHERE id=$1', [owner.id]);
  assert.equal((await api.request(`/posts/${post}`)).status, 404);
});

test('publication rejects unverified upload keys and reviews every preview image', async () => {
  const user = await makeUser();
  const collectionID = id('col');
  await query("INSERT INTO group_collections(id,owner_id,name,deadline) VALUES($1,$2,'Upload collection',now()+interval '1 day')", [collectionID, user.id]);
  const base = { collectionID, title: 'Normal post', description: 'Normal content', deadline: new Date(Date.now() + 86400000).toISOString() };
  let response = await api.request('/posts', { method: 'POST', token: user.token, body: { ...base, imageObjectKeys: [`post/${user.id}/arbitrary.jpg`] } });
  assert.equal(response.status, 400);
  const original = await uploaded(user), preview = await uploaded(user);
  const provider = moderationProvider(), reviewImages = provider.reviewImages;
  const seen = [];
  provider.reviewImages = async input => { seen.push(...input.imageObjectKeys); return { outcome: input.imageObjectKeys.includes(preview) ? 'block' : 'pass' }; };
  try {
    response = await api.request('/posts', { method: 'POST', token: user.token, body: { ...base, imageObjectKeys: [original], previewImageObjectKeys: [preview] } });
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.post.status, 'rejected');
    assert.deepEqual(new Set(seen), new Set([original, preview]));
    const review = (await query('SELECT image_object_keys FROM moderation_reviews WHERE target_id=$1', [body.post.id])).rows[0];
    assert.deepEqual(new Set(review.image_object_keys), new Set([original, preview]));
    assert.equal((await api.request(`/assets/${preview}`)).status, 404);
  } finally { provider.reviewImages = reviewImages; }
});

test('upload quota is serialized, and cleanup preserves referenced media', async () => {
  const user = await makeUser();
  const retained = await uploaded(user), unused = await uploaded(user);
  await query("UPDATE upload_tickets SET created_at=now()-interval '8 days', referenced_at=CASE WHEN object_key=$1 THEN now() ELSE NULL END WHERE user_id=$2", [retained, user.id]);
  await cleanupUnusedUploads(storage);
  assert.ok(objects.has(retained));
  assert.ok(!objects.has(unused));
  await query(`INSERT INTO upload_tickets(token_hash,object_key,user_id,kind,content_type)
    SELECT $1 || g, $1 || g, $2, 'post', 'image/jpeg' FROM generate_series(1,199) g`, [id(), user.id]);
  const responses = await Promise.all([1,2,3].map(() => api.request('/uploads/presign', { method: 'POST', token: user.token, body: { kind: 'post', contentType: 'image/jpeg' } })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200,429,429]);
});

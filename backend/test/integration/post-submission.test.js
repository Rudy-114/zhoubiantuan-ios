import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, makeUser, query, id } from './helpers.js';

let api;
before(async () => { api = await startTestApp(); });
after(async () => { await api.close(); });

async function draft(user) {
  const collectionID = id('col');
  await query("INSERT INTO group_collections(id,owner_id,name,contact_wechat,deadline) VALUES($1,$2,'Draft collection','test',now()+interval '1 day')", [collectionID, user.id]);
  const key = `guarded/post/${user.id}/${id()}.jpg`;
  await query(`INSERT INTO upload_tickets(token_hash,object_key,user_id,kind,content_type,status,sha256,byte_size)
    VALUES($1,$2,$3,'post','image/jpeg','ready','synthetic-verified-digest',100)`, [id(), key, user.id]);
  return { id: id('p'), title: 'Idempotent post', description: 'Test', collectionID,
    imageObjectKeys: [key], previewImageObjectKeys: [], price: '10', condition: 'Test' };
}

test('concurrent retries create one post and one public creation event', async () => {
  const user = await makeUser(), body = await draft(user);
  const responses = await Promise.all([1,2].map(() => api.request('/posts', { method: 'POST', token: user.token, body })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200,201]);
  assert.equal((await query('SELECT 1 FROM posts WHERE id=$1', [body.id])).rowCount, 1);
  assert.equal((await query("SELECT 1 FROM sync_events WHERE entity_id=$1 AND user_id IS NULL AND event_type='post.created'", [body.id])).rowCount, 1);
  assert.equal((await api.request('/posts', { method: 'POST', token: user.token, body })).status, 200);
});

test('a reused submission ID cannot overwrite content or expose another authors post', async () => {
  const author = await makeUser(), stranger = await makeUser(), body = await draft(author);
  assert.equal((await api.request('/posts', { method: 'POST', token: author.token, body })).status, 201);
  assert.equal((await api.request('/posts', { method: 'POST', token: author.token, body: { ...body, title: 'Different draft' } })).status, 409);
  assert.equal((await api.request('/posts', { method: 'POST', token: stranger.token, body })).status, 409);
  assert.equal((await query('SELECT title FROM posts WHERE id=$1', [body.id])).rows[0].title, body.title);
});

test('replacement commits the new post and old deletion together and is safely retryable', async () => {
  const user = await makeUser(), old = await draft(user);
  old.description = '[review]';
  assert.equal((await api.request('/posts', { method: 'POST', token: user.token, body: old })).status, 201);
  const replacement = { ...await draft(user), replacingPostID: old.id };
  assert.equal((await api.request('/posts', { method: 'POST', token: user.token, body: replacement })).status, 201);
  assert.equal((await query('SELECT status FROM posts WHERE id=$1', [old.id])).rows[0].status, 'deleted');
  assert.equal((await api.request('/posts', { method: 'POST', token: user.token, body: replacement })).status, 200);
  const invalid = { ...await draft(user), replacingPostID: replacement.id };
  assert.equal((await api.request('/posts', { method: 'POST', token: user.token, body: invalid })).status, 400);
  assert.equal((await query('SELECT 1 FROM posts WHERE id=$1', [invalid.id])).rowCount, 0);
  assert.equal((await query('SELECT status FROM posts WHERE id=$1', [replacement.id])).rows[0].status, 'active');
});

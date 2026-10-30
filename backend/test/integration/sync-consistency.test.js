import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, makeUser, query, pool, withTransaction, id } from './helpers.js';
import { createSyncEvent, getCurrentSyncCursor, loadSyncPayload, pruneOldSyncEvents } from '../../src/sync.js';

let api;
before(async () => { api = await startTestApp({ objectStorage: { removeImage: async () => {} } }); });
after(async () => { await api.close(); });
async function makePost(user, status = 'active', collection = null) {
  const post = id('p');
  await query(`INSERT INTO posts(id,author_id,title,deadline,status,collection_id) VALUES($1,$2,'Sync test',now()+interval '1 day',$3,$4)`, [post, user.id, status, collection]);
  return post;
}
const event = (userId, entityId) => ({ userId, eventType: 'post.updated', entityType: 'post', entityId });

test('concurrent transactions cannot commit a later cursor ahead of an earlier event', async () => {
  const user = await makeUser(), before = await getCurrentSyncCursor();
  const first = await pool.connect(), second = await pool.connect();
  try {
    await first.query('BEGIN');
    const early = await createSyncEvent(first, event(user.id, id('p')));
    await second.query('BEGIN');
    // PostgreSQL itself verifies the second publisher waits on the transaction lock.
    await second.query("SET LOCAL lock_timeout='100ms'");
    await assert.rejects(createSyncEvent(second, event(user.id, id('p'))), error => error.code === '55P03');
    assert.equal(await getCurrentSyncCursor(), before);
    await second.query('ROLLBACK');
    await first.query('COMMIT');
    const late = await withTransaction(client => createSyncEvent(client, event(user.id, id('p'))));
    assert.ok(BigInt(late.id) > BigInt(early.id));
    const payload = await loadSyncPayload(user.id, { cursor: before });
    assert.deepEqual(payload.events.filter(item => item.userID === user.id).map(item => item.id), [early.id, late.id]);
    assert.equal(payload.nextCursor, late.id);
  } finally {
    await first.query('ROLLBACK'); await second.query('ROLLBACK');
    first.release(); second.release();
  }
});

test('a rolled-back publication neither advances the cursor nor leaves an event', async () => {
  const user = await makeUser(), entityId = id('p');
  await assert.rejects(withTransaction(async client => {
    await createSyncEvent(client, event(user.id, entityId));
    throw new Error('simulated rollback');
  }), /simulated rollback/);
  assert.equal((await query('SELECT 1 FROM sync_events WHERE entity_id=$1', [entityId])).rowCount, 0);
});

test('a reader gets a post deletion tombstone without receiving the removed content', async () => {
  const author = await makeUser(), reader = await makeUser();
  const post = await makePost(author), cursor = await getCurrentSyncCursor();
  assert.equal((await api.request(`/posts/${post}`, { method: 'DELETE', token: author.token })).status, 204);
  const payload = await loadSyncPayload(reader.id, { cursor });
  assert.ok(payload.events.some(item => item.entityID === post && item.userID == null));
  assert.ok(payload.removedPostIDs.includes(post));
  assert.ok(!payload.posts.some(item => item.id === post));
});

test('moderation approval and removal notify readers; stale reviews cannot resurrect deleted posts', async () => {
  const author = await makeUser(), reader = await makeUser(), admin = await makeUser({ role: 'moderator' });
  const post = await makePost(author, 'review'), review = id('mr');
  await withTransaction(async client => {
    await client.query('UPDATE posts SET updated_at=now() WHERE id=$1', [post]);
    await client.query(`INSERT INTO moderation_reviews(id,target_type,target_id,owner_id) VALUES($1,'post',$2,$3)`, [review, post, author.id]);
  });
  let cursor = await getCurrentSyncCursor();
  assert.equal((await api.request(`/moderation/reviews/${review}/decision`, { method: 'POST', token: admin.token, body: { decision: 'approve' } })).status, 200);
  assert.ok((await loadSyncPayload(reader.id, { cursor })).posts.some(item => item.id === post));
  cursor = await getCurrentSyncCursor();
  assert.equal((await api.request(`/moderation/reviews/${review}/decision`, { method: 'POST', token: admin.token, body: { decision: 'remove' } })).status, 200);
  assert.ok((await loadSyncPayload(reader.id, { cursor })).removedPostIDs.includes(post));
  await query("UPDATE posts SET status='deleted' WHERE id=$1", [post]);
  assert.equal((await api.request(`/moderation/reviews/${review}/decision`, { method: 'POST', token: admin.token, body: { decision: 'approve' } })).status, 409);
});

test('collection hiding invalidates child visibility; nonempty collection deletion is rejected', async () => {
  const author = await makeUser(), reader = await makeUser();
  const collection = id('col');
  await query("INSERT INTO group_collections(id,owner_id,name,deadline) VALUES($1,$2,'Sync collection',now()+interval '1 day')", [collection, author.id]);
  const post = await makePost(author, 'active', collection);
  assert.equal((await api.request(`/collections/${collection}`, { method: 'DELETE', token: author.token })).status, 409);
  const cursor = await getCurrentSyncCursor();
  assert.equal((await api.request(`/collections/${collection}`, { method: 'PATCH', token: author.token, body: { revision: 1, name: '触发人工审核', wechat: 'test-contact' } })).status, 200);
  const payload = await loadSyncPayload(reader.id, { cursor });
  assert.equal(payload.contentRefreshRequired, true);
  assert.ok(payload.removedCollectionIDs.includes(collection));
  assert.equal((await api.request(`/posts/${post}`, { token: reader.token })).status, 404);
});

test('account deletion publishes a user tombstone and removes authored content from readers', async () => {
  const author = await makeUser(), reader = await makeUser();
  const post = await makePost(author), cursor = await getCurrentSyncCursor();
  assert.equal((await api.request('/me', { method: 'DELETE', token: author.token })).status, 204);
  const payload = await loadSyncPayload(reader.id, { cursor });
  assert.ok(payload.removedUserIDs.includes(author.id));
  assert.equal((await api.request(`/posts/${post}`, { token: reader.token })).status, 404);
});

test('idle sync uses one snapshot query and expired cursors explicitly request a reset', async () => {
  const user = await makeUser();
  const old = await withTransaction(client => createSyncEvent(client, event(user.id, id('p'))));
  const cursor = await getCurrentSyncCursor();
  const original = pool.query;
  let queries = 0;
  pool.query = (...args) => { queries++; return original.apply(pool, args); };
  try {
    const empty = await loadSyncPayload(user.id, { cursor });
    assert.deepEqual(empty.events, []);
    assert.equal(queries, 1);
  } finally { pool.query = original; }
  await query("UPDATE sync_events SET created_at=now()-interval '8 days' WHERE id=$1", [old.id]);
  await pruneOldSyncEvents();
  const reset = await loadSyncPayload(user.id, { cursor: String(BigInt(old.id) - 1n) });
  assert.equal(reset.resetRequired, true);
  await assert.rejects(
    () => loadSyncPayload(user.id, { cursor: '999999999999999999999999999999' }),
    error => error?.status === 400 && /同步游标无效/.test(error.message)
  );
});

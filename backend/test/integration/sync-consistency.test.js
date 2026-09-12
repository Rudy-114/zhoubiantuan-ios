import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, makeUser, query, pool, withTransaction, id } from './helpers.js';
import { randomBytes } from 'node:crypto';
import { hashAdminToken } from '../../src/admin/sessionService.js';
import { createSyncEvent, getCurrentSyncCursor, loadSyncPayload, pruneOldSyncEvents } from '../../src/sync.js';

process.env.ADMIN_RECOVERY_PEPPER = "synthetic-deploy-test-pepper-over-32-characters";
let api;
before(async () => { api = await startTestApp({ adminWebEnabled: true, objectStorage: { removeImage: async () => {} } }); });
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

test('web admin moderation publishes visibility changes and refuses handled or deleted reviews', async () => {
  const author = await makeUser(), reader = await makeUser();
  const adminID=id('admin'), deviceID=id('device'), sessionID=id('session'), token=randomBytes(32).toString('base64url'), csrf=randomBytes(32).toString('base64url');
  await query("INSERT INTO admin_users(id,username,username_normalized,password_hash) VALUES($1,$1,$1,'unused-test-hash')",[adminID]);
  await query(`INSERT INTO admin_devices(id,admin_user_id,display_name,public_key_jwk,fingerprint_hash,is_root) VALUES($1,$2,'test','{"kty":"EC"}',$1,true)`,[deviceID,adminID]);
  await query("INSERT INTO admin_sessions(id,admin_user_id,device_id,token_hash,csrf_hash,idle_expires_at,absolute_expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '30 minutes',now()+interval '8 hours')",[sessionID,adminID,deviceID,hashAdminToken(token),hashAdminToken(csrf)]);
  const decide=(review,decision)=>fetch(api.base.replace(/\/api$/,'')+'/admin/api/moderation-reviews/'+review+'/decision',{
    method:'POST',headers:{'content-type':'application/json',cookie:`zbt_admin_session=${token}; zbt_admin_csrf=${csrf}`,'x-csrf-token':csrf},body:JSON.stringify({decision,reason:'Verified synthetic content'})});
  const post=await makePost(author,'review');
  const makeReview=async()=>{const review=id('mr');await query("INSERT INTO moderation_reviews(id,target_type,target_id,owner_id) VALUES($1,'post',$2,$3)",[review,post,author.id]);return review;};
  const review=await makeReview();let cursor=await getCurrentSyncCursor();
  assert.equal((await decide(review,'approve')).status,200);
  assert.ok((await loadSyncPayload(reader.id,{cursor})).posts.some(item=>item.id===post));
  assert.equal((await decide(review,'remove')).status,409);
  const removal=await makeReview();cursor=await getCurrentSyncCursor();
  assert.equal((await decide(removal,'remove')).status,200);
  assert.ok((await loadSyncPayload(reader.id,{cursor})).removedPostIDs.includes(post));
  const stale=await makeReview();await query("UPDATE posts SET status='deleted' WHERE id=$1",[post]);
  assert.equal((await decide(stale,'approve')).status,409);
});

test('queued sync events acquire their cursor after all business writes and roll back with them', async()=>{
  const user=await makeUser(), entityId=id('p');let queued;
  await withTransaction(async client=>{
    queued=await createSyncEvent(client,event(user.id,entityId));
    assert.equal(queued.id,undefined);
    assert.equal((await client.query('SELECT 1 FROM sync_events WHERE entity_id=$1',[entityId])).rowCount,0);
    await client.query("UPDATE users SET nickname='Committed with event' WHERE id=$1",[user.id]);
  });
  assert.ok(queued.id);
  assert.equal((await query('SELECT nickname FROM users WHERE id=$1',[user.id])).rows[0].nickname,'Committed with event');
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
  assert.equal((await loadSyncPayload(user.id, { cursor: '999999999999999999999999999999' })).resetRequired, true);
});

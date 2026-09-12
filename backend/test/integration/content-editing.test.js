import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, makeUser, query, id } from './helpers.js';

let api;
before(async () => { api = await startTestApp(); });
after(async () => { await api.close(); });
const role = (quantity = 3, name = 'Role A') => ({ id: 'role-a', name, quantity, priceAdjustment: 0 });
async function fixture(user) {
  const collectionID = id('col'), postID = id('p');
  await query("INSERT INTO group_collections(id,owner_id,name,deadline,contact_wechat) VALUES($1,$2,$1,now()+interval '1 day','contact')", [collectionID, user.id]);
  await query("INSERT INTO posts(id,author_id,collection_id,title,deadline,unsold_roles) VALUES($1,$2,$3,'Stock post',now()+interval '1 day',$4::jsonb)", [postID, user.id, collectionID, JSON.stringify([role()])]);
  return { collectionID, postID };
}

test('concurrent stock edits persist once, reject stale revisions and never overwrite the winner', async () => {
  const owner = await makeUser(), { postID } = await fixture(owner);
  const responses = await Promise.all([4,7].map(quantity => api.request(`/posts/${postID}`, { method: 'PATCH', token: owner.token, body: { revision: 1, unsoldRoles: [role(quantity)] } })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200,409]);
  const winner = (await responses.find(r => r.status === 200).json()).post;
  const persisted = (await api.request(`/posts/${postID}`, { token: owner.token }).then(r => r.json())).post;
  assert.equal(persisted.revision, 2);
  assert.deepEqual(persisted.unsoldRoles, winner.unsoldRoles);
  const stranger = await makeUser();
  assert.equal((await api.request(`/posts/${postID}`, { method: 'PATCH', token: stranger.token, body: { revision: 2, unsoldRoles: [] } })).status, 404);
});

test('stock validates quantities and re-reviews text without restoring hidden content', async () => {
  const owner = await makeUser(), { postID } = await fixture(owner);
  for (const unsoldRoles of [[role(-1)], [role(1.5)], [role(1), role(2)]]) {
    assert.equal((await api.request(`/posts/${postID}`, { method: 'PATCH', token: owner.token, body: { revision: 1, unsoldRoles } })).status, 400);
  }
  const response = await api.request(`/posts/${postID}`, { method: 'PATCH', token: owner.token, body: { revision: 1, unsoldRoles: [role(3, '[review]')] } });
  assert.equal(response.status, 200);
  const changed = (await response.json()).post;
  assert.notEqual(changed.status, 'active');
  assert.equal((await api.request(`/posts/${postID}`)).status, 404);
  assert.equal((await api.request(`/posts/${postID}`, { method: 'PATCH', token: owner.token, body: { revision: changed.revision, unsoldRoles: [role(5)] } })).status, 400);
});

test('moving a post updates the database and inherited fields and refuses invalid ownership or orphaning', async () => {
  const owner = await makeUser(), stranger = await makeUser(), source = await fixture(owner), destination = await fixture(owner), foreign = await fixture(stranger);
  await query("UPDATE group_collections SET contact_wechat='new-contact' WHERE id=$1", [destination.collectionID]);
  for (const collectionID of [foreign.collectionID, '', id('col')]) {
    assert.equal((await api.request(`/posts/${source.postID}`, { method: 'PATCH', token: owner.token, body: { revision: 1, collectionID } })).status, 400);
  }
  const moved = await api.request(`/posts/${source.postID}`, { method: 'PATCH', token: owner.token, body: { revision: 1, collectionID: destination.collectionID } });
  assert.equal(moved.status, 200);
  assert.equal((await moved.json()).post.wechat, 'new-contact');
  assert.equal((await query('SELECT collection_id FROM posts WHERE id=$1', [source.postID])).rows[0].collection_id, destination.collectionID);
  assert.equal((await api.request(`/collections/${source.collectionID}`, { method: 'DELETE', token: owner.token })).status, 204);
  assert.equal((await api.request(`/collections/${destination.collectionID}`, { method: 'DELETE', token: owner.token })).status, 409);
});

test('collection edits use revisions, deleted collections stay deleted, and concurrent names stay unique', async () => {
  const owner = await makeUser(), { collectionID } = await fixture(owner);
  const body = { revision: 1, name: 'New collection', wechat: 'contact', defaultNote: 'New description' };
  const edits = await Promise.all(['First','Second'].map(name => api.request(`/collections/${collectionID}`, { method: 'PATCH', token: owner.token, body: { ...body, name } })));
  assert.deepEqual(edits.map(r => r.status).sort(), [200,409]);
  await query("UPDATE group_collections SET status='deleted' WHERE id=$1", [collectionID]);
  assert.equal((await api.request(`/collections/${collectionID}`, { method: 'PATCH', token: owner.token, body: { ...body, revision: 3 } })).status, 409);
  const creates = await Promise.all([1,2].map(() => api.request('/collections', { method: 'POST', token: owner.token, body: { ...body, id: id('col'), name: 'Concurrent name' } })));
  assert.deepEqual(creates.map(r => r.status).sort(), [201,400]);
  assert.equal((await query("SELECT 1 FROM group_collections WHERE owner_id=$1 AND name='Concurrent name'", [owner.id])).rowCount, 1);
});

test('publication requires an active owned collection and collection creation retries do not duplicate', async () => {
  const owner = await makeUser();
  assert.equal((await api.request('/posts', { method: 'POST', token: owner.token, body: { title: 'Orphan post' } })).status, 400);
  const body = { id: id('col'), name: 'Retry collection', wechat: 'contact', defaultNote: 'Description' };
  const first = await api.request('/collections', { method: 'POST', token: owner.token, body });
  const replay = await api.request('/collections', { method: 'POST', token: owner.token, body });
  assert.equal(first.status, 201); assert.equal(replay.status, 201);
  assert.equal((await first.json()).collection.id, (await replay.json()).collection.id);
  assert.equal((await query('SELECT 1 FROM group_collections WHERE id=$1', [body.id])).rowCount, 1);
});

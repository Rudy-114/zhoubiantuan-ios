import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { startTestApp, makeUser, query, id } from './helpers.js';

const CACHE_MS = 200;
let api, jpeg, reads = 0;
const storage = {
  readImage: async () => { reads++; return new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } }); },
  removeImage: async () => {}
};
before(async () => {
  // Same code path as production, with the 30 s allow-cache scaled down.
  api = await startTestApp({ objectStorage: storage, assetAccessCacheMs: CACHE_MS });
  jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#00ff00' } }).jpeg().toBuffer();
});
after(async () => { await api.close(); });

async function postAsset(owner, { withTicket = true } = {}) {
  const key = `post/${owner.id}/${id()}.jpg`;
  const sha256 = createHash('sha256').update(key).digest('hex');
  if (withTicket) {
    await query(`INSERT INTO upload_tickets(token_hash,object_key,user_id,kind,content_type,status,sha256,uploaded_at,referenced_at)
      VALUES($1,$2,$3,'post','image/jpeg','ready',$4,now(),now())`, [id('tk'), key, owner.id, sha256]);
  }
  const postId = id('p');
  await query(`INSERT INTO posts(id,author_id,title,deadline,image_object_keys,status) VALUES($1,$2,'Asset',now()+interval '1 day',$3,'active')`, [postId, owner.id, [key]]);
  return { key, postId, sha256 };
}
const get = (path, { token, etag } = {}) => fetch(`${api.base}${path}`, {
  headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(etag ? { 'if-none-match': etag } : {}) }
});

test('assets carry the upload hash as ETag and answer If-None-Match with 304 without reading OSS', async () => {
  const owner = await makeUser();
  const { key, sha256 } = await postAsset(owner);
  const first = await get(`/assets/${key}`, { token: owner.token });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('etag'), `"${sha256}"`);
  assert.equal(first.headers.get('cache-control'), 'private, max-age=300');
  await first.arrayBuffer();
  const before = reads;
  const second = await get(`/assets/${key}`, { token: owner.token, etag: `"${sha256}"` });
  assert.equal(second.status, 304);
  assert.equal(reads, before, '304 must not touch object storage');
  const stale = await get(`/assets/${key}`, { token: owner.token, etag: '"0000"' });
  assert.equal(stale.status, 200);
  await stale.arrayBuffer();
});

test('assets without a ready upload ticket are served without an ETag', async () => {
  const owner = await makeUser();
  const { key } = await postAsset(owner, { withTicket: false });
  const response = await get(`/assets/${key}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('etag'), null);
  await response.arrayBuffer();
});

test('a takedown is enforced once the allow-cache entry expires; unauthorized viewers always get 404', async () => {
  const owner = await makeUser(), stranger = await makeUser();
  const { key, postId, sha256 } = await postAsset(owner);
  // A private message image: never readable by a stranger, cached or not.
  const messageKey = `message/${owner.id}/${id()}.jpg`, thread = id('t');
  await query('INSERT INTO message_threads(id,buyer_user_id,publisher_user_id) VALUES($1,$2,$3)', [thread, owner.id, (await makeUser()).id]);
  await query('INSERT INTO direct_messages(id,thread_id,sender_id,image_object_key) VALUES($1,$2,$3,$4)', [id('m'), thread, owner.id, messageKey]);
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.equal((await get(`/assets/${messageKey}`, { token: stranger.token })).status, 404);
    assert.equal((await get(`/assets/${messageKey}`)).status, 404);
  }

  assert.equal((await get(`/assets/${key}`, { token: stranger.token })).status, 200);
  await query("UPDATE posts SET status='removed' WHERE id=$1", [postId]);
  await new Promise(resolve => setTimeout(resolve, CACHE_MS + 100));
  assert.equal((await get(`/assets/${key}`, { token: stranger.token })).status, 404);
  assert.equal((await get(`/assets/${key}`, { token: stranger.token, etag: `"${sha256}"` })).status, 404,
    'a matching ETag never bypasses the permission check');
});

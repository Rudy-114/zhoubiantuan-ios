import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, makeUser, query, id } from './helpers.js';

let api;
before(async () => {
  api = await startTestApp({ objectStorage: { removeImage: async () => {} } });
  api.app.set('trust proxy', true);
});
after(async () => { await api.close(); });

const get = (path, { token, ip = '203.0.113.9' } = {}) => fetch(`${api.base}${path}`, {
  headers: { 'x-forwarded-for': ip, ...(token ? { authorization: `Bearer ${token}` } : {}) }
});

async function seed() {
  const owner = await makeUser(), viewer = await makeUser();
  const collection = id('col'), post = id('p');
  await query(`INSERT INTO group_collections(id,owner_id,name,deadline,contact_wechat,contact_qq,contact_group_number,group_info)
    VALUES($1,$2,'Contact collection',now()+interval '1 day','wx-owner','10001','20002','join notes')`, [collection, owner.id]);
  await query(`INSERT INTO posts(id,author_id,collection_id,title,deadline,wechat,qq,group_number,group_info,external_link,status)
    VALUES($1,$2,$3,'Contact post',now()+interval '1 day','wx-owner','10001','20002','join notes','https://form.example/x','active')`, [post, owner.id, collection]);
  return { owner, viewer, collection, post };
}
const contactOf = post => [post.wechat, post.qq, post.groupNumber, post.groupInfo, post.externalLink];
const collectionContactOf = c => [c.contactWechat, c.contactQQ, c.contactGroupNumber, c.groupInfo];

test('F24: guests get no contact fields on posts and collections; signed-in viewers do', async () => {
  const { owner, viewer, collection, post } = await seed();
  const guestDetail = await (await get(`/posts/${post}`)).json();
  assert.deepEqual(contactOf(guestDetail.post), ['', '', '', '', '']);
  assert.equal(guestDetail.post.contactHidden, true);
  for (const item of guestDetail.collections) {
    assert.deepEqual(collectionContactOf(item), ['', '', '', '']);
    assert.equal(item.contactHidden, true);
  }
  const guestCollections = await (await get(`/collections?ownerID=${owner.id}`)).json();
  assert.deepEqual(collectionContactOf(guestCollections.collections.find(c => c.id === collection)), ['', '', '', '']);
  const guestFeed = await (await get(`/feed?authorID=${owner.id}`)).json();
  assert.deepEqual(contactOf(guestFeed.posts.find(p => p.id === post)), ['', '', '', '', '']);

  const signedIn = await (await get(`/posts/${post}`, { token: viewer.token })).json();
  assert.deepEqual(contactOf(signedIn.post), ['wx-owner', '10001', '20002', 'join notes', 'https://form.example/x']);
  assert.equal(signedIn.post.contactHidden, false);
  const bootstrap = await (await get('/bootstrap', { token: viewer.token })).json();
  const bootPost = bootstrap.posts.find(p => p.id === post);
  if (bootPost) assert.equal(bootPost.wechat, 'wx-owner');
});

test('F24: anonymous public reads are limited per IP; signed-in reads are not', async () => {
  const user = await makeUser();
  const ip = '203.0.113.77';
  for (let i = 0; i < 120; i++) assert.equal((await get('/users?limit=1', { ip })).status, 200, `request ${i + 1}`);
  const blocked = await get('/users?limit=1', { ip });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
  assert.equal((await get('/users?limit=1', { ip, token: user.token })).status, 200);
});

test('F30: other users see a minimized profile; the owner sees everything', async () => {
  const owner = await makeUser(), viewer = await makeUser();
  await query(`UPDATE users SET gender='女',birthday='2000-01-01',region='上海',red_book_id='rb-owner',last_nickname_changed_at=now() WHERE id=$1`, [owner.id]);
  const other = (await (await get(`/users?id=${owner.id}`, { token: viewer.token })).json()).users[0];
  assert.equal(other.birthday, '选择生日');
  assert.equal(other.gender, '未设置');
  assert.equal(other.region, '未设置');
  assert.equal(other.lastNicknameChangedAt, null);
  assert.equal(other.moderationStatus, '');
  assert.equal(other.reviewID, '');
  assert.equal(other.redBookID, 'rb-owner', 'shown in search results');
  const self = (await (await get('/me', { token: owner.token })).json()).user;
  assert.equal(self.birthday, '2000-01-01');
  assert.equal(self.gender, '女');
  assert.equal(self.region, '上海');
  assert.ok(self.lastNicknameChangedAt);
});

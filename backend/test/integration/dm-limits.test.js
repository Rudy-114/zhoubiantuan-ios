import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, makeUser, query, id } from './helpers.js';

let api;
before(async () => { api = await startTestApp({ objectStorage: { removeImage: async () => {} } }); });
after(async () => { await api.close(); });

const threadOf = (a, b) => `t-dm-${[a.id, b.id].sort().join('-')}`;
const send = (from, to, body = 'hello', messageID = id('m')) => api.request(`/messages/threads/${threadOf(from, to)}/messages`,
  { method: 'POST', token: from.token, body: { messageID, recipientUserID: to.id, body } });

test('F26: at most 3 messages before the recipient replies; a reply lifts the limit', async () => {
  const a = await makeUser(), b = await makeUser();
  for (let i = 0; i < 3; i++) assert.equal((await send(a, b, `m${i}`)).status, 201);
  const blocked = await send(a, b, 'fourth');
  assert.equal(blocked.status, 400);
  const body = await blocked.json();
  assert.equal(body.code, 'dm_limit_unreplied');
  assert.equal(body.error, '对方回复或关注你之前，最多发送 3 条消息');
  // The rejected message was not stored.
  assert.equal((await query('SELECT count(*)::int AS n FROM direct_messages WHERE sender_id=$1', [a.id])).rows[0].n, 3);
  assert.equal((await send(b, a, 'reply')).status, 201);
  assert.equal((await send(a, b, 'after reply')).status, 201);
});

test('F26: following the sender lifts the limit; retrying a stored message id stays idempotent', async () => {
  const a = await makeUser(), b = await makeUser();
  const ids = [id('m'), id('m'), id('m')];
  for (const messageID of ids) assert.equal((await send(a, b, 'x', messageID)).status, 201);
  assert.equal((await send(a, b, 'retry of a stored message', ids[2])).status, 201, 'retry is not a new message');
  assert.equal((await send(a, b, 'new')).status, 400);
  await query('INSERT INTO follows(follower_id,following_id) VALUES($1,$2)', [b.id, a.id]);
  assert.equal((await send(a, b, 'now allowed')).status, 201);
});

test('F26: 30 messages per minute per sender, then 429', async () => {
  const a = await makeUser(), b = await makeUser();
  await query('INSERT INTO follows(follower_id,following_id) VALUES($1,$2)', [b.id, a.id]);
  for (let i = 0; i < 30; i++) assert.equal((await send(a, b, `burst ${i}`)).status, 201, `message ${i + 1}`);
  assert.equal((await send(a, b, 'too many')).status, 429);
});

test('F26: at most 30 new conversations per day per sender', async () => {
  const a = await makeUser();
  const recipients = await Promise.all(Array.from({ length: 31 }, () => makeUser()));
  // Stay under the per-minute send limit by pre-filling today's thread budget.
  await query(`INSERT INTO rate_limit_events(scope,key_hash,created_at,expires_at)
    SELECT 'dm_new_thread', encode(sha256($1::bytea),'hex'), now(), now()+interval '1 day' FROM generate_series(1,29)`, [a.id]);
  assert.equal((await send(a, recipients[0], 'thread 30')).status, 201);
  const blocked = await send(a, recipients[1], 'thread 31');
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).code, 'dm_new_thread_limit');
  // Existing conversations are unaffected.
  assert.equal((await send(a, recipients[0], 'same thread')).status, 201);
});

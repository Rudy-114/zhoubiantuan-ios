import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { startTestApp, makeUser, makeCode, query, pool, id } from './helpers.js';
import { createRateLimiter, pruneOldRateLimitEvents } from '../../src/rateLimit.js';
import { signToken } from '../../src/auth.js';
import { config } from '../../src/config.js';

let api;
before(async () => { api = await startTestApp(); });
after(async () => { await api.close(); });

test('legacy registration is closed and cannot allocate an account', async () => {
  const email = `${id()}@example.test`;
  const response = await api.request('/auth/register', { method: 'POST', body: { email, password: 'test-password', nickname: 'Test' } });
  assert.equal(response.status, 410);
  assert.equal((await query('SELECT id FROM users WHERE email=$1', [email])).rowCount, 0);
});

test('moderation requires an explicitly granted role and verified ownership', async () => {
  const unverified = await makeUser({ verified: false, role: 'moderator' });
  config.moderation.adminEmails.push(unverified.email);
  assert.equal((await api.request('/moderation/reviews', { token: unverified.token })).status, 403);
  const ordinary = await makeUser();
  config.moderation.adminEmails.push(ordinary.email);
  assert.equal((await api.request('/moderation/reviews', { token: ordinary.token })).status, 403);
  const moderator = await makeUser({ role: 'moderator' });
  assert.equal((await api.request('/moderation/reviews', { token: moderator.token })).status, 200);
});

test('wrong email codes commit attempts and lock out even the correct code after five failures', async () => {
  const user = await makeUser();
  const codeId = await makeCode(user);
  for (let attempt = 1; attempt <= 6; attempt++) {
    assert.equal((await api.request('/auth/email/login', { method: 'POST', body: { email: user.email, code: '000000' } })).status, 400);
    assert.equal((await query('SELECT attempts FROM email_verification_codes WHERE id=$1', [codeId])).rows[0].attempts, Math.min(attempt, 5));
  }
  assert.equal((await api.request('/auth/email/login', { method: 'POST', body: { email: user.email, code: '123456' } })).status, 400);
});

test('email code succeeds once under concurrent login and verifies a legacy identity', async () => {
  const user = await makeUser({ verified: false });
  await makeCode(user);
  const responses = await Promise.all([1, 2].map(() => api.request('/auth/email/login', {
    method: 'POST', body: { email: user.email, code: '123456' }
  })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 400]);
  assert.equal((await query('SELECT email_verified FROM auth_identities WHERE user_id=$1', [user.id])).rows[0].email_verified, true);
});

test('consuming the newest code never reactivates an older code', async () => {
  const user = await makeUser();
  await makeCode(user, { code: '111111', createdAt: new Date(Date.now() - 120000) });
  await makeCode(user);
  assert.equal((await api.request('/auth/email/login', { method: 'POST', body: { email: user.email, code: '123456' } })).status, 200);
  assert.equal((await api.request('/auth/email/login', { method: 'POST', body: { email: user.email, code: '111111' } })).status, 400);
});

test('Postgres limiter admits exactly max concurrent requests and retains longer windows', async () => {
  const scope = id('limiter');
  const app = express();
  app.get('/', createRateLimiter({ name: scope, store: 'postgres', windowMs: 60000, max: 3 }), (_req, res) => res.sendStatus(204));
  const server = createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const statuses = await Promise.all(Array.from({ length: 12 }, async () => (await fetch(`http://127.0.0.1:${server.address().port}`)).status));
    assert.equal(statuses.filter(s => s === 204).length, 3);
    assert.equal(statuses.filter(s => s === 429).length, 9);
    await query(`INSERT INTO rate_limit_events(scope,key_hash,created_at,expires_at)
      VALUES($1,'long',now()-interval '3 minutes',now()+interval '12 minutes'),
            ($1,'expired',now()-interval '2 minutes',now()-interval '1 minute')`, [scope]);
    await pruneOldRateLimitEvents();
    assert.equal((await query('SELECT 1 FROM rate_limit_events WHERE scope=$1 AND key_hash=$2', [scope, 'long'])).rowCount, 1);
    assert.equal((await query('SELECT 1 FROM rate_limit_events WHERE scope=$1 AND key_hash=$2', [scope, 'expired'])).rowCount, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('database failure returns recoverable 503 rather than hanging, exposing SQL or rejecting credentials', async () => {
  const original = pool.query;
  pool.query = async () => { throw Object.assign(new Error('private database connection detail'), { code: 'ECONNREFUSED' }); };
  try {
    const token = signToken({ id: 'u-outage', email: 'outage@example.test' });
    for (const path of ['/health', '/bootstrap', '/me']) {
      const response = await api.request(path, { token });
      assert.equal(response.status, 503);
      const payload = await response.json();
      assert.doesNotMatch(payload.error, /private database/);
      assert.equal(payload.requestId, response.headers.get('x-request-id'));
    }
  } finally { pool.query = original; }
  assert.equal((await api.request('/health')).status, 200);
});

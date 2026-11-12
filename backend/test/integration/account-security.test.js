import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import jwt from 'jsonwebtoken';
import { WebSocket } from 'ws';
import { startTestApp, makeUser, makeCode, query, id } from './helpers.js';
import { hashPassword } from '../../src/auth.js';
import { config } from '../../src/config.js';
import { RealtimeHub } from '../../src/realtime.js';

let api;
const sentCodes = [];
let ipCounter = 0;
const freshIP = () => `198.51.100.${(++ipCounter % 250) + 1}`;
before(async () => {
  api = await startTestApp({ objectStorage: { removeImage: async () => {} },
    emailSender: async message => { sentCodes.push(message); } });
  // Lets each request choose its client IP through X-Forwarded-For.
  api.app.set('trust proxy', true);
});
after(async () => { await api.close(); });

function call(path, { method = 'GET', token, body, ip = freshIP() } = {}) {
  return fetch(`${api.base}${path}`, {
    method, signal: AbortSignal.timeout(15000),
    headers: { 'x-forwarded-for': ip, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
}
async function userWithPassword(password = 'old-password-1') {
  const user = await makeUser();
  await query('UPDATE users SET password_hash=$2 WHERE id=$1', [user.id, await hashPassword(password)]);
  return { ...user, password };
}
const meStatus = async token => (await call('/me', { token })).status;

test('F25: one IP cannot rotate through more than 10 addresses an hour', async () => {
  const ip = freshIP();
  for (let i = 0; i < 10; i++) {
    const response = await call('/auth/email/send-code', { method: 'POST', ip, body: { email: `rotate-${id()}@example.test`, purpose: 'login' } });
    assert.equal(response.status, 200, `request ${i + 1}`);
  }
  const blocked = await call('/auth/email/send-code', { method: 'POST', ip, body: { email: `rotate-${id()}@example.test`, purpose: 'login' } });
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).error, '验证码发送太频繁，请稍后再试');
});

test('F25: one address cannot be hit more than 5 times an hour by rotating IPs', async () => {
  const email = `target-${id()}@example.test`;
  for (let i = 0; i < 5; i++) {
    assert.equal((await call('/auth/email/send-code', { method: 'POST', body: { email, purpose: 'login' } })).status, 200);
  }
  assert.equal((await call('/auth/email/send-code', { method: 'POST', body: { email, purpose: 'login' } })).status, 429);
});

test('F31: one address gets at most 20 login attempts per 15 minutes across IPs', async () => {
  const email = `stuffing-${id()}@example.test`;
  for (let i = 0; i < 20; i++) {
    assert.equal((await call('/auth/login', { method: 'POST', body: { email, password: 'wrong-password' } })).status, 401);
  }
  assert.equal((await call('/auth/login', { method: 'POST', body: { email, password: 'wrong-password' } })).status, 429);
  assert.equal((await call('/auth/email/login', { method: 'POST', body: { email, password: 'wrong-password' } })).status, 429);
});

test('F11: reset codes do not reveal whether an account exists, and only real accounts get mail', async () => {
  const user = await makeUser(), nobody = `nobody-${id()}@example.test`;
  const known = await call('/auth/email/send-code', { method: 'POST', body: { email: user.email, purpose: 'reset' } });
  const unknown = await call('/auth/email/send-code', { method: 'POST', body: { email: nobody, purpose: 'reset' } });
  assert.equal(known.status, unknown.status);
  assert.deepEqual(await known.json(), await unknown.json());
  assert.ok(sentCodes.some(message => message.email === user.email && message.purpose === 'reset'));
  assert.ok(!sentCodes.some(message => message.email === nobody));
  // The mailed code completes the reset end to end.
  const { code } = sentCodes.findLast(message => message.email === user.email);
  const reset = await call('/auth/password/reset', { method: 'POST', body: { email: user.email, code, newPassword: 'mailed-password-1' } });
  assert.equal(reset.status, 200);
});

test('F11: password reset revokes old tokens and signs in with the new password', async () => {
  const user = await userWithPassword();
  assert.equal(await meStatus(user.token), 200);
  await makeCode(user, { purpose: 'reset' });
  const wrong = await call('/auth/password/reset', { method: 'POST', body: { email: user.email, code: '000000', newPassword: 'new-password-2' } });
  assert.equal(wrong.status, 400);
  await makeCode(user, { purpose: 'reset' });
  const response = await call('/auth/password/reset', { method: 'POST', body: { email: user.email, code: '123456', newPassword: 'new-password-2' } });
  assert.equal(response.status, 200);
  const { token } = await response.json();
  assert.equal(await meStatus(user.token), 401, 'old token is revoked');
  assert.equal(await meStatus(token), 200);
  assert.equal((await call('/auth/login', { method: 'POST', body: { email: user.email, password: 'new-password-2' } })).status, 200);
  assert.equal((await call('/auth/login', { method: 'POST', body: { email: user.email, password: user.password } })).status, 401);
});

test('F11: changing the password requires the current one and returns a replacement token', async () => {
  const user = await userWithPassword();
  const wrong = await call('/me/password', { method: 'POST', token: user.token, body: { currentPassword: 'not-it-123', newPassword: 'new-password-3' } });
  assert.equal(wrong.status, 401);
  assert.equal(await meStatus(user.token), 200, 'a failed attempt does not revoke');
  const response = await call('/me/password', { method: 'POST', token: user.token, body: { currentPassword: user.password, newPassword: 'new-password-3' } });
  assert.equal(response.status, 200);
  const { token } = await response.json();
  assert.equal(await meStatus(user.token), 401);
  assert.equal(await meStatus(token), 200);
});

test('F27: logout-all revokes every token; legacy tokens without tv keep working at version 0', async () => {
  const user = await makeUser();
  const legacy = jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, { expiresIn: '1h' });
  assert.equal(await meStatus(legacy), 200);
  assert.equal(jwt.decode(user.token).email, undefined, 'new tokens do not embed the email');
  assert.equal((await call('/auth/logout-all', { method: 'POST', token: user.token })).status, 204);
  assert.equal(await meStatus(user.token), 401);
  assert.equal(await meStatus(legacy), 401);
});

test('F27: a websocket is closed on the next heartbeat after the token is revoked', async () => {
  const user = await makeUser();
  const hub = new RealtimeHub();
  const server = http.createServer();
  hub.attach(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/api/ws`, { headers: { Authorization: `Bearer ${user.token}` } });
    await once(socket, 'message');
    await query('UPDATE users SET token_version = token_version + 1 WHERE id=$1', [user.id]);
    const closed = once(socket, 'close');
    await hub.checkConnections();
    await closed;
    assert.equal(socket.readyState, WebSocket.CLOSED);
  } finally { await hub.close(); await new Promise(resolve => server.close(resolve)); }
});

test('F28: deleting the account needs the password or a delete code', async () => {
  const user = await userWithPassword();
  assert.equal((await call('/me', { method: 'DELETE', token: user.token })).status, 400);
  assert.equal((await call('/me', { method: 'DELETE', token: user.token, body: { password: 'wrong-password' } })).status, 401);
  assert.equal((await call('/me', { method: 'DELETE', token: user.token, body: { code: '000000' } })).status, 401);
  assert.equal(await meStatus(user.token), 200, 'nothing was deleted');
  assert.equal((await call('/me', { method: 'DELETE', token: user.token, body: { password: user.password } })).status, 204);
  assert.equal(await meStatus(user.token), 401);
});

test('F28: delete codes are only issued to the signed-in owner', async () => {
  const user = await makeUser(), other = await makeUser();
  assert.equal((await call('/auth/email/send-code', { method: 'POST', body: { email: user.email, purpose: 'delete' } })).status, 401);
  assert.equal((await call('/auth/email/send-code', { method: 'POST', token: other.token, body: { email: user.email, purpose: 'delete' } })).status, 400);
  assert.equal((await call('/auth/email/send-code', { method: 'POST', token: user.token, body: { email: user.email, purpose: 'delete' } })).status, 200);
  // Passwordless accounts delete with the emailed code.
  await makeCode(user, { purpose: 'delete' });
  assert.equal((await call('/me', { method: 'DELETE', token: user.token, body: { password: 'anything-1' } })).status, 401);
  assert.equal((await call('/me', { method: 'DELETE', token: user.token, body: { code: '123456' } })).status, 204);
});

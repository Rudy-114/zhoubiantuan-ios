import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { RealtimeHub } from '../../src/realtime.js';
import { startTestApp, makeUser, query, id } from './helpers.js';

function message(socket) {
  return Promise.race([once(socket, 'message').then(([data]) => JSON.parse(data)),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Missing websocket hint')), 3000); timer.unref(); })]);
}
async function connect(url, token) {
  const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await message(socket)).type, 'connection.ready');
  return socket;
}
async function serverFor(hub) {
  const server = http.createServer();
  hub.attach(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, url: `ws://127.0.0.1:${server.address().port}/api/ws`,
    close: async () => { await hub.close(); await new Promise(resolve => server.close(resolve)); } };
}
test('websocket confirms auth, enforces caps, rechecks revoked accounts and propagates hints between instances', async () => {
  const app = await startTestApp();
  const a = new RealtimeHub({ maxPerUser: 1 });
  const b = new RealtimeHub();
  const first = await serverFor(a), second = await serverFor(b);
  try {
    a.distributed = b.distributed = true;
    await Promise.all([a.listenForHints(), b.listenForHints()]);
    const user = await makeUser();
    const one = await connect(first.url, user.token);
    const two = await connect(second.url, user.token);
    const rejected = new WebSocket(first.url, { headers: { Authorization: `Bearer ${user.token}` } });
    const [_, response] = await once(rejected, 'unexpected-response');
    assert.equal(response.statusCode, 429);
    rejected.on('error', () => {}); rejected.terminate();
    const local = message(one), remote = message(two);
    a.notifySyncEvents([{ id: '123', userID: user.id, eventType: 'test.updated', threadID: null }]);
    assert.equal((await local).cursor, '123');
    assert.equal((await remote).cursor, '123');
    await query("UPDATE users SET status='suspended' WHERE id=$1", [user.id]);
    const closed = once(one, 'close');
    await a.checkConnections();
    await closed;
    assert.equal(one.readyState, WebSocket.CLOSED);
    let terminated = false;
    b.send({ readyState: WebSocket.OPEN, bufferedAmount: 65537, terminate() { terminated = true; } }, {});
    assert.equal(terminated, true);
  } finally { await Promise.all([first.close(), second.close()]); await app.close(); }
});

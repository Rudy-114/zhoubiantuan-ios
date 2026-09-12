import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import test from "node:test";
import { WebSocket } from "ws";
import { attachRealtime, createRealtimeHub, realtimeHub } from "../src/realtime.js";

const silentLogger = {
  info() {}
};

test("authenticated websocket receives a sync.available notification", async (t) => {
  const hub = createRealtimeHub({
    authenticate: async (token) => (token === "valid-token" ? { id: "user-1" } : null),
    heartbeatIntervalMs: 60000,
    logger: silentLogger
  });
  const server = http.createServer();
  const clients = [];
  registerHubCleanup(t, hub, [server], clients);
  hub.attach(server);
  await listen(server);

  const socket = new WebSocket(websocketURL(server), {
    headers: { authorization: "Bearer valid-token" }
  });
  clients.push(socket);
  await withTimeout(once(socket, "open"), 500, "websocket did not open");

  hub.notifySyncEvents([
    {
      userID: "user-1",
      id: 42,
      eventType: "message.created",
      threadID: "thread-1"
    }
  ]);

  const [data] = await withTimeout(once(socket, "message"), 500, "sync notification was not received");
  assert.deepEqual(JSON.parse(data.toString()), {
    type: "sync.available",
    cursor: 42,
    eventType: "message.created",
    threadID: "thread-1"
  });
});

test("invalid websocket token receives HTTP 401 during upgrade", async (t) => {
  const hub = createRealtimeHub({
    authenticate: async () => null,
    heartbeatIntervalMs: 60000,
    logger: silentLogger
  });
  const server = http.createServer();
  const clients = [];
  registerHubCleanup(t, hub, [server], clients);
  hub.attach(server);
  await listen(server);

  const socket = new WebSocket(websocketURL(server), {
    headers: { authorization: "Bearer invalid-token" }
  });
  clients.push(socket);
  const statusCode = await withTimeout(new Promise((resolve, reject) => {
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode);
    });
    socket.once("error", reject);
  }), 500, "websocket upgrade was not rejected");

  assert.equal(statusCode, 401);
});

test("attaching twice to the same server does not corrupt a valid client", async (t) => {
  const hub = createRealtimeHub({
    authenticate: async () => ({ id: "user-1" }),
    heartbeatIntervalMs: 60000,
    logger: silentLogger
  });
  const server = http.createServer();
  const clients = [];
  registerHubCleanup(t, hub, [server], clients);
  hub.attach(server);
  hub.attach(server);
  await listen(server);

  const socket = new WebSocket(websocketURL(server), {
    headers: { authorization: "Bearer valid-token" }
  });
  clients.push(socket);
  await withTimeout(once(socket, "open"), 500, "websocket did not open after duplicate attach");

  hub.notifySyncEvents([
    {
      userID: "user-1",
      id: 43,
      eventType: "post.updated",
      threadID: null
    }
  ]);

  const [data] = await withTimeout(
    once(socket, "message"),
    500,
    "duplicate attach corrupted the websocket connection"
  );
  assert.deepEqual(JSON.parse(data.toString()), {
    type: "sync.available",
    cursor: 43,
    eventType: "post.updated",
    threadID: null
  });
});

test("close during delayed authentication destroys the pending socket and allows server shutdown", async (t) => {
  const authenticationStarted = deferred();
  const releaseAuthentication = deferred();
  const hub = createRealtimeHub({
    authenticate: async () => {
      authenticationStarted.resolve();
      await releaseAuthentication.promise;
      return { id: "user-1" };
    },
    heartbeatIntervalMs: 60000,
    logger: silentLogger
  });
  const server = http.createServer();
  const clients = [];
  registerHubCleanup(t, hub, [server], clients);
  hub.attach(server);
  await listen(server);

  const client = net.createConnection({ host: "127.0.0.1", port: server.address().port });
  clients.push(client);
  client.on("error", () => {});
  await withTimeout(once(client, "connect"), 500, "upgrade client did not connect");
  const clientClosed = new Promise((resolve) => client.once("close", resolve));
  client.write(websocketUpgradeRequest(server));
  await withTimeout(authenticationStarted.promise, 500, "authentication did not start");

  let serverClosed;
  try {
    const hubClosed = hub.close();
    serverClosed = closeServer(server);
    await withTimeout(
      Promise.all([Promise.resolve(hubClosed), clientClosed, serverClosed]),
      500,
      "hub close did not destroy the pending upgrade and close the server"
    );
  } finally {
    client.destroy();
    releaseAuthentication.resolve();
    if (serverClosed) {
      await withTimeout(serverClosed, 1000, "server did not close after fallback cleanup");
    }
  }
});

test("repeated close returns the same Promise and settles", async (t) => {
  const hub = createRealtimeHub({ logger: silentLogger });
  t.after(async () => {
    await withTimeout(hub.close(), 1000, "hub cleanup timed out");
  });

  const firstClose = hub.close();
  const secondClose = hub.close();

  assert.ok(firstClose instanceof Promise, "close must return a Promise");
  assert.strictEqual(secondClose, firstClose);
  await withTimeout(firstClose, 500, "close Promise did not settle");
});

test("hub rejects attaching to a different server", async (t) => {
  const hub = createRealtimeHub({ logger: silentLogger });
  const firstServer = http.createServer();
  const secondServer = http.createServer();
  registerHubCleanup(t, hub, [firstServer, secondServer]);

  hub.attach(firstServer);

  assert.throws(() => hub.attach(secondServer), /different server/i);
});

test("hub rejects attach after close", async (t) => {
  const hub = createRealtimeHub({ logger: silentLogger });
  const server = http.createServer();
  registerHubCleanup(t, hub, [server]);

  await hub.close();

  assert.throws(() => hub.attach(server), /closed/i);
});

test("attachRealtime with options returns an isolated hub", async (t) => {
  const server = http.createServer();
  let hub;
  t.after(async () => {
    if (hub) {
      await withTimeout(hub.close(), 1000, "isolated hub cleanup timed out");
    }
    if (server.listening) {
      await withTimeout(closeServer(server), 1000, "isolated server cleanup timed out");
    }
  });

  hub = attachRealtime(server, {
    authenticate: async () => ({ id: "user-1" }),
    heartbeatIntervalMs: 60000,
    logger: silentLogger
  });

  assert.notStrictEqual(hub, realtimeHub);
  const hubClosed = hub.close();
  assert.ok(hubClosed instanceof Promise, "isolated hub cleanup must be awaitable");
  await withTimeout(hubClosed, 500, "isolated hub did not close");
});

test("attachRealtime without options returns the realtimeHub singleton", async (t) => {
  const server = http.createServer();
  t.after(async () => {
    await withTimeout(realtimeHub.close(), 1000, "singleton hub cleanup timed out");
    if (server.listening) {
      await withTimeout(closeServer(server), 1000, "singleton server cleanup timed out");
    }
  });

  const hub = attachRealtime(server);

  assert.strictEqual(hub, realtimeHub);
  const hubClosed = hub.close();
  assert.ok(hubClosed instanceof Promise, "singleton hub cleanup must be awaitable");
  await withTimeout(hubClosed, 500, "singleton hub did not close");
});

async function listen(server) {
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await withTimeout(listening, 500, "server did not start listening");
}

function websocketURL(server) {
  const { port } = server.address();
  return `ws://127.0.0.1:${port}/api/ws`;
}

function websocketUpgradeRequest(server) {
  const { port } = server.address();
  return [
    "GET /api/ws HTTP/1.1",
    `Host: 127.0.0.1:${port}`,
    "Connection: Upgrade",
    "Upgrade: websocket",
    "Sec-WebSocket-Version: 13",
    "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
    "Authorization: Bearer valid-token",
    "",
    ""
  ].join("\r\n");
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function registerHubCleanup(t, hub, servers, clients = []) {
  t.after(async () => {
    let closeError;
    try {
      await withTimeout(hub.close(), 1000, "hub cleanup timed out");
    } catch (error) {
      closeError = error;
    }
    try {
      for (const client of clients) {
        destroyClient(client);
      }
      for (const server of servers) {
        if (server.listening) {
          await withTimeout(closeServer(server), 1000, "server cleanup timed out");
        }
      }
    } finally {
      if (closeError) throw closeError;
    }
  });
}

function destroyClient(client) {
  if (typeof client.terminate === "function") {
    client.on("error", () => {});
    if (client.readyState !== WebSocket.CLOSED) {
      client.terminate();
    }
    return;
  }
  client.destroy();
}

async function withTimeout(promise, timeoutMs, message) {
  let timeout;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

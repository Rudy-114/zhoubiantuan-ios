import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";
import test from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";
import * as websocketVerifier from "../scripts/verify-websocket.mjs";

const { verifyWebSocket, websocketHeaders } = websocketVerifier;

const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const addressUrl = (server, protocol) => `${protocol}://127.0.0.1:${server.address().port}`;

test("websocket smoke token is supplied only as an authorization header", () => {
  assert.deepEqual(websocketHeaders("secret-test-token"), {
    Authorization: "Bearer secret-test-token",
  });
  assert.throws(() => websocketHeaders(""), /WS_TEST_TOKEN/);
});

test("rejects an HTTP 401 upgrade and drains the response", async (t) => {
  const server = http.createServer();
  server.on("upgrade", (_request, socket) => {
    socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  });
  await listen(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  await assert.rejects(
    verifyWebSocket(addressUrl(server, "ws"), "local-test-token", 500),
    /HTTP 401/
  );
});

test("times out a stalled handshake and closes the client socket", { timeout: 2000 }, async (t) => {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.resume();
    socket.once("close", () => sockets.delete(socket));
  });
  await listen(server);
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise((resolve) => server.close(resolve));
  });

  await assert.rejects(
    verifyWebSocket(addressUrl(server, "ws"), "local-test-token", 30),
    /timed out/
  );
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error("stalled WebSocket socket remained open")), 500);
    const check = () => {
      if (sockets.size === 0) {
        clearTimeout(deadline);
        resolve();
      } else {
        setImmediate(check);
      }
    };
    check();
  });
});

test("closes a successful connection when the peer ignores the close frame", { timeout: 2000 }, async (t) => {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    let request = "";
    socket.on("data", (chunk) => {
      request += chunk.toString("ascii");
      if (!request.includes("\r\n\r\n")) return;
      const key = request.match(/^Sec-WebSocket-Key: (.+)$/im)?.[1];
      const accept = crypto
        .createHash("sha1")
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
      );
      socket.removeAllListeners("data");
      socket.resume();
    });
    socket.once("close", () => sockets.delete(socket));
  });
  await listen(server);
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise((resolve) => server.close(resolve));
  });

  const url = addressUrl(server, "ws");
  const started = Date.now();
  assert.deepEqual(await verifyWebSocket(url, "local-test-token", 100), { ok: true, url });
  assert.ok(Date.now() - started < 1000);
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error("ignored-close WebSocket socket remained open")), 500);
    const check = () => {
      if (sockets.size === 0) {
        clearTimeout(deadline);
        resolve();
      } else {
        setImmediate(check);
      }
    };
    check();
  });
});

test("resolves and closes normally after a successful local WebSocket handshake", { timeout: 2000 }, async (t) => {
  const server = http.createServer();
  const webSocketServer = new WebSocketServer({ noServer: true });
  let connectedSocket;
  webSocketServer.on("connection", (socket) => {
    connectedSocket = socket;
  });
  server.on("upgrade", (request, socket, head) => {
    webSocketServer.handleUpgrade(request, socket, head, (client) => {
      webSocketServer.emit("connection", client, request);
    });
  });
  await listen(server);
  t.after(() => {
    connectedSocket?.close();
    webSocketServer.close();
    return new Promise((resolve) => server.close(resolve));
  });

  const url = addressUrl(server, "ws");
  assert.deepEqual(await verifyWebSocket(url, "local-test-token", 500), { ok: true, url });
});

test("rejects direct connection errors without exposing connection details", async (t) => {
  const server = net.createServer();
  t.after(() => {
    if (!server.listening) return;
    return new Promise((resolve) => server.close(resolve));
  });
  await listen(server);
  const url = addressUrl(server, "ws");
  await new Promise((resolve) => server.close(resolve));

  await assert.rejects(verifyWebSocket(url, "local-test-token", 200), /WebSocket connection failed/);
});

test("validates WebSocket URLs without echoing unsafe credentials", () => {
  const validUrl = "wss://api.example.test/api/ws";
  assert.equal(websocketVerifier.validateWebSocketUrl(validUrl), validUrl);
  for (const unsafeUrl of [
    "https://api.example.test/api/ws",
    "wss://user:password@api.example.test/api/ws",
    "wss://api.example.test/api/ws?token=credential",
    "wss://api.example.test/api/ws#credential",
  ]) {
    assert.throws(
      () => websocketVerifier.validateWebSocketUrl(unsafeUrl),
      (error) => error instanceof Error && !error.message.includes(unsafeUrl)
    );
  }
});

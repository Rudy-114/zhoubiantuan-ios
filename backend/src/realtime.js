import { randomUUID } from "node:crypto";
import pg from "pg";
import { WebSocketServer, WebSocket } from "ws";
import { userForToken } from "./auth.js";
import { pool, query } from "./db.js";
import { logger } from "./logger.js";

const CHANNEL = "zbt_sync_hints";
export class RealtimeHub {
  constructor({ authenticate = userForToken, maxConnections = 2000, maxPerUser = 4, maxPending = 32,
    maxBufferedBytes = 65536, heartbeatMs = 30000, distributed = false } = {}) {
    Object.assign(this, { authenticate, maxConnections, maxPerUser, maxPending, maxBufferedBytes, heartbeatMs, distributed });
    this.connectionsByUserID = new Map();
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
    this.pending = 0;
    this.closed = false;
    this.instanceID = randomUUID();
    this.wss.on("connection", (socket, _request, user, token) => this.addConnection(user.id, socket, token));
  }

  attach(server) {
    this.upgrade = async (request, socket, head) => {
      if (this.closed || request.url?.split("?")[0] !== "/api/ws") return socket.destroy();
      if (this.pending >= this.maxPending || this.wss.clients.size >= this.maxConnections) return rejectUpgrade(socket, 503);
      this.pending += 1;
      const deadline = setTimeout(() => socket.destroy(), 10000);
      try {
        const token = (request.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1] || "";
        const user = await this.authenticate(token);
        if (socket.destroyed || this.closed) return;
        if (!user) return rejectUpgrade(socket, 401);
        if (this.wss.clients.size >= this.maxConnections || (this.connectionsByUserID.get(user.id)?.size || 0) >= this.maxPerUser) {
          return rejectUpgrade(socket, 429);
        }
        this.wss.handleUpgrade(request, socket, head, ws => this.wss.emit("connection", ws, request, user, token));
      } catch (error) {
        if (!socket.destroyed) rejectUpgrade(socket, 503);
        logger.warn("websocket.authentication_unavailable", { code: error.code });
      } finally { clearTimeout(deadline); this.pending -= 1; }
    };
    server.on("upgrade", this.upgrade);
    this.server = server;
    this.heartbeat = setInterval(() => void this.checkConnections(), this.heartbeatMs);
    this.heartbeat.unref();
    if (this.distributed) void this.listenForHints();
    return this;
  }

  addConnection(userID, socket, token) {
    socket.isAlive = true;
    socket.userID = userID;
    socket.authToken = token;
    const sockets = this.connectionsByUserID.get(userID) || new Set();
    sockets.add(socket);
    this.connectionsByUserID.set(userID, sockets);
    socket.on("pong", () => { socket.isAlive = true; });
    socket.on("close", () => {
      sockets.delete(socket);
      if (!sockets.size) this.connectionsByUserID.delete(userID);
      socket.authToken = undefined;
    });
    socket.on("error", () => socket.terminate());
    // A receipt proves the authenticated handshake completed; resume() alone does not.
    this.send(socket, { type: "connection.ready" });
  }

  async checkConnections() {
    if (this.checking || this.closed) return;
    this.checking = true;
    try {
      // Bound database concurrency even when thousands of sockets share the heartbeat.
      const sockets = [...this.wss.clients];
      for (let i = 0; i < sockets.length; i += 8) {
        await Promise.all(sockets.slice(i, i + 8).map(async socket => {
          if (this.closed || !socket.isAlive || socket.bufferedAmount > this.maxBufferedBytes) return socket.terminate();
          try {
            const user = await this.authenticate(socket.authToken);
            if (!user || user.id !== socket.userID) return socket.terminate();
            if (socket.readyState !== WebSocket.OPEN) return;
            socket.isAlive = false;
            socket.ping(undefined, undefined, error => { if (error) socket.terminate(); });
          } catch { socket.terminate(); }
        }));
      }
    } finally { this.checking = false; }
  }

  notifySyncEvents(events, publish = true) {
    for (const event of events) {
      const payload = { type: "sync.available", cursor: event.id, eventType: event.eventType, threadID: event.threadID };
      const groups = event.userID == null ? this.connectionsByUserID.values() : [this.connectionsByUserID.get(event.userID) || []];
      for (const sockets of groups) for (const socket of sockets) this.send(socket, payload);
      if (publish && this.distributed && !this.closed) {
        // Called only after the business transaction commits. Hints contain no message body.
        void query("SELECT pg_notify($1, $2)", [CHANNEL, JSON.stringify({ source: this.instanceID,
          event: { id: event.id, userID: event.userID, eventType: event.eventType, threadID: event.threadID } })])
          .catch(error => logger.warn("websocket.publish_failed", { code: error.code }));
      }
    }
  }

  send(socket, payload) {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > this.maxBufferedBytes) return socket.terminate();
    socket.send(JSON.stringify(payload), error => { if (error) socket.terminate(); });
  }

  async listenForHints() {
    if (this.closed) return;
    const client = new pg.Client(pool.options);
    this.listener = client;
    let failed = false;
    const recover = () => {
      if (failed) return;
      failed = true;
      void client.end().catch(() => {});
      if (!this.closed) {
        logger.warn("websocket.listener_reconnecting");
        this.listenerRetry = setTimeout(() => void this.listenForHints(), 5000 + Math.random() * 5000);
        this.listenerRetry.unref();
      }
    };
    client.on("error", recover);
    client.on("end", recover);
    client.on("notification", ({ channel, payload }) => {
      if (channel !== CHANNEL) return;
      try {
        const hint = JSON.parse(payload);
        if (hint.source !== this.instanceID && hint.event?.id) this.notifySyncEvents([hint.event], false);
      } catch { logger.warn("websocket.invalid_hint"); }
    });
    try {
      await client.connect();
      if (this.closed) return void client.end();
      await client.query(`LISTEN ${CHANNEL}`);
    } catch { recover(); }
  }

  async close() {
    this.closed = true;
    clearInterval(this.heartbeat);
    clearTimeout(this.listenerRetry);
    this.server?.off("upgrade", this.upgrade);
    for (const socket of this.wss.clients) socket.terminate();
    await Promise.all([new Promise(resolve => this.wss.close(resolve)), this.listener?.end().catch(() => {})]);
  }
}

function rejectUpgrade(socket, status) {
  const reason = { 401: "Unauthorized", 429: "Too Many Requests", 503: "Service Unavailable" }[status];
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
export const realtimeHub = new RealtimeHub({ distributed: true });
export function attachRealtime(server) { return realtimeHub.attach(server); }
export function notifySyncEvents(events) {
  // Tests create HTTP applications without attaching a hub; no live listener or publication then.
  if (realtimeHub.server) realtimeHub.notifySyncEvents(events);
}

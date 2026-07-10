import { WebSocketServer, WebSocket } from "ws";
import { userForToken } from "./auth.js";
import { logger } from "./logger.js";

const WS_PATH = "/api/ws";

export class RealtimeHub {
  constructor({
    authenticate = userForToken,
    heartbeatIntervalMs = 30000,
    logger: eventLogger = logger
  } = {}) {
    this.authenticate = authenticate;
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.logger = eventLogger;
    this.connectionsByUserID = new Map();
    this.wss = new WebSocketServer({ noServer: true });
    this.heartbeat = null;
    this.state = "open";
    this.attachedServer = null;
    this.pendingUpgradeSockets = new Set();
    this.closePromise = null;
    this.upgradeHandler = this.handleUpgrade.bind(this);

    this.wss.on("connection", (socket, _request, user) => {
      this.addConnection(user.id, socket);
    });
  }

  attach(server) {
    if (this.state !== "open") {
      throw new Error("Cannot attach a closed realtime hub");
    }
    if (this.attachedServer) {
      if (this.attachedServer === server) return;
      throw new Error("Realtime hub is already attached to a different server");
    }

    this.attachedServer = server;
    server.on("upgrade", this.upgradeHandler);
    this.startHeartbeat();
  }

  close() {
    if (this.closePromise) return this.closePromise;
    this.state = "closing";
    if (this.attachedServer) {
      this.attachedServer.off("upgrade", this.upgradeHandler);
      this.attachedServer = null;
    }
    clearInterval(this.heartbeat);
    this.heartbeat = null;
    const pendingSocketClosures = Array.from(this.pendingUpgradeSockets, destroySocketAndWait);
    this.pendingUpgradeSockets.clear();
    for (const socket of this.wss.clients) {
      socket.terminate();
    }
    this.connectionsByUserID.clear();
    this.closePromise = Promise.all([
      closeWebSocketServer(this.wss),
      ...pendingSocketClosures
    ]).finally(() => {
      this.state = "closed";
    });
    return this.closePromise;
  }

  async handleUpgrade(request, socket, head) {
    if (this.state !== "open") {
      socket.destroy();
      return;
    }
    let url;
    try {
      url = new URL(request.url || "", "http://localhost");
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== WS_PATH) {
      socket.destroy();
      return;
    }

    const removePendingSocket = () => this.pendingUpgradeSockets.delete(socket);
    this.pendingUpgradeSockets.add(socket);
    socket.once("close", removePendingSocket);
    try {
      const token = tokenFromRequest(request);
      const user = await this.authenticate(token);
      if (this.state !== "open" || socket.destroyed) {
        socket.destroy();
        return;
      }
      if (!user) {
        rejectUpgrade(socket);
        return;
      }
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit("connection", ws, request, user);
      });
    } catch {
      if (this.state === "open" && !socket.destroyed) {
        rejectUpgrade(socket);
      } else {
        socket.destroy();
      }
    } finally {
      socket.off("close", removePendingSocket);
      this.pendingUpgradeSockets.delete(socket);
    }
  }

  notifySyncEvents(events) {
    for (const event of events) {
      this.sendToUser(event.userID, {
        type: "sync.available",
        cursor: event.id,
        eventType: event.eventType,
        threadID: event.threadID
      });
    }
  }

  addConnection(userID, socket) {
    socket.isAlive = true;
    socket.userID = userID;
    let sockets = this.connectionsByUserID.get(userID);
    if (!sockets) {
      sockets = new Set();
      this.connectionsByUserID.set(userID, sockets);
    }
    sockets.add(socket);
    this.logger.info("websocket.connected", { userID, active: sockets.size });

    socket.on("pong", () => {
      socket.isAlive = true;
    });
    socket.on("close", () => {
      this.removeConnection(userID, socket);
    });
    socket.on("error", () => {
      this.removeConnection(userID, socket);
    });
  }

  removeConnection(userID, socket) {
    const sockets = this.connectionsByUserID.get(userID);
    if (!sockets) return;
    sockets.delete(socket);
    if (!sockets.size) {
      this.connectionsByUserID.delete(userID);
    }
    this.logger.info("websocket.disconnected", { userID, active: sockets.size });
  }

  sendToUser(userID, payload) {
    const sockets = this.connectionsByUserID.get(userID);
    if (!sockets?.size) return;
    const data = JSON.stringify(payload);
    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(data);
      }
    }
  }

  startHeartbeat() {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      for (const socket of this.wss.clients) {
        if (socket.isAlive === false) {
          socket.terminate();
          continue;
        }
        socket.isAlive = false;
        socket.ping();
      }
    }, this.heartbeatIntervalMs);
    this.wss.on("close", () => clearInterval(this.heartbeat));
  }
}

function tokenFromRequest(request) {
  const header = request.headers.authorization || "";
  const [, headerToken] = header.match(/^Bearer\s+(.+)$/i) || [];
  return headerToken || "";
}

function rejectUpgrade(socket) {
  socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
  socket.destroy();
}

function destroySocketAndWait(socket) {
  return new Promise((resolve) => {
    socket.once("close", resolve);
    socket.destroy();
  });
}

function closeWebSocketServer(wss) {
  return new Promise((resolve, reject) => {
    wss.close((error) => (error ? reject(error) : resolve()));
  });
}

export function createRealtimeHub(options = {}) {
  return new RealtimeHub(options);
}

export const realtimeHub = createRealtimeHub();

export function attachRealtime(server, options = undefined) {
  const hub = options === undefined ? realtimeHub : createRealtimeHub(options);
  hub.attach(server);
  return hub;
}

export function notifySyncEvents(events) {
  realtimeHub.notifySyncEvents(events);
}

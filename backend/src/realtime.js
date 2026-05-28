import { WebSocketServer, WebSocket } from "ws";
import { userForToken } from "./auth.js";

const HEARTBEAT_INTERVAL_MS = 30000;
const WS_PATH = "/api/ws";

class RealtimeHub {
  constructor() {
    this.connectionsByUserID = new Map();
    this.wss = new WebSocketServer({ noServer: true });
    this.heartbeat = null;

    this.wss.on("connection", (socket, _request, user) => {
      this.addConnection(user.id, socket);
    });
  }

  attach(server) {
    server.on("upgrade", async (request, socket, head) => {
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

      try {
        const token = tokenFromRequest(request, url);
        const user = await userForToken(token);
        if (!user) {
          rejectUpgrade(socket);
          return;
        }
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit("connection", ws, request, user);
        });
      } catch {
        rejectUpgrade(socket);
      }
    });

    this.startHeartbeat();
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
    console.log(`WebSocket connected user=${userID} active=${sockets.size}`);

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
    console.log(`WebSocket disconnected user=${userID} active=${sockets.size}`);
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
    }, HEARTBEAT_INTERVAL_MS);
    this.wss.on("close", () => clearInterval(this.heartbeat));
  }
}

function tokenFromRequest(request, url) {
  const header = request.headers.authorization || "";
  const [, headerToken] = header.match(/^Bearer\s+(.+)$/i) || [];
  return headerToken || url.searchParams.get("token") || "";
}

function rejectUpgrade(socket) {
  socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
  socket.destroy();
}

export const realtimeHub = new RealtimeHub();

export function attachRealtime(server) {
  realtimeHub.attach(server);
}

export function notifySyncEvents(events) {
  realtimeHub.notifySyncEvents(events);
}

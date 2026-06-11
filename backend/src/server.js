import http from "node:http";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { startRateLimitEventPruner } from "./rateLimit.js";
import { attachRealtime } from "./realtime.js";
import { startSyncEventPruner } from "./sync.js";

const app = createApp();
const server = http.createServer(app);

attachRealtime(server);
startRateLimitEventPruner();
startSyncEventPruner();

server.listen(config.port, "0.0.0.0", () => {
  logger.info("server.started", { port: config.port });
});

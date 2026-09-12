import http from "node:http";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { logger } from "./logger.js";
import { startRateLimitEventPruner } from "./rateLimit.js";
import { attachRealtime } from "./realtime.js";
import { startSyncEventPruner } from "./sync.js";
import { startUploadPruner } from "./uploads.js";
import { pruneModerationReceipts } from "./moderation/budget.js";
import { objectStorage } from "./oss.js";

const server = http.createServer(createApp());
server.requestTimeout = 60000;
server.headersTimeout = 15000;
server.keepAliveTimeout = 5000;
server.maxRequestsPerSocket = 1000;
const hub = attachRealtime(server);
const timers = [startRateLimitEventPruner(), startSyncEventPruner(), startUploadPruner(objectStorage),
  setInterval(() => void pruneModerationReceipts().catch(error => logger.error("moderation.prune_failed", { error })), 3600000)];
for (const timer of timers) timer.unref();
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("server.stopping", { signal });
  for (const timer of timers) clearInterval(timer);
  const deadline = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 25000);
  deadline.unref();
  try {
    await Promise.all([hub.close(), new Promise(resolve => server.close(resolve))]);
    await pool.end();
    clearTimeout(deadline);
    logger.info("server.stopped");
  } catch (error) { logger.error("server.shutdown_failed", { error }); process.exitCode = 1; }
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
server.on("error", error => { logger.error("server.error", { error }); void shutdown("server.error"); process.exitCode = 1; });
server.listen(config.port, "0.0.0.0", () => logger.info("server.started", { port: config.port }));

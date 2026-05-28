import http from "node:http";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { attachRealtime } from "./realtime.js";

const app = createApp();
const server = http.createServer(app);

attachRealtime(server);

server.listen(config.port, "0.0.0.0", () => {
  console.log(`ZhouBianTuan API listening on ${config.port}`);
});

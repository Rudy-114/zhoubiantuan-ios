import cors from "cors";
import compression from "compression";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { isDatabaseUnavailable } from "./http.js";
import { PRIVACY_POLICY_PATHS, servePrivacyPolicy } from "./legal.js";
import { logger } from "./logger.js";
import { createRouter } from "./routes.js";

export function createApp(options = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader("X-Request-ID", req.requestId);
    next();
  });
  app.use(helmet());
  app.use(cors());
  app.use(compression({ threshold: 1024 }));
  const jsonParser = express.json({ limit: "128kb" });
  app.use((req, res, next) => req.method === "PUT" && req.path.startsWith("/api/uploads/") ? next() : jsonParser(req, res, next));
  morgan.token("safe-path", req => req.path.replace(/\/uploads\/[a-f0-9]{64}/g, "/uploads/[ticket]"));
  app.use(morgan(":method :safe-path :status :res[content-length] - :response-time ms"));
  app.get(PRIVACY_POLICY_PATHS, servePrivacyPolicy);
  app.use("/api", createRouter(options));
  app.get("/", (_req, res) => res.json({ name: "ZhouBianTuan API", ok: true }));
  app.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.path}` }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = isDatabaseUnavailable(error) ? 503 : (error.status || 500);
    if (status >= 500) {
      logger.error("request.error", { error, requestId: req.requestId, method: req.method, path: req.path.replace(/\/uploads\/[a-f0-9]{64}/g, "/uploads/[ticket]"), status });
    }
    const body = { error: status >= 500 ? "服务暂时不可用，请稍后重试" : error.message || "请求失败", requestId: req.requestId };
    if (error.apiCode) body.code = error.apiCode;
    res.status(status).json(body);
  });
  return app;
}

import cors from "cors";
import compression from "compression";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { createAdminAuthRouter } from "./admin/authRoutes.js";
import { createAdminCaseRouter } from "./admin/caseRoutes.js";
import { createAdminModerationRouter } from "./admin/moderationRoutes.js";
import { PRIVACY_POLICY_PATHS, servePrivacyPolicy } from "./legal.js";
import { logger } from "./logger.js";
import { createRouter } from "./routes.js";

export function createApp({ adminCaseRouterOptions } = {}) {
  const app = express();
  app.set("trust proxy", "loopback");
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(compression({ threshold: 1024 }));
  app.use(morgan("tiny"));
  app.use(
    "/admin/api",
    (_req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      next();
    },
    express.json({ limit: "256kb" }),
    createAdminAuthRouter(),
    createAdminCaseRouter(adminCaseRouterOptions),
    createAdminModerationRouter(),
    (req, res) => res.status(404).json({
      error: `No admin route for ${req.method} ${req.path}`,
      code: "admin_route_not_found"
    })
  );
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));
  app.get(PRIVACY_POLICY_PATHS, servePrivacyPolicy);
  app.use("/api", createRouter());
  app.get("/", (_req, res) => res.json({ name: "ZhouBianTuan API", ok: true }));
  app.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.path}` }));
  app.use((error, req, res, _next) => {
    const isAdminRequest = req.originalUrl?.startsWith("/admin/api");
    let status = error.status || 500;
    let apiCode = error.apiCode;
    let message = error.message || "服务暂时不可用";
    if (isAdminRequest && status === 413) {
      status = 413;
      apiCode = "admin_payload_too_large";
      message = "管理员请求体过大";
    } else if (isAdminRequest && error instanceof SyntaxError && status === 400) {
      apiCode = "admin_json_invalid";
      message = "管理员请求 JSON 无效";
    } else if (isAdminRequest && status >= 500 && !apiCode) {
      message = "管理员服务暂时不可用";
      apiCode = "admin_internal_error";
    }
    if (status >= 500) {
      logger.error("request.error", { error, method: req.method, path: req.path, status });
    }
    const body = { error: message };
    if (apiCode) body.code = apiCode;
    res.status(status).json(body);
  });
  return app;
}

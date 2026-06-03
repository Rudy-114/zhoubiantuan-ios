import cors from "cors";
import compression from "compression";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { createRouter } from "./routes.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors());
  app.use(compression({ threshold: 1024 }));
  app.use(express.json({ limit: "2mb" }));
  app.use(morgan("tiny"));
  app.use("/api", createRouter());
  app.get("/", (_req, res) => res.json({ name: "ZhouBianTuan API", ok: true }));
  app.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.path}` }));
  app.use((error, _req, res, _next) => {
    const status = error.status || 500;
    if (status >= 500) {
      console.error(error);
    }
    res.status(status).json({ error: error.message || "服务暂时不可用" });
  });
  return app;
}

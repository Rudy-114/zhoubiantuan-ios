import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const adminWebDirectory = path.resolve(currentDirectory, "../../admin-web");
const indexPath = path.join(adminWebDirectory, "index.html");

export const ADMIN_WEB_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'"
].join("; ");

export function createAdminWebRouter({ enabled = config.admin.webEnabled } = {}) {
  const router = express.Router();
  if (!enabled) {
    router.use("/admin", (_req, res) => res.status(404).json({
      error: "管理员网页未启用",
      code: "admin_disabled"
    }));
    return router;
  }

  router.use(
    "/admin",
    adminWebHeaders,
    express.static(adminWebDirectory, {
      fallthrough: true,
      index: false,
      redirect: false,
      setHeaders(res) {
        res.setHeader("Cache-Control", "no-store");
      }
    })
  );
  router.get(["/admin", "/admin/*"], adminWebHeaders, (_req, res, next) => {
    res.sendFile(indexPath, (error) => {
      if (error) next(error);
    });
  });
  return router;
}

function adminWebHeaders(_req, res, next) {
  res.setHeader("Content-Security-Policy", ADMIN_WEB_CSP);
  res.setHeader("Cache-Control", "no-store");
  next();
}

import express from "express";
import { Readable } from "node:stream";
import { requireAdminSession } from "./adminMiddleware.js";
import { canReadAsset } from "../assets.js";
import { objectStorage } from "../oss.js";
import { asyncRoute } from "../http.js";

export function createAdminAssetRouter(storage = objectStorage) {
  const router = express.Router();
  router.get("/assets/*", requireAdminSession, asyncRoute(async (req, res, next) => {
    const key = String(req.params[0] || "");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Vary", "Cookie");
    if (!(await canReadAsset(key, null, true))) return res.status(404).end();
    const upstream = await storage.readImage(key);
    if (!upstream.ok || !upstream.body) return res.status(upstream.status || 404).end();
    const contentType = upstream.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    res.setHeader("Content-Type", ["image/jpeg", "image/png", "image/webp"].includes(contentType) ? contentType : "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    Readable.fromWeb(upstream.body).on("error", next).pipe(res);
  }));
  return router;
}

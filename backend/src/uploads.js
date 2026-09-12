import { createHash, randomBytes, randomUUID } from "node:crypto";
import express from "express";
import sharp from "sharp";
import { config } from "./config.js";
import { query, withTransaction } from "./db.js";
import { asyncRoute } from "./http.js";
import { concurrencyGate } from "./concurrency.js";
import { badRequest } from "./validators.js";
import { publicAssetUrl } from "./oss.js";
import { logger } from "./logger.js";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const imageGate = concurrencyGate(2);
const types = new Map([["image/jpeg", "jpeg"], ["image/png", "png"], ["image/webp", "webp"]]);
const hash = value => createHash("sha256").update(value).digest("hex");

export async function issueUploadTicket(userId, body) {
  const contentType = String(body.contentType || "").toLowerCase();
  if (!types.has(contentType)) throw badRequest("仅支持上传 JPEG / PNG / WebP 图片");
  if (!["post", "avatar", "background", "message"].includes(body.kind)) throw badRequest("上传类型无效");
  const token = randomBytes(32).toString("hex");
  const key = `guarded/${body.kind}/${userId}/${randomUUID()}.jpg`;
  await withTransaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`upload:${userId}`]);
    const { rows } = await client.query(`SELECT count(*) AS count FROM upload_tickets
      WHERE user_id = $1 AND created_at > clock_timestamp() - interval '1 day'`, [userId]);
    if (Number(rows[0].count) >= 200) {
      const error = badRequest("今天上传图片次数已达上限，请明天再试"); error.status = 429; throw error;
    }
    await client.query(`INSERT INTO upload_tickets(token_hash, object_key, user_id, kind, content_type)
      VALUES($1, $2, $3, $4, $5)`, [hash(token), key, userId, body.kind, contentType]);
  });
  return { objectKey: key, uploadUrl: `${config.publicApiBaseUrl.replace(/\/+$/, "")}/uploads/${token}`,
    expiresIn: 900, maxBytes: MAX_UPLOAD_BYTES, readUrl: publicAssetUrl(key) };
}

export async function normalizeImage(data, contentType) {
  if (!Buffer.isBuffer(data) || !data.length || data.length > MAX_UPLOAD_BYTES) throw badRequest("图片大小必须在 10 MB 以内");
  try {
    const input = sharp(data, { limitInputPixels: 25000000, failOn: "warning" });
    const metadata = await input.metadata();
    if (metadata.format !== types.get(contentType) || (metadata.pages || 1) !== 1) throw new Error("image format mismatch");
    return await input.rotate().resize({ width: 4096, height: 4096, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90 }).timeout({ seconds: 10 }).toBuffer();
  } catch { throw badRequest("图片格式不正确、文件损坏或分辨率过大，请重新选择图片"); }
}

export function installUploadRoute(router, storage) {
  let activeUploads = 0;
  router.put("/uploads/:token", (req, res, next) => {
    if (activeUploads >= 8) return res.status(503).json({ error: "上传服务繁忙，请稍后重试" });
    activeUploads += 1;
    res.once("close", () => { activeUploads -= 1; });
    next();
  }, asyncRoute(async (req, res, next) => {
    if (!/^[a-f0-9]{64}$/.test(req.params.token)) return res.status(404).end();
    const tokenHash = hash(req.params.token);
    // Claim before reading any body. A token can never overwrite a completed object.
    const { rows } = await query(`UPDATE upload_tickets t SET status = 'uploading'
      WHERE token_hash = $1 AND status = 'issued' AND expires_at > clock_timestamp()
      AND EXISTS (SELECT 1 FROM users u WHERE u.id = t.user_id AND u.deleted_at IS NULL AND u.status = 'active')
      RETURNING *`, [tokenHash]);
    if (!rows[0]) return res.status(410).json({ error: "上传地址已失效，请重新上传" });
    req.uploadTicket = rows[0];
    next();
  }), express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }), asyncRoute(async (req, res) => {
    const ticket = req.uploadTicket;
    try {
      const data = await imageGate(() => normalizeImage(req.body, ticket.content_type));
      await storage.putImage(ticket.object_key, data);
      await query(`UPDATE upload_tickets SET status = 'ready', byte_size = $2, sha256 = $3, uploaded_at = clock_timestamp()
        WHERE token_hash = $1`, [ticket.token_hash, data.length, hash(data)]);
      res.status(200).end();
    } catch (error) {
      await query("UPDATE upload_tickets SET status = 'failed' WHERE token_hash = $1", [ticket.token_hash]);
      throw error;
    }
  }));
}

// New publications must reference bytes accepted by our bounded upload route.
// Existing profile images may be retained, but arbitrary historical object keys cannot be republished.
export async function assertReadyUploads(userId, keys, client = { query }, { retainKeys = [], markReferenced = false } = {}) {
  for (const key of [...new Set(keys.filter(Boolean))]) {
    if (retainKeys.includes(key)) continue;
    const { rows } = await client.query(`SELECT object_key FROM upload_tickets
      WHERE object_key = $1 AND user_id = $2 AND status = 'ready' ${markReferenced ? "FOR UPDATE" : ""}`, [key, userId]);
    if (!rows[0]) throw badRequest("图片尚未上传完成或已失效，请重新上传");
    if (markReferenced) await client.query("UPDATE upload_tickets SET referenced_at = clock_timestamp() WHERE object_key = $1", [key]);
  }
}

export async function cleanupUnusedUploads(storage, limit = 100) {
  const keys = await withTransaction(async client => {
    const { rows } = await client.query(`SELECT object_key FROM upload_tickets
      WHERE referenced_at IS NULL AND created_at < clock_timestamp() - interval '7 days'
      ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`, [limit]);
    if (rows.length) await client.query("UPDATE upload_tickets SET status = 'cleaning' WHERE object_key = ANY($1::text[])", [rows.map(row => row.object_key)]);
    return rows.map(row => row.object_key);
  });
  for (const key of keys) {
    await storage.removeImage(key); // Keep the row for retry if OSS fails.
    await query("DELETE FROM upload_tickets WHERE object_key = $1 AND status = 'cleaning'", [key]);
  }
  return keys.length;
}

export function startUploadPruner(storage) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await cleanupUnusedUploads(storage); }
    catch (error) { logger.error("uploads.cleanup_failed", { error }); }
    finally { running = false; }
  };
  void run();
  return setInterval(run, 60 * 60 * 1000);
}

import { query } from "./db.js";
import { visiblePostSQL, unblockedSQL } from "./visibility.js";

export const ASSET_ACCESS_CACHE_MS = 30 * 1000;
const ASSET_ACCESS_CACHE_MAX = 5000;

export async function canReadAsset(key, user, adminSession = false) {
  return (await readAssetAccess(key, user, adminSession)).allowed;
}

/**
 * One query: whether `user` (or a verified web-admin session) may read `key`,
 * and the upload hash for the ETag. In-app moderator roles no longer grant
 * image access; administrators read evidence through the admin web session.
 */
export async function readAssetAccess(key, user, adminSession = false) {
  if (!/^(guarded\/)?(post|avatar|background|message|report)\//.test(key) || key.includes("..")) return { allowed: false, sha256: null };
  const viewer = user?.id || "";
  const { rows } = await query(`SELECT (
    EXISTS (SELECT 1 FROM posts p WHERE ($1 = ANY(p.image_object_keys) OR $1 = ANY(p.preview_image_object_keys))
      AND ${visiblePostSQL("p", "$2", true)})
    OR EXISTS (SELECT 1 FROM users u WHERE ($1 = u.avatar_object_key OR $1 = u.background_object_key)
      AND u.status = 'active' AND u.deleted_at IS NULL AND ${unblockedSQL("u.id", "$2")})
    OR EXISTS (SELECT 1 FROM direct_messages dm JOIN message_threads mt ON mt.id = dm.thread_id
      WHERE dm.image_object_key = $1 AND $2 IN (mt.buyer_user_id, mt.publisher_user_id)
        AND dm.safety_status = 'active' AND dm.revoked_at IS NULL AND NOT ($2 = ANY(dm.deleted_for_user_ids)))
    OR EXISTS (SELECT 1 FROM moderation_reviews mr WHERE $1 = ANY(mr.image_object_keys)
      AND ($3 OR $4 OR mr.owner_id = NULLIF($2, '')) AND ($4 OR mr.status IN ('pending','review','rejected'))
      AND (mr.target_type <> 'post' OR EXISTS (SELECT 1 FROM posts rp WHERE rp.id = mr.target_id AND rp.status <> 'deleted')))
    OR EXISTS (SELECT 1 FROM safety_evidence e WHERE $4 AND e.redacted_at IS NULL AND $1=ANY(e.object_keys))
    OR EXISTS (SELECT 1 FROM content_revisions cr WHERE ($4 OR cr.owner_id = NULLIF($2, ''))
      AND ($1=ANY(cr.object_keys) OR (cr.snapshot->'imageObjectKeys') ? $1 OR (cr.snapshot->'previewImageObjectKeys') ? $1))
    OR EXISTS (SELECT 1 FROM safety_appeals sa WHERE $4 AND $1=ANY(sa.object_keys))
    OR EXISTS (SELECT 1 FROM upload_tickets ut WHERE ut.object_key = $1 AND ut.user_id = NULLIF($2, '')
      AND ut.status = 'ready' AND ut.referenced_at IS NULL)
  ) AS allowed,
  (SELECT ut.sha256 FROM upload_tickets ut WHERE ut.object_key = $1 AND ut.status = 'ready') AS sha256`,
  [key, viewer, false, adminSession]);
  const sha256 = rows[0]?.sha256;
  return { allowed: Boolean(rows[0]?.allowed), sha256: typeof sha256 === "string" && /^[a-f0-9]{64}$/.test(sha256) ? sha256 : null };
}

/**
 * Small in-process LRU of positive permission checks, keyed by object and
 * viewer. Only `allowed = true` is cached, so a denial is never served from
 * cache. Trade-off: after a block, takedown or message revoke, an image the
 * viewer could already open stays readable for up to `ttlMs` (30 s) on this
 * instance before the gateway starts returning 404.
 */
export function createAssetAccessCache({ ttlMs = ASSET_ACCESS_CACHE_MS, max = ASSET_ACCESS_CACHE_MAX, now = Date.now } = {}) {
  const entries = new Map();
  return {
    async check(key, user, adminSession = false) {
      const cacheKey = `${key}|${user?.id || ""}|${adminSession ? "admin" : ""}`;
      const hit = entries.get(cacheKey);
      if (hit && hit.expiresAt > now()) {
        entries.delete(cacheKey);
        entries.set(cacheKey, hit); // refresh LRU position
        return hit.value;
      }
      if (hit) entries.delete(cacheKey);
      const value = await readAssetAccess(key, user, adminSession);
      if (value.allowed && ttlMs > 0) {
        entries.set(cacheKey, { value, expiresAt: now() + ttlMs });
        while (entries.size > max) entries.delete(entries.keys().next().value);
      }
      return value;
    },
    get size() { return entries.size; }
  };
}

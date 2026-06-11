import { createHash } from "node:crypto";
import { query } from "./db.js";
import { logger } from "./logger.js";

const RATE_LIMIT_EVENT_RETENTION_SECONDS = 60 * 60;
const RATE_LIMIT_EVENT_PRUNE_INTERVAL_MS = 5 * 60 * 1000;

export function createRateLimiter({ windowMs, max, message, keyGenerator, name = "default", store = "memory" }) {
  if (store === "postgres") {
    return createPostgresRateLimiter({ windowMs, max, message, keyGenerator, name });
  }
  return createMemoryRateLimiter({ windowMs, max, message, keyGenerator });
}

function createMemoryRateLimiter({ windowMs, max, message, keyGenerator }) {
  const buckets = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const key = keyGenerator ? keyGenerator(req) : req.ip;
    const bucket = (buckets.get(key) || []).filter((timestamp) => now - timestamp < windowMs);

    if (bucket.length >= max) {
      return res.status(429).json({ error: message || "操作太频繁，请稍后再试" });
    }

    bucket.push(now);
    buckets.set(key, bucket);

    if (buckets.size > 10000) {
      for (const [bucketKey, timestamps] of buckets) {
        if (!timestamps.some((timestamp) => now - timestamp < windowMs)) {
          buckets.delete(bucketKey);
        }
      }
    }

    next();
  };
}

function createPostgresRateLimiter({ windowMs, max, message, keyGenerator, name }) {
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  let nextCleanupAt = 0;

  return async (req, res, next) => {
    const rawKey = keyGenerator ? keyGenerator(req) : req.ip;
    const keyHash = createHash("sha256").update(String(rawKey || "")).digest("hex");

    try {
      const { rows } = await query(
        `WITH inserted AS (
           INSERT INTO rate_limit_events (scope, key_hash, created_at)
           VALUES ($1, $2, now())
           RETURNING 1
         )
         SELECT count(*)::int AS count
         FROM rate_limit_events
         WHERE scope = $1
           AND key_hash = $2
           AND created_at >= now() - ($3::text)::interval`,
        [name, keyHash, `${windowSeconds} seconds`]
      );

      scheduleRateLimitCleanup(windowSeconds, nextCleanupAt, (timestamp) => {
        nextCleanupAt = timestamp;
      });

      if (Number(rows[0]?.count || 0) > max) {
        return res.status(429).json({ error: message || "操作太频繁，请稍后再试" });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

function scheduleRateLimitCleanup(windowSeconds, nextCleanupAt, setNextCleanupAt) {
  const now = Date.now();
  if (now < nextCleanupAt) return;
  setNextCleanupAt(now + 60 * 1000);
  pruneOldRateLimitEvents(windowSeconds * 2).catch((error) => {
    logger.error("rate_limit.cleanup_failed", { error });
  });
}

export async function pruneOldRateLimitEvents(retentionSeconds = RATE_LIMIT_EVENT_RETENTION_SECONDS) {
  const seconds = Math.max(60, Number(retentionSeconds) || RATE_LIMIT_EVENT_RETENTION_SECONDS);
  const { rowCount } = await query("DELETE FROM rate_limit_events WHERE created_at < now() - ($1::text)::interval", [`${seconds} seconds`]);
  return rowCount;
}

export function startRateLimitEventPruner({ intervalMs = RATE_LIMIT_EVENT_PRUNE_INTERVAL_MS } = {}) {
  const run = () => {
    pruneOldRateLimitEvents().catch((error) => {
      logger.error("rate_limit.prune_failed", { error });
    });
  };
  run();
  return setInterval(run, intervalMs);
}

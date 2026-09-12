import { createHash } from "node:crypto";
import { query, withTransaction } from "./db.js";
import { logger } from "./logger.js";

const RATE_LIMIT_EVENT_PRUNE_INTERVAL_MS = 5 * 60 * 1000;

export function createRateLimiter({ windowMs, max, message, keyGenerator, name = "default", store = "memory", apiCode }) {
  if (store === "postgres") {
    return createPostgresRateLimiter({ windowMs, max, message, keyGenerator, name, apiCode });
  }
  return createMemoryRateLimiter({ windowMs, max, message, keyGenerator, apiCode });
}

function createMemoryRateLimiter({ windowMs, max, message, keyGenerator, apiCode }) {
  const buckets = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const key = keyGenerator ? keyGenerator(req) : req.ip;
    const bucket = (buckets.get(key) || []).filter((timestamp) => now - timestamp < windowMs);

    if (bucket.length >= max) {
      return res.status(429).json({ error: message || "操作太频繁，请稍后再试", ...(apiCode ? { code: apiCode } : {}) });
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

function createPostgresRateLimiter({ windowMs, max, message, keyGenerator, name, apiCode }) {
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));

  return async (req, res, next) => {
    const rawKey = keyGenerator ? keyGenerator(req) : req.ip;
    const keyHash = createHash("sha256").update(String(rawKey || "")).digest("hex");

    try {
      const allowed = await withTransaction(async (client) => {
        // Serialize each bucket across processes. Separate statements see the
        // preceding transaction's commit after the advisory lock is acquired.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`rate:${name}:${keyHash}`]);
        const { rows } = await client.query(
          `SELECT count(*)::int AS count FROM rate_limit_events
           WHERE scope = $1 AND key_hash = $2 AND expires_at > clock_timestamp()`,
          [name, keyHash]
        );
        if (rows[0].count >= max) return false;
        await client.query(
          `INSERT INTO rate_limit_events (scope, key_hash, created_at, expires_at)
           VALUES ($1, $2, clock_timestamp(), clock_timestamp() + ($3::int * interval '1 second'))`,
          [name, keyHash, windowSeconds]
        );
        return true;
      });

      if (!allowed) {
        res.setHeader("Retry-After", String(windowSeconds));
        return res.status(429).json({ error: message || "操作太频繁，请稍后再试", ...(apiCode ? { code: apiCode } : {}) });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

export async function pruneOldRateLimitEvents() {
  const { rowCount } = await query("DELETE FROM rate_limit_events WHERE expires_at <= clock_timestamp()");
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

import { createHash } from "node:crypto";
import { query, withTransaction } from "./db.js";
import { logger } from "./logger.js";

const RATE_LIMIT_EVENT_PRUNE_INTERVAL_MS = 5 * 60 * 1000;

const MEMORY_BUCKET_SWEEP_INTERVAL_MS = 60 * 1000;

/**
 * `store: "memory"` counts per process. With several API instances behind a
 * load balancer each instance enforces its own limit, so the effective limit
 * is `max x instances`. Use it for high-frequency, low-risk traffic (images,
 * interactions, feed events, anonymous reads). Security-sensitive limits
 * (auth, email codes, content, DM abuse) must use `store: "postgres"`.
 */
export function createRateLimiter({ windowMs, max, message, keyGenerator, name = "default", store = "memory" }) {
  if (store === "postgres") {
    return createPostgresRateLimiter({ windowMs, max, message, keyGenerator, name });
  }
  return createMemoryRateLimiter({ windowMs, max, message, keyGenerator });
}

export function createMemoryRateLimiter({ windowMs, max, message, keyGenerator, now = Date.now, sweepIntervalMs = MEMORY_BUCKET_SWEEP_INTERVAL_MS }) {
  const buckets = new Map();

  const sweep = () => {
    const current = now();
    for (const [bucketKey, timestamps] of buckets) {
      if (!timestamps.some((timestamp) => current - timestamp < windowMs)) buckets.delete(bucketKey);
    }
  };
  // Sweep on a timer instead of only when the map grows large, so idle keys
  // are released. unref() keeps the timer from holding the process open.
  const timer = setInterval(sweep, sweepIntervalMs);
  timer.unref?.();

  const limiter = (req, res, next) => {
    const current = now();
    const key = keyGenerator ? keyGenerator(req) : req.ip;
    const bucket = (buckets.get(key) || []).filter((timestamp) => current - timestamp < windowMs);

    if (bucket.length >= max) {
      buckets.set(key, bucket);
      const retryAfterMs = Math.max(0, windowMs - (current - bucket[0]));
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
      return res.status(429).json({ error: message || "操作太频繁，请稍后再试" });
    }

    bucket.push(current);
    buckets.set(key, bucket);
    next();
  };
  limiter.sweep = sweep;
  limiter.bucketCount = () => buckets.size;
  limiter.stop = () => clearInterval(timer);
  return limiter;
}

function createPostgresRateLimiter({ windowMs, max, message, keyGenerator, name }) {
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
        return res.status(429).json({ error: message || "操作太频繁，请稍后再试" });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Counts one event inside an existing transaction (rolled back with it).
 * Used where the limit applies to a business action discovered mid-request,
 * e.g. "this message creates a new conversation". Returns false when full.
 */
export async function consumeRateLimitEvent(client, { name, key, windowMs, max }) {
  const keyHash = createHash("sha256").update(String(key || "")).digest("hex");
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`rate:${name}:${keyHash}`]);
  const { rows } = await client.query(
    `SELECT count(*)::int AS count FROM rate_limit_events
     WHERE scope = $1 AND key_hash = $2 AND expires_at > clock_timestamp()`, [name, keyHash]);
  if (rows[0].count >= max) return false;
  await client.query(
    `INSERT INTO rate_limit_events (scope, key_hash, created_at, expires_at)
     VALUES ($1, $2, clock_timestamp(), clock_timestamp() + ($3::int * interval '1 second'))`, [name, keyHash, windowSeconds]);
  return true;
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

import assert from "node:assert/strict";
import test from "node:test";
import { createRateLimiter } from "../src/rateLimit.js";
import { closeDatabase, pool, resetDatabase } from "./helpers/database.js";

test.beforeEach(resetDatabase);
test.after(closeDatabase);

test("PostgreSQL limiter allows exactly max sequential requests", async () => {
  const scope = "postgres_limiter_sequential";
  const limiter = createPostgresLimiter(scope);

  const first = await invoke(limiter, "sequential-key");
  const second = await invoke(limiter, "sequential-key");

  assert.deepEqual(first, { allowed: true });
  assert.deepEqual(second, { allowed: false, status: 429, body: { error: "limited", code: "report_rate_limited" } });
  await assertEventCount(scope, 1);
});

test("PostgreSQL limiter serializes concurrent requests for one scope and key", async () => {
  const scope = "postgres_limiter_concurrent";
  const limiter = createPostgresLimiter(scope);

  const results = await Promise.all(Array.from({ length: 4 }, () => invoke(limiter, "concurrent-key")));

  assert.equal(results.filter((result) => result.allowed).length, 1);
  assert.deepEqual(results.filter((result) => !result.allowed), Array.from({ length: 3 }, () => ({
    allowed: false,
    status: 429,
    body: { error: "limited", code: "report_rate_limited" }
  })));
  await assertEventCount(scope, 1);
});

function createPostgresLimiter(name) {
  return createRateLimiter({
    name,
    store: "postgres",
    windowMs: 60 * 1000,
    max: 1,
    message: "limited",
    apiCode: "report_rate_limited",
    keyGenerator: (req) => req.rateLimitKey
  });
}

function invoke(limiter, rateLimitKey) {
  return new Promise((resolve, reject) => {
    const res = {
      setHeader() {},
      status(status) {
        return {
          json(body) {
            resolve({ allowed: false, status, body });
          }
        };
      }
    };
    const next = (error) => error ? reject(error) : resolve({ allowed: true });
    Promise.resolve(limiter({ rateLimitKey }, res, next)).catch(reject);
  });
}

async function assertEventCount(scope, expected) {
  const { rows } = await pool.query(
    "SELECT count(*)::int AS count FROM rate_limit_events WHERE scope = $1",
    [scope]
  );
  assert.equal(rows[0].count, expected);
}

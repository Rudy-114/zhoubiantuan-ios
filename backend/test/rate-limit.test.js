import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRateLimiter } from '../src/rateLimit.js';

function run(limiter, req) {
  let status = 200;
  const headers = {};
  const res = { setHeader: (k, v) => { headers[k.toLowerCase()] = v; }, status(code) { status = code; return this; }, json() { return this; } };
  let passed = false;
  limiter(req, res, () => { passed = true; });
  return { status: passed ? 200 : status, headers };
}

test('memory limiter allows max requests per window, then 429 with Retry-After', () => {
  let now = 1_000_000;
  const limiter = createMemoryRateLimiter({ windowMs: 60_000, max: 600, keyGenerator: req => `u:${req.user.id}`, now: () => now });
  const req = { user: { id: 'a' }, ip: '10.0.0.1' };
  for (let i = 0; i < 600; i++) assert.equal(run(limiter, req).status, 200, `request ${i + 1}`);
  const blocked = run(limiter, req);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers['retry-after'], '60');
  // A second signed-in user behind the same NAT has an independent budget.
  assert.equal(run(limiter, { user: { id: 'b' }, ip: '10.0.0.1' }).status, 200);
  limiter.stop();
});

test('memory limiter window slides and idle buckets are swept', () => {
  let now = 0;
  const limiter = createMemoryRateLimiter({ windowMs: 1000, max: 2, now: () => now });
  const req = { ip: 'ip-1' };
  assert.equal(run(limiter, req).status, 200);
  now = 500;
  assert.equal(run(limiter, req).status, 200);
  assert.equal(run(limiter, req).status, 429);
  now = 1001; // the first hit left the window
  assert.equal(run(limiter, req).status, 200);
  assert.equal(run(limiter, req).status, 429);
  now = 10_000;
  limiter.sweep();
  assert.equal(limiter.bucketCount(), 0);
  limiter.stop();
});

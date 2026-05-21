export function createRateLimiter({ windowMs, max, message, keyGenerator }) {
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

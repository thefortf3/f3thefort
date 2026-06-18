// Minimal in-memory fixed-window rate limiter for the public, unauthenticated
// endpoints (submission create, image upload, AI snippet generation). No external
// dependency to stay consistent with the rest of the app; state is per-process, which
// is fine for the single-container deployment.
//
// Each client (keyed by IP) gets `max` requests per `windowMs`. Over the limit returns
// 429 with a Retry-After header.

export function rateLimit({ windowMs, max, message = 'Too many requests, please slow down.' }) {
  const hits = new Map(); // key → { count, resetAt }

  // Evict stale windows so the map doesn't grow unbounded.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now >= entry.resetAt) hits.delete(key);
    }
  }, windowMs);
  sweep.unref?.();

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    // req.ip honors Express's trust proxy setting; fall back to the socket address.
    const key = req.ip || req.socket?.remoteAddress || 'unknown';

    let entry = hits.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }

    entry.count++;

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: message });
    }

    next();
  };
}

/**
 * Rate limiting — in-memory sliding window per API-nyckel
 *
 * Fönster: 60 sekunder
 * Gräns: Konfigureras per nyckel (api_keys.rate_limit)
 * Cleanup: Var 5:e minut för att förhindra minnesläckor
 */

// Map<keyId, { count: number, windowStart: number }>
const windows = new Map();

// Rensa gamla entries var 5:e minut
setInterval(() => {
  const now = Date.now();
  for (const [keyId, entry] of windows) {
    if (now - entry.windowStart > 120_000) {
      windows.delete(keyId);
    }
  }
}, 300_000);

/**
 * Express-middleware: Begränsar antal anrop per minut per API-nyckel
 * Kräver att validateApiKey redan satt req.apiKey.
 */
export function rateLimiter(req, res, next) {
  if (!req.apiKey) return next();

  const keyId = req.apiKey.id;
  const limit = req.apiKey.rateLimit || 100;
  const now = Date.now();

  let entry = windows.get(keyId);

  // Nytt fönster om inget finns eller om fönstret gått ut
  if (!entry || now - entry.windowStart > 60_000) {
    entry = { count: 1, windowStart: now };
    windows.set(keyId, entry);
    setRateLimitHeaders(res, limit, limit - 1, entry.windowStart);
    return next();
  }

  entry.count++;

  if (entry.count > limit) {
    const retryAfter = Math.ceil((entry.windowStart + 60_000 - now) / 1000);
    setRateLimitHeaders(res, limit, 0, entry.windowStart);
    res.setHeader('Retry-After', retryAfter);
    return res.status(429).json({
      error: 'Rate limit nådd',
      limit,
      retryAfter,
    });
  }

  setRateLimitHeaders(res, limit, limit - entry.count, entry.windowStart);
  next();
}

/**
 * Sätter standard rate limit-headers
 */
function setRateLimitHeaders(res, limit, remaining, windowStart) {
  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining));
  res.setHeader('X-RateLimit-Reset', Math.ceil((windowStart + 60_000) / 1000));
}

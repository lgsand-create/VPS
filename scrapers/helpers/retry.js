export async function withRetry(fn, options = {}) {
  const { retries = 3, delayMs = 1000, onRetry } = options;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === retries) throw error;

      const wait = delayMs * Math.pow(2, attempt - 1);
      if (onRetry) onRetry(attempt, error, wait);
      else console.warn(`⚠️  Försök ${attempt}/${retries} misslyckades, väntar ${wait}ms...`);

      await sleep(wait);
    }
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createRateLimiter(intervalMs = 500, jitter = 0) {
  let lastCall = 0;

  return async () => {
    const now = Date.now();
    const elapsed = now - lastCall;
    // Lägg till slumpmässig jitter uppåt (0-1, t.ex. 0.4 = +0-40%)
    const jitterMs = jitter > 0
      ? Math.floor(Math.random() * intervalMs * jitter)
      : 0;
    const wait = intervalMs + jitterMs;
    if (elapsed < wait) {
      await sleep(wait - elapsed);
    }
    lastCall = Date.now();
  };
}

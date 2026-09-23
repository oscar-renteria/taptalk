export type RateLimitOptions = { max: number; windowMs: number };

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

// Fixed-window, in-memory limiter. Suitable for the single-process SQLite deployment (ADR-001);
// a multi-instance deployment would need a shared store.
export function createRateLimiter(options: RateLimitOptions, now: () => number = Date.now) {
  const windows = new Map<string, { count: number; resetAt: number }>();

  function sweep(currentTime: number): void {
    for (const [key, window] of windows) {
      if (window.resetAt <= currentTime) windows.delete(key);
    }
  }

  return {
    check(key: string): RateLimitDecision {
      const currentTime = now();
      if (windows.size > 10_000) sweep(currentTime);
      const window = windows.get(key);
      if (!window || window.resetAt <= currentTime) {
        windows.set(key, { count: 1, resetAt: currentTime + options.windowMs });
        return { allowed: true };
      }
      window.count += 1;
      if (window.count > options.max) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - currentTime) / 1000)),
        };
      }
      return { allowed: true };
    },
  };
}

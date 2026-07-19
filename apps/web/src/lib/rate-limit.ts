/**
 * Best-effort in-memory sliding-window rate limiter.
 *
 * This is per-process state, so on serverless platforms with multiple instances it only
 * limits per-instance, not globally. That is an acceptable first line of defense against
 * accidental loops / basic abuse for the upload register/complete endpoints; a shared store
 * (e.g. Upstash) can replace this later if stronger guarantees are needed.
 */

const hits = new Map<string, number[]>();

/** Periodically drop keys with no recent hits so the map does not grow unbounded. */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
let lastSweepAt = 0;

function sweep(now: number): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [key, timestamps] of hits) {
    if (timestamps.length === 0 || now - timestamps[timestamps.length - 1]! > SWEEP_INTERVAL_MS) {
      hits.delete(key);
    }
  }
}

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterMs: number };

/**
 * Allows at most `limit` calls per `key` within `windowMs`. Call once per request attempt.
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const windowStart = now - windowMs;
  const timestamps = (hits.get(key) ?? []).filter((t) => t > windowStart);

  if (timestamps.length >= limit) {
    const retryAfterMs = timestamps[0]! + windowMs - now;
    hits.set(key, timestamps);
    return { allowed: false, retryAfterMs: Math.max(0, retryAfterMs) };
  }

  timestamps.push(now);
  hits.set(key, timestamps);
  return { allowed: true };
}

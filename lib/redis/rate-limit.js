import { getRedis } from "./client";

const WINDOW_SEC = 60;
const DEFAULT_MAX = 60;

/**
 * Fixed-window rate limit by key. Returns { ok, remaining }.
 * If Redis is unavailable, fails open (allows request).
 */
export async function rateLimit(key, max = DEFAULT_MAX, windowSec = WINDOW_SEC) {
  const redis = getRedis();
  if (!redis) {
    return { ok: true, remaining: max };
  }
  const k = `rl:${key}`;
  try {
    const count = await redis.incr(k);
    if (count === 1) {
      await redis.expire(k, windowSec);
    }
    const ttl = await redis.ttl(k);
    const remaining = Math.max(0, max - count);
    if (count > max) {
      return { ok: false, remaining: 0, retryAfterSec: ttl > 0 ? ttl : windowSec };
    }
    return { ok: true, remaining };
  } catch {
    return { ok: true, remaining: max };
  }
}

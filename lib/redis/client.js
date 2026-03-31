import { Redis } from "@upstash/redis";

/** Singleton Upstash REST client for serverless (Vercel). */
let _redis;

export function getRedis() {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    return null;
  }
  _redis = new Redis({ url, token });
  return _redis;
}

import { getRedis } from "./client";

const PRICE_TTL = 15; // seconds — balances freshness vs Binance calls

export async function getCachedPrice(symbol) {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const v = await redis.get(`price:${symbol}`);
    return v != null ? Number(v) : null;
  } catch {
    return null;
  }
}

export async function setCachedPrice(symbol, price) {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(`price:${symbol}`, String(price), { ex: PRICE_TTL });
  } catch {
    /* noop */
  }
}

/** Common prefix for idempotency: avoid duplicate orders within TTL */
export async function acquireOrderLock(botId, digest, ttlSec = 45) {
  const redis = getRedis();
  if (!redis) return true;
  const key = `orderlock:${botId}:${digest}`;
  try {
    const ok = await redis.set(key, "1", { nx: true, ex: ttlSec });
    return ok === "OK";
  } catch {
    return true;
  }
}

export async function incrDailyLoss(botId, dateKey, amount) {
  const redis = getRedis();
  if (!redis) return Number(amount);
  const key = `daily_loss:${botId}:${dateKey}`;
  try {
    const v = await redis.incrbyfloat(key, amount);
    await redis.expire(key, 86400 * 2);
    return Number(v);
  } catch {
    return amount;
  }
}

export async function getDailyLoss(botId, dateKey) {
  const redis = getRedis();
  if (!redis) return 0;
  try {
    const v = await redis.get(`daily_loss:${botId}:${dateKey}`);
    return v != null ? Number(v) : 0;
  } catch {
    return 0;
  }
}

export async function getTempBotState(botId) {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(`botstate:${botId}`);
    if (!raw) return null;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

export async function setTempBotState(botId, state, ttlSec = 300) {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(`botstate:${botId}`, JSON.stringify(state), { ex: ttlSec });
  } catch {
    /* noop */
  }
}

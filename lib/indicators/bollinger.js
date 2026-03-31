import { sma } from "./sma";

/** Bollinger Bands: middle (SMA), upper, lower. */
export function bollinger(closes, period = 20, mult = 2) {
  const mid = sma(closes, period);
  const upper = closes.map((_, i) => {
    const m = mid[i];
    if (m == null) return null;
    let sum = 0;
    for (let j = 0; j < period; j++) {
      const d = closes[i - j] - m;
      sum += d * d;
    }
    const sd = Math.sqrt(sum / period);
    return m + mult * sd;
  });
  const lower = closes.map((_, i) => {
    const m = mid[i];
    if (m == null) return null;
    let sum = 0;
    for (let j = 0; j < period; j++) {
      const d = closes[i - j] - m;
      sum += d * d;
    }
    const sd = Math.sqrt(sum / period);
    return m - mult * sd;
  });
  return { middle: mid, upper, lower };
}

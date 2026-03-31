/** Exponential moving average. */
export function ema(closes, period) {
  if (!closes?.length || period < 1) return [];
  const k = 2 / (period + 1);
  const out = [];
  let prev = null;
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    if (prev === null) {
      if (i < period - 1) {
        out.push(null);
        continue;
      }
      if (i === period - 1) {
        let s = 0;
        for (let j = 0; j < period; j++) s += closes[i - j];
        prev = s / period;
        out.push(prev);
        continue;
      }
    }
    prev = c * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

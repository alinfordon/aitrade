/** Simple moving average over closes. */
export function sma(closes, period) {
  if (!closes?.length || period < 1) return [];
  const out = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    let s = 0;
    for (let j = 0; j < period; j++) {
      s += closes[i - j];
    }
    out.push(s / period);
  }
  return out;
}

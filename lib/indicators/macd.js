import { ema } from "./ema";

/** MACD line, signal, histogram (aligned to closes length). */
export function macd(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const line = closes.map((_, i) => {
    const a = ef[i];
    const b = es[i];
    if (a == null || b == null) return null;
    return a - b;
  });

  let start = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] != null) {
      start = i;
      break;
    }
  }
  if (start === -1) {
    return {
      line,
      signal: closes.map(() => null),
      histogram: closes.map(() => null),
    };
  }

  const seq = line.slice(start);
  const sigSeq = ema(
    seq.map((v) => v),
    signalPeriod
  );
  const signal = closes.map(() => null);
  for (let j = 0; j < sigSeq.length; j++) {
    signal[start + j] = sigSeq[j];
  }

  const histogram = closes.map((_, i) => {
    if (line[i] == null || signal[i] == null) return null;
    return line[i] - signal[i];
  });

  return { line, signal, histogram };
}

import { evaluateRule } from "@/server/engine/strategy-eval";

/**
 * Walk-forward simulation on historical closes (aligned OHLC).
 * @param {{ opens:number[], highs:number[], lows:number[], closes:number[] }} series
 * @param {object} definition - strategy JSON
 * @param {{ feePct?: number, slippagePct?: number, initialQuote?: number }} opts
 */
export function runBacktest(series, definition, opts = {}) {
  const feePct = opts.feePct ?? 0.001;
  const slipPct = opts.slippagePct ?? 0.0005;
  const initial = opts.initialQuote ?? 10000;

  const { closes, highs, lows } = series;
  const maxWarmup = 250;
  const startIdx = Math.min(maxWarmup, Math.max(0, closes.length - 50));

  let quote = initial;
  let base = 0;
  let entryPrice = 0;
  let position = false;
  let peak = initial;
  let maxDd = 0;
  let trades = 0;
  let roundTrips = 0;
  let wins = 0;
  let grossProfit = 0;

  const entryRules = Array.isArray(definition.entry) ? definition.entry : [];
  const exitRules = Array.isArray(definition.exit) ? definition.exit : [];

  function sliceTo(i) {
    return {
      opens: series.opens.slice(0, i + 1),
      highs: highs.slice(0, i + 1),
      lows: lows.slice(0, i + 1),
      closes: closes.slice(0, i + 1),
    };
  }

  for (let i = startIdx; i < closes.length; i++) {
    const price = closes[i];
    const s = sliceTo(i);

    const entryOk =
      entryRules.length > 0 && entryRules.every((r) => evaluateRule(r, s));
    const exitOk = exitRules.some((r) => evaluateRule(r, s));

    if (position && exitOk) {
      const sellPrice = price * (1 - slipPct);
      const gross = base * sellPrice;
      const fee = gross * feePct;
      const proceeds = gross - fee;
      const pnl = proceeds - base * entryPrice;
      grossProfit += pnl;
      roundTrips++;
      if (pnl > 0) wins++;
      quote += proceeds;
      base = 0;
      position = false;
      entryPrice = 0;
      const eq = quote;
      if (eq > peak) peak = eq;
      const dd = peak > 0 ? (peak - eq) / peak : 0;
      if (dd > maxDd) maxDd = dd;
    } else if (!position && entryOk && quote > 0) {
      const alloc = quote * (opts.positionPct ?? 0.1);
      const buyPrice = price * (1 + slipPct);
      const qty = alloc / buyPrice;
      const fee = alloc * feePct;
      quote -= alloc + fee;
      base += qty;
      entryPrice = buyPrice;
      position = true;
      trades++;
    }

    if (position) {
      const eq = quote + base * price;
      if (eq > peak) peak = eq;
      const dd = peak > 0 ? (peak - eq) / peak : 0;
      if (dd > maxDd) maxDd = dd;
    }
  }

  const finalEq = position ? quote + base * closes[closes.length - 1] : quote;
  const profitPct = initial > 0 ? (finalEq - initial) / initial : 0;
  const winRate = roundTrips > 0 ? wins / roundTrips : 0;

  return {
    totalProfit: profitPct,
    winRate,
    maxDrawdown: maxDd,
    trades: roundTrips,
    entriesOpened: trades,
    finalEquity: finalEq,
    grossProfitRelative: grossProfit / initial,
  };
}

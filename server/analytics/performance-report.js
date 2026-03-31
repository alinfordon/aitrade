/**
 * TradingView-style metrics from trade history (FIFO fallback when `pnl` missing on sells).
 */

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {Array<{ pair: string, side: string, quantity: number, price: number, pnl?: number, createdAt: Date|string }>} trades
 */
export function buildPerformanceReport(trades) {
  const sorted = [...trades].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  /** @type {Record<string, { qty: number, avg: number }>} */
  const book = {};
  const roundTrips = [];
  let cumPnl = 0;
  const equity = [{ t: 0, pnl: 0 }];

  for (const tr of sorted) {
    const pair = tr.pair || "UNKNOWN";
    const side = String(tr.side).toLowerCase();
    const q = num(tr.quantity);
    const px = num(tr.price);
    const ts = new Date(tr.createdAt).getTime();

    if (!book[pair]) book[pair] = { qty: 0, avg: 0 };

    if (side === "buy") {
      const b = book[pair];
      const cost = q * px;
      const newQty = b.qty + q;
      b.avg = newQty > 0 ? (b.qty * b.avg + cost) / newQty : px;
      b.qty = newQty;
      continue;
    }

    if (side === "sell") {
      const hasStored = tr.pnl !== undefined && tr.pnl !== null && Number.isFinite(num(tr.pnl));
      if (hasStored) {
        const pnl = num(tr.pnl);
        cumPnl += pnl;
        equity.push({ t: ts, pnl: cumPnl });
        roundTrips.push({ pair, pnl, at: tr.createdAt, source: "stored" });
        book[pair].qty = Math.max(0, book[pair].qty - q);
        continue;
      }

      const b = book[pair];
      const sellQty = Math.min(q, b.qty || 0);
      const pnl = sellQty > 0 ? sellQty * (px - b.avg) : 0;
      b.qty = Math.max(0, b.qty - q);
      if (sellQty > 0) {
        cumPnl += pnl;
        equity.push({ t: ts, pnl: cumPnl });
        roundTrips.push({ pair, pnl, at: tr.createdAt, qty: sellQty, exitPx: px, source: "fifo" });
      }
    }
  }

  const wins = roundTrips.filter((r) => r.pnl > 0);
  const losses = roundTrips.filter((r) => r.pnl < 0);
  const grossProfit = wins.reduce((s, r) => s + r.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + r.pnl, 0));
  const totalTrades = roundTrips.length;
  const winRate = totalTrades > 0 ? wins.length / totalTrades : 0;
  let profitFactor = 0;
  if (grossLoss > 1e-8) profitFactor = grossProfit / grossLoss;
  else if (grossProfit > 0) profitFactor = null;

  let peak = 0;
  let maxDd = 0;
  for (const pt of equity) {
    if (pt.pnl > peak) peak = pt.pnl;
    const dd = peak - pt.pnl;
    if (dd > maxDd) maxDd = dd;
  }
  const maxDdPct = peak > 1e-8 ? (maxDd / peak) * 100 : maxDd > 0 ? 100 : 0;

  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLossAmt = losses.length ? grossLoss / losses.length : 0;
  let payoff = 0;
  if (avgLossAmt > 1e-8) payoff = avgWin / avgLossAmt;
  else if (avgWin > 0) payoff = null;

  const winPnls = wins.map((r) => r.pnl);
  const lossPnls = losses.map((r) => r.pnl);
  const largestWin = winPnls.length ? Math.max(...winPnls) : 0;
  const largestLoss = lossPnls.length ? Math.min(...lossPnls) : 0;

  return {
    summary: {
      netProfit: cumPnl,
      grossProfit,
      grossLoss,
      profitFactor,
      totalTrades,
      winningTrades: wins.length,
      losingTrades: losses.length,
      percentProfitable: winRate * 100,
      avgTrade: totalTrades > 0 ? cumPnl / totalTrades : 0,
      avgWinningTrade: avgWin,
      avgLosingTrade: losses.length ? -avgLossAmt : 0,
      payoff,
      largestWin,
      largestLoss,
      maxDrawdown: maxDd,
      maxDrawdownPct: maxDdPct,
    },
    roundTrips: roundTrips.slice(-200),
    equityCurve: equity,
  };
}

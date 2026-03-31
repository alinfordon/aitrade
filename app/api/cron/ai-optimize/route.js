import { NextResponse } from "next/server";
import { verifyCron } from "@/lib/api-helpers";
import { connectDB } from "@/models/db";
import User from "@/models/User";
import Strategy from "@/models/Strategy";
import { fetchOHLCV } from "@/lib/binance/service";
import { DEFAULT_SPOT_PAIR } from "@/lib/market-defaults";
import { ohlcvToSeries } from "@/server/candles";
import { optimizeOnSeries } from "@/server/optimizer/optimizer";

/** Vercel Cron: daily. Generates optimized variants for Elite accounts (batch, capped). */
export async function GET(request) {
  if (!verifyCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectDB();
  const elites = await User.find({ subscriptionPlan: "elite" }).limit(25).lean();
  const out = [];

  for (const u of elites) {
    const base = await Strategy.findOne({ userId: u._id }).sort({ updatedAt: -1 }).lean();
    if (!base?.definition) {
      out.push({ userId: String(u._id), skipped: true });
      continue;
    }
    try {
      const ohlcv = await fetchOHLCV(DEFAULT_SPOT_PAIR, "1h", 400);
      const series = ohlcvToSeries(ohlcv);
      const ranked = optimizeOnSeries(base.definition, series, { count: 60 });
      const best = ranked[0];
      if (!best) continue;
      const doc = await Strategy.create({
        userId: u._id,
        name: `${base.name} (cron optimized)`,
        definition: best.definition,
        source: "optimized",
        parentStrategyId: base._id,
        optimizationMeta: {
          score: best.score,
          backtestProfit: best.backtest.totalProfit,
          winRate: best.backtest.winRate,
          maxDrawdown: best.backtest.maxDrawdown,
          trades: best.backtest.trades,
        },
      });
      out.push({ userId: String(u._id), strategyId: String(doc._id) });
    } catch (e) {
      out.push({ userId: String(u._id), error: String(e?.message || e) });
    }
  }

  return NextResponse.json({ ok: true, results: out });
}

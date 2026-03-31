import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import Strategy from "@/models/Strategy";
import User from "@/models/User";
import { fetchOHLCV } from "@/lib/binance/service";
import { ohlcvToSeries } from "@/server/candles";
import { optimizeOnSeries } from "@/server/optimizer/optimizer";
import { optimizeSchema } from "@/lib/validations/schemas";
import { requireAuth } from "@/lib/api-helpers";
import { canUseAiOptimizer } from "@/lib/plans";

export async function POST(request) {
  const { session, error } = await requireAuth();
  if (error) return error;

  await connectDB();
  const dbUser = await User.findById(session.userId).lean();
  const plan = dbUser?.subscriptionPlan || session.subscriptionPlan;

  if (!canUseAiOptimizer(plan) && session.role !== "admin") {
    return NextResponse.json(
      { error: "AI optimizer requires Elite plan." },
      { status: 403 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = optimizeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  let baseDefinition = parsed.data.definition;

  if (parsed.data.strategyId) {
    const s = await Strategy.findOne({ _id: parsed.data.strategyId, userId: session.userId });
    if (!s) {
      return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
    }
    baseDefinition = s.definition;
  }

  if (!baseDefinition) {
    return NextResponse.json({ error: "Provide strategyId or definition" }, { status: 400 });
  }

  const ohlcv = await fetchOHLCV(parsed.data.symbol, parsed.data.timeframe, parsed.data.candleLimit);
  const series = ohlcvToSeries(ohlcv);
  if (!series.closes.length) {
    return NextResponse.json({ error: "No market data" }, { status: 502 });
  }

  const ranked = optimizeOnSeries(baseDefinition, series, { count: parsed.data.count });
  const best = ranked[0];
  if (!best) {
    return NextResponse.json({ error: "Optimization produced no results" }, { status: 500 });
  }

  let saved = null;
  if (parsed.data.save && parsed.data.strategyId) {
    const parent = await Strategy.findById(parsed.data.strategyId);
    if (parent && String(parent.userId) === session.userId) {
      saved = await Strategy.create({
        userId: session.userId,
        name: `${parent.name} (optimized)`,
        definition: best.definition,
        source: "optimized",
        parentStrategyId: parent._id,
        optimizationMeta: {
          score: best.score,
          backtestProfit: best.backtest.totalProfit,
          winRate: best.backtest.winRate,
          maxDrawdown: best.backtest.maxDrawdown,
          trades: best.backtest.trades,
        },
      });
    }
  }

  return NextResponse.json({
    best: {
      score: best.score,
      definition: best.definition,
      riskMeta: best.riskMeta,
      backtest: best.backtest,
    },
    top5: ranked.slice(0, 5).map((r) => ({
      score: r.score,
      backtest: r.backtest,
      riskMeta: r.riskMeta,
    })),
    savedStrategyId: saved ? String(saved._id) : null,
  });
}

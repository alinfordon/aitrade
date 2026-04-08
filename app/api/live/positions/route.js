import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import User from "@/models/User";
import Bot from "@/models/Bot";
import Trade from "@/models/Trade";
import "@/models/Strategy";
import { requireAuth } from "@/lib/api-helpers";
import { respondIfMongoMissing } from "@/lib/mongo-env";
import { getPrice } from "@/lib/binance/service";
import { normSpotPair } from "@/lib/market-defaults";
import { summarizeStrategyDefinition } from "@/lib/strategy-human-summary";

export const dynamic = "force-dynamic";

export async function GET() {
  const missing = respondIfMongoMissing();
  if (missing) return missing;

  const { session, error } = await requireAuth();
  if (error) return error;

  await connectDB();
  const user = await User.findById(session.userId).lean();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const book =
    user.manualSpotBook && typeof user.manualSpotBook === "object" && !Array.isArray(user.manualSpotBook)
      ? user.manualSpotBook
      : {};
  const prot =
    user.liveProtections && typeof user.liveProtections === "object" && !Array.isArray(user.liveProtections)
      ? user.liveProtections
      : {};

  const manual = [];

  for (const [pair, raw] of Object.entries(book)) {
    const qty = Number(raw?.qty ?? 0);
    if (!Number.isFinite(qty) || qty <= 1e-12) continue;
    const avgEntry = Number(raw?.avg ?? raw?.avgEntry ?? 0);
    let markPrice = null;
    try {
      const mp = await getPrice(pair);
      markPrice = Number.isFinite(mp) && mp > 0 ? mp : null;
    } catch {
      markPrice = null;
    }
    const p = prot[pair] || {};
    manual.push({
      pair,
      qty,
      avgEntry,
      markPrice,
      stopLoss: p.stopLoss != null ? Number(p.stopLoss) : null,
      takeProfit: p.takeProfit != null ? Number(p.takeProfit) : null,
      source: "manual",
      paper: raw?.paper === true,
      origin: "user",
    });
  }

  const pairsNorm = [...new Set(manual.map((m) => normSpotPair(m.pair)))];
  if (pairsNorm.length > 0) {
    const uid = new mongoose.Types.ObjectId(String(session.userId));
    const latestByPair = await Trade.aggregate([
      {
        $match: {
          userId: uid,
          tradeSource: "manual",
          side: "buy",
          status: { $in: ["filled", "simulated"] },
          pair: { $in: pairsNorm },
        },
      },
      { $sort: { createdAt: -1 } },
      { $group: { _id: "$pair", meta: { $first: "$meta" } } },
    ]);
    const pilotPairSet = new Set();
    for (const row of latestByPair) {
      if (row.meta && typeof row.meta === "object" && row.meta.aiPilotControl) {
        pilotPairSet.add(normSpotPair(row._id));
      }
    }
    for (const m of manual) {
      m.origin = pilotPairSet.has(normSpotPair(m.pair)) ? "pilot" : "user";
    }
  }

  const botDocs = await Bot.find({
    userId: session.userId,
    $or: [{ "positionState.open": true }, { mode: "paper", "paperState.open": true }],
  })
    .populate("strategyId", "name definition source safeMode")
    .lean();

  const bots = [];
  for (const b of botDocs) {
    let qty = 0;
    let entryPrice = 0;
    let side = "buy";
    if (b.mode === "paper" && b.paperState?.open) {
      qty = Number(b.paperState.baseBalance ?? 0);
      entryPrice = Number(b.paperState.avgEntry ?? 0);
      side = "buy";
    } else if (b.positionState?.open) {
      const ps = b.positionState || {};
      qty = Number(ps.quantity ?? 0);
      entryPrice = Number(ps.entryPrice ?? 0);
      side = ps.side || "buy";
    }
    if (!Number.isFinite(qty) || qty <= 1e-12) continue;

    let markPrice = null;
    try {
      const mp = await getPrice(b.pair);
      markPrice = Number.isFinite(mp) && mp > 0 ? mp : null;
    } catch {
      markPrice = null;
    }

    const strat = b.strategyId && typeof b.strategyId === "object" ? b.strategyId : null;
    const strategySummary = strat?.definition
      ? summarizeStrategyDefinition(strat.definition)
      : { entryLines: [], exitLines: [] };

    bots.push({
      botId: String(b._id),
      pair: b.pair,
      qty,
      avgEntry: entryPrice,
      side,
      markPrice,
      stopLoss: b.risk?.stopLossPct ?? null,
      takeProfit: b.risk?.takeProfitPct ?? null,
      source: "bot",
      botStatus: b.status,
      strategyName: strat?.name || "—",
      strategySource: strat?.source ?? null,
      strategySafeMode: Boolean(strat?.safeMode),
      origin: strat?.source === "pilot" ? "pilot" : "user",
      strategySummary,
      botMode: b.mode,
      futuresEnabled: Boolean(b.futuresEnabled),
      lastRun: b.lastRun ? new Date(b.lastRun).toISOString() : null,
      risk: b.risk || {},
    });
  }

  return NextResponse.json({ manual, bots });
}

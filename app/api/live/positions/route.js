import { createHash } from "node:crypto";
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

/**
 * Amprentă poziții (fără mark / lastRun / strategySummary) — detectează schimbări reale de poziție sau SL/TP.
 */
function structureFingerprint(manual, bots) {
  const m = [...manual]
    .map((x) => ({
      pair: normSpotPair(x.pair),
      qty: x.qty,
      avgEntry: x.avgEntry,
      paper: Boolean(x.paper),
      origin: x.origin,
      stopLoss: x.stopLoss,
      takeProfit: x.takeProfit,
    }))
    .sort((a, b) => a.pair.localeCompare(b.pair));
  const b = [...bots]
    .map((x) => ({
      botId: x.botId,
      pair: normSpotPair(x.pair),
      qty: x.qty,
      avgEntry: x.avgEntry,
      side: x.side,
      botMode: x.botMode,
      stopLoss: x.stopLoss,
      takeProfit: x.takeProfit,
      strategyName: x.strategyName,
      strategySource: x.strategySource,
      botStatus: x.botStatus,
    }))
    .sort((a, b) => String(a.botId).localeCompare(String(b.botId)));
  return createHash("sha256").update(JSON.stringify({ m, b })).digest("hex").slice(0, 24);
}

async function markPricesForPairs(pairs) {
  const uniq = [...new Set(pairs.filter(Boolean))];
  const entries = await Promise.all(
    uniq.map(async (pair) => {
      try {
        const mp = await getPrice(pair);
        return [pair, Number.isFinite(mp) && mp > 0 ? mp : null];
      } catch {
        return [pair, null];
      }
    })
  );
  return new Map(entries);
}

export async function GET(request) {
  const missing = respondIfMongoMissing();
  if (missing) return missing;

  const { searchParams } = new URL(request.url);
  const structureOnly = searchParams.get("structure") === "1";

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
    const p = prot[pair] || {};
    manual.push({
      pair,
      qty,
      avgEntry,
      markPrice: null,
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
      markPrice: null,
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

  if (!structureOnly) {
    const pricePairs = [...new Set([...manual.map((m) => m.pair), ...bots.map((b) => b.pair)])];
    const markByPair = await markPricesForPairs(pricePairs);
    for (const m of manual) {
      m.markPrice = markByPair.get(m.pair) ?? null;
    }
    for (const b of bots) {
      b.markPrice = markByPair.get(b.pair) ?? null;
    }
  }

  const structureFp = structureFingerprint(manual, bots);

  return NextResponse.json({
    manual,
    bots,
    structureFp,
    ...(structureOnly ? { structureOnly: true } : {}),
  });
}

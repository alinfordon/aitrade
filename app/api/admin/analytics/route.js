import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import User from "@/models/User";
import Bot from "@/models/Bot";
import Trade from "@/models/Trade";
import { requireAdmin } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

function utcMidnightDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Raport analytics admin: tenduri UTC, fără date personale sensibile în afara agregatelor.
 */
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  await connectDB();

  const rangeDays = 14;
  const since = utcMidnightDaysAgo(rangeDays);
  const dayAgo = new Date(Date.now() - 86400000);

  const [
    usersTotal,
    botsTotal,
    botsActive,
    tradesTotal,
    tradesByDay,
    usersByDay,
    tradeSourceBreakdown,
    paperVsReal,
    pilotStats,
    topPairs,
    topPairs24h,
    failedStats,
  ] = await Promise.all([
    User.countDocuments(),
    Bot.countDocuments(),
    Bot.countDocuments({ status: "active" }),
    Trade.countDocuments(),
    Trade.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" },
          },
          count: { $sum: 1 },
          failed: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
          pnlLive: {
            $sum: {
              $cond: [{ $eq: ["$isPaper", false] }, { $ifNull: ["$pnl", 0] }, 0],
            },
          },
          pnlPaper: {
            $sum: {
              $cond: [{ $eq: ["$isPaper", true] }, { $ifNull: ["$pnl", 0] }, 0],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    User.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Trade.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $ifNull: ["$tradeSource", "bot"] },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]),
    Trade.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: "$isPaper",
          count: { $sum: 1 },
        },
      },
    ]),
    Trade.aggregate([
      {
        $facet: {
          total: [{ $match: { "meta.aiPilotControl": true } }, { $count: "n" }],
          last24h: [
            { $match: { createdAt: { $gte: dayAgo }, "meta.aiPilotControl": true } },
            { $count: "n" },
          ],
        },
      },
    ]),
    Trade.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: "$pair", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 15 },
    ]),
    Trade.aggregate([
      { $match: { createdAt: { $gte: dayAgo } } },
      { $group: { _id: "$pair", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    Trade.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          failed: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const pilotFacet = pilotStats[0] || {};
  const pilotTotal = pilotFacet.total?.[0]?.n ?? 0;
  const pilot24h = pilotFacet.last24h?.[0]?.n ?? 0;

  const paperRealMap = Object.fromEntries(
    (paperVsReal || []).map((r) => [r._id === true ? "paper" : "real", r.count])
  );

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    timezoneNote: "UTC",
    rangeDays,
    since: since.toISOString(),
    totals: {
      users: usersTotal,
      bots: botsTotal,
      botsActive,
      trades: tradesTotal,
    },
    tradesByDay: (tradesByDay || []).map((r) => ({
      date: r._id,
      count: r.count,
      failed: r.failed,
      pnlLiveSum: Number(r.pnlLive) || 0,
      pnlPaperSum: Number(r.pnlPaper) || 0,
    })),
    usersByDay: (usersByDay || []).map((r) => ({
      date: r._id,
      count: r.count,
    })),
    tradeSource: (tradeSourceBreakdown || []).map((r) => ({
      source: String(r._id || "unknown"),
      count: r.count,
    })),
    paperVsReal: {
      paper: paperRealMap.paper ?? 0,
      real: paperRealMap.real ?? 0,
    },
    aiPilot: {
      tradesTotal: pilotTotal,
      tradesLast24h: pilot24h,
    },
    topPairs: (topPairs || []).map((r) => ({ pair: r._id, count: r.count })),
    topPairs24h: (topPairs24h || []).map((r) => ({ pair: r._id, count: r.count })),
    reliability: {
      windowTrades: failedStats[0]?.total ?? 0,
      windowFailed: failedStats[0]?.failed ?? 0,
      failRate:
        failedStats[0]?.total > 0 ? failedStats[0].failed / failedStats[0].total : 0,
    },
  });
}

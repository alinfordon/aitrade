import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/models/db";
import Trade from "@/models/Trade";
import { requireAuth } from "@/lib/api-helpers";
import { respondIfMongoMissing } from "@/lib/mongo-env";

export const dynamic = "force-dynamic";

/**
 * Curbe cumulative PnL live (isPaper: false), aceeași zi/lună ca agregările UTC din live-stats.
 * Nu este soldul efectiv Binance — doar evoluția profit/pierdere realizată din tranzacții.
 */
export async function GET() {
  const missing = respondIfMongoMissing();
  if (missing) return missing;

  const { session, error } = await requireAuth();
  if (error) return error;

  await connectDB();
  const oid = new mongoose.Types.ObjectId(session.userId);
  const now = new Date();

  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));

  const hourlyAgg = await Trade.aggregate([
    {
      $match: {
        userId: oid,
        isPaper: false,
        createdAt: { $gte: dayStart, $lte: now },
      },
    },
    {
      $group: {
        _id: { $hour: "$createdAt" },
        sumPnl: { $sum: { $ifNull: ["$pnl", 0] } },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const hourlyMap = new Map(hourlyAgg.map((h) => [h._id, Number(h.sumPnl) || 0]));
  const currentHour = now.getUTCHours();
  let cumDay = 0;
  const daySeries = [];
  for (let h = 0; h <= currentHour; h++) {
    const delta = hourlyMap.get(h) ?? 0;
    cumDay += delta;
    daySeries.push({
      key: h,
      label: `${String(h).padStart(2, "0")}:00`,
      labelFull: `${String(h).padStart(2, "0")}:00 UTC`,
      cumulative: Number(cumDay.toFixed(6)),
      delta: Number(delta.toFixed(6)),
    });
  }

  const dailyAgg = await Trade.aggregate([
    {
      $match: {
        userId: oid,
        isPaper: false,
        createdAt: { $gte: monthStart, $lte: now },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" },
        },
        sumPnl: { $sum: { $ifNull: ["$pnl", 0] } },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const dailyMap = new Map(dailyAgg.map((d) => [d._id, Number(d.sumPnl) || 0]));
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const lastDay = now.getUTCDate();
  const dayKeys = [];
  for (let d = 1; d <= lastDay; d++) {
    const key = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    dayKeys.push(key);
  }

  let cumMonth = 0;
  const monthSeries = [];
  for (const dk of dayKeys) {
    const delta = dailyMap.get(dk) ?? 0;
    cumMonth += delta;
    const [, mm, dd] = dk.split("-");
    monthSeries.push({
      key: dk,
      label: `${dd}/${mm}`,
      labelFull: dk,
      cumulative: Number(cumMonth.toFixed(6)),
      delta: Number(delta.toFixed(6)),
    });
  }

  return NextResponse.json({
    disclaimer:
      "Curbă din PnL cumulat pe tranzacții live (UTC), nu soldul total USDC din cont.",
    timezoneNote: "UTC (aceeași zi ca „PnL azi (live)” din dashboard).",
    day: {
      rangeFrom: dayStart.toISOString(),
      rangeTo: now.toISOString(),
      points: daySeries,
      finalCumulative: daySeries.length ? daySeries[daySeries.length - 1].cumulative : 0,
    },
    month: {
      rangeFrom: monthStart.toISOString(),
      rangeTo: now.toISOString(),
      points: monthSeries,
      finalCumulative: monthSeries.length ? monthSeries[monthSeries.length - 1].cumulative : 0,
    },
  });
}

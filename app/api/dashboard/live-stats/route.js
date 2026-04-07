import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/models/db";
import Trade from "@/models/Trade";
import { requireAuth } from "@/lib/api-helpers";
import { respondIfMongoMissing } from "@/lib/mongo-env";

export const dynamic = "force-dynamic";

/**
 * Statistici dashboard: doar tranzacții live (isPaper: false), nu paper/simulate.
 */
export async function GET() {
  const missing = respondIfMongoMissing();
  if (missing) return missing;

  const { session, error } = await requireAuth();
  if (error) return error;

  await connectDB();
  const oid = new mongoose.Types.ObjectId(session.userId);

  const [totals] = await Trade.aggregate([
    { $match: { userId: oid, isPaper: false } },
    { $match: { pnl: { $exists: true, $ne: null } } },
    {
      $group: {
        _id: null,
        totalProfit: { $sum: "$pnl" },
        tradesWithPnl: { $sum: 1 },
        winTrades: { $sum: { $cond: [{ $gt: ["$pnl", 0] }, 1, 0] } },
      },
    },
  ]);

  const startUtc = new Date();
  startUtc.setUTCHours(0, 0, 0, 0);

  const [todayAgg] = await Trade.aggregate([
    {
      $match: {
        userId: oid,
        isPaper: false,
        createdAt: { $gte: startUtc },
      },
    },
    { $match: { pnl: { $exists: true, $ne: null } } },
    {
      $group: {
        _id: null,
        todayPnl: { $sum: "$pnl" },
      },
    },
  ]);

  const totalProfit = totals?.totalProfit != null ? Number(totals.totalProfit) : 0;
  const tradesWithPnl = totals?.tradesWithPnl != null ? Number(totals.tradesWithPnl) : 0;
  const winTrades = totals?.winTrades != null ? Number(totals.winTrades) : 0;
  const winRate = tradesWithPnl > 0 ? winTrades / tradesWithPnl : 0;
  const todayPnl = todayAgg?.todayPnl != null ? Number(todayAgg.todayPnl) : 0;

  return NextResponse.json({
    live: {
      totalProfit,
      tradesWithPnl,
      winTrades,
      winRate,
      todayPnl,
      todayUtc: startUtc.toISOString().slice(0, 10),
    },
  });
}

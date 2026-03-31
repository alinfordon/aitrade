import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import User from "@/models/User";

export const dynamic = "force-dynamic";

/** Public leaderboard: top traders by modeled performance (no emails leaked — id only). */
export async function GET() {
  await connectDB();
  const rows = await User.find({ role: "user" })
    .sort({ "stats.totalProfit": -1 })
    .limit(50)
    .select("stats subscriptionPlan createdAt")
    .lean();

  const ranked = rows.map((u, i) => ({
    rank: i + 1,
    userId: String(u._id),
    totalProfit: u.stats?.totalProfit ?? 0,
    winRate:
      u.stats?.totalTrades > 0 ? (u.stats.winTrades || 0) / u.stats.totalTrades : 0,
    totalTrades: u.stats?.totalTrades ?? 0,
    plan: u.subscriptionPlan,
  }));

  return NextResponse.json({ leaderboard: ranked });
}

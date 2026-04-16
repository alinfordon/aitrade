import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import User from "@/models/User";
import { respondIfMongoMissing } from "@/lib/mongo-env";

export const dynamic = "force-dynamic";

/** Public leaderboard: top traders by modeled performance (displayName, fallback email). */
export async function GET() {
  const missing = respondIfMongoMissing();
  if (missing) return missing;

  try {
    await connectDB();
    const rows = await User.find({})
      .sort({ "stats.totalProfit": -1 })
      .limit(50)
      .select("stats subscriptionPlan displayName email createdAt")
      .lean();

    const ranked = rows.map((u, i) => ({
      rank: i + 1,
      userId: String(u._id),
      displayName: (u.displayName && String(u.displayName).trim()) || "",
      email: (u.email && String(u.email).trim()) || "",
      totalProfit: u.stats?.totalProfit ?? 0,
      winRate:
        u.stats?.totalTrades > 0 ? (u.stats.winTrades || 0) / u.stats.totalTrades : 0,
      totalTrades: u.stats?.totalTrades ?? 0,
      plan: u.subscriptionPlan,
    }));

    return NextResponse.json({ leaderboard: ranked });
  } catch (e) {
    console.error("[api/leaderboard]", e);
    return NextResponse.json(
      { error: "Leaderboard indisponibil momentan.", leaderboard: [] },
      { status: 500 }
    );
  }
}

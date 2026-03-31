import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import User from "@/models/User";
import Bot from "@/models/Bot";
import Trade from "@/models/Trade";
import Strategy from "@/models/Strategy";
import Follow from "@/models/Follow";
import { requireAdmin } from "@/lib/api-helpers";

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  await connectDB();
  const dayAgo = new Date(Date.now() - 86400000);

  const [
    usersTotal,
    usersByPlan,
    botsTotal,
    botsActive,
    botsPaper,
    botsReal,
    strategiesTotal,
    followsActive,
    tradesTotal,
    trades24h,
    tradesFailed24h,
    recentUsers,
    recentTrades,
  ] = await Promise.all([
    User.countDocuments(),
    User.aggregate([{ $group: { _id: "$subscriptionPlan", n: { $sum: 1 } } }]),
    Bot.countDocuments(),
    Bot.countDocuments({ status: "active" }),
    Bot.countDocuments({ mode: "paper" }),
    Bot.countDocuments({ mode: "real" }),
    Strategy.countDocuments(),
    Follow.countDocuments({ active: true }),
    Trade.countDocuments(),
    Trade.countDocuments({ createdAt: { $gte: dayAgo } }),
    Trade.countDocuments({ createdAt: { $gte: dayAgo }, status: "failed" }),
    User.find()
      .sort({ createdAt: -1 })
      .limit(12)
      .select("email subscriptionPlan role createdAt")
      .lean(),
    Trade.find()
      .sort({ createdAt: -1 })
      .limit(20)
      .select("pair side quantity price status isPaper pnl userId createdAt botId")
      .lean(),
  ]);

  const planBreakdown = Object.fromEntries(
    (usersByPlan || []).map((r) => [r._id || "unknown", r.n])
  );

  return NextResponse.json({
    usersTotal,
    planBreakdown,
    botsTotal,
    botsActive,
    botsPaper,
    botsReal,
    strategiesTotal,
    followsActive,
    tradesTotal,
    trades24h,
    tradesFailed24h,
    recentUsers: (recentUsers || []).map((u) => ({
      id: String(u._id),
      email: u.email,
      subscriptionPlan: u.subscriptionPlan,
      role: u.role,
      createdAt: u.createdAt,
    })),
    recentTrades: (recentTrades || []).map((t) => ({
      id: String(t._id),
      pair: t.pair,
      side: t.side,
      quantity: t.quantity,
      price: t.price,
      status: t.status,
      isPaper: t.isPaper,
      pnl: t.pnl,
      userId: t.userId ? String(t.userId) : null,
      botId: t.botId ? String(t.botId) : null,
      createdAt: t.createdAt,
    })),
  });
}

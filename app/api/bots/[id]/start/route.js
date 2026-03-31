import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import { Bot } from "@/models";
import { requireAuth } from "@/lib/api-helpers";
import { maxBotsForPlan } from "@/lib/plans";

export async function POST(_, { params }) {
  const { session, error } = await requireAuth();
  if (error) return error;
  await connectDB();

  const max = maxBotsForPlan(session.subscriptionPlan);
  const activeCount = await Bot.countDocuments({
    userId: session.userId,
    status: "active",
  });
  if (Number.isFinite(max) && activeCount >= max) {
    return NextResponse.json(
      { error: `Active bot limit reached for your plan (${max}).` },
      { status: 403 }
    );
  }

  const bot = await Bot.findOne({ _id: params.id, userId: session.userId });
  if (!bot) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (bot.mode === "real") {
    const { default: User } = await import("@/models/User");
    const user = await User.findById(session.userId);
    if (!user?.apiKeyEncrypted || !user?.apiSecretEncrypted) {
      return NextResponse.json(
        { error: "Add Binance API keys under Settings before live trading." },
        { status: 400 }
      );
    }
  }

  bot.status = "active";
  await bot.save();
  return NextResponse.json({ bot });
}

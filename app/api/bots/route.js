import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import { Bot, Strategy } from "@/models";
import { createBotSchema } from "@/lib/validations/schemas";
import { requireAuth } from "@/lib/api-helpers";
import { maxBotsForPlan } from "@/lib/plans";

export async function GET() {
  const { session, error } = await requireAuth();
  if (error) return error;
  await connectDB();
  const bots = await Bot.find({ userId: session.userId }).populate("strategyId").sort({ updatedAt: -1 }).lean();
  return NextResponse.json({ bots });
}

export async function POST(request) {
  const { session, error } = await requireAuth();
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createBotSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await connectDB();
  const max = maxBotsForPlan(session.subscriptionPlan);
  const count = await Bot.countDocuments({ userId: session.userId });
  if (Number.isFinite(max) && count >= max) {
    return NextResponse.json(
      { error: `Plan limit reached (${max} bots). Upgrade to add more.` },
      { status: 403 }
    );
  }

  const strat = await Strategy.findOne({ _id: parsed.data.strategyId, userId: session.userId });
  if (!strat) {
    return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  }

  const risk = parsed.data.risk || {};
  const bot = await Bot.create({
    userId: session.userId,
    strategyId: strat._id,
    pair: parsed.data.pair,
    mode: parsed.data.mode,
    status: "stopped",
    risk: {
      stopLossPct: risk.stopLossPct ?? 2,
      takeProfitPct: risk.takeProfitPct ?? 3,
      maxDailyLossPct: risk.maxDailyLossPct ?? 5,
      positionSizePct: risk.positionSizePct ?? 10,
    },
    paperState: {
      quoteBalance: 10000,
      baseBalance: 0,
      avgEntry: 0,
      open: false,
    },
  });

  const populated = await Bot.findById(bot._id).populate("strategyId").lean();
  return NextResponse.json({ bot: populated });
}

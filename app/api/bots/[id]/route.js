import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import { Bot, Strategy } from "@/models";
import { requireAuth } from "@/lib/api-helpers";
import { z } from "zod";

const patchSchema = z.object({
  pair: z.string().min(3).max(32).optional(),
  mode: z.enum(["real", "paper"]).optional(),
  strategyId: z.string().min(1).optional(),
  risk: z
    .object({
      stopLossPct: z.number().optional(),
      takeProfitPct: z.number().optional(),
      maxDailyLossPct: z.number().optional(),
      positionSizePct: z.number().optional(),
    })
    .optional(),
});

export async function PATCH(request, { params }) {
  const { session, error } = await requireAuth();
  if (error) return error;
  const id = params.id;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await connectDB();
  const bot = await Bot.findOne({ _id: id, userId: session.userId });
  if (!bot) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (parsed.data.strategyId != null) {
    if (bot.status === "active") {
      return NextResponse.json(
        { error: "Oprește botul înainte de a schimba strategia." },
        { status: 409 }
      );
    }
    const strat = await Strategy.findOne({ _id: parsed.data.strategyId, userId: session.userId });
    if (!strat) {
      return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
    }
    bot.strategyId = strat._id;
  }

  if (parsed.data.pair) bot.pair = parsed.data.pair.trim();
  if (parsed.data.mode) bot.mode = parsed.data.mode;
  if (parsed.data.risk) {
    const cur = bot.risk && typeof bot.risk === "object" ? { ...bot.risk.toObject?.() ?? bot.risk } : {};
    bot.risk = { ...cur, ...parsed.data.risk };
  }
  await bot.save();
  return NextResponse.json({ bot });
}

export async function DELETE(_, { params }) {
  const { session, error } = await requireAuth();
  if (error) return error;
  await connectDB();
  const r = await Bot.deleteOne({ _id: params.id, userId: session.userId });
  if (!r.deletedCount) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

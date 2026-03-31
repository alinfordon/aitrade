import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/models/db";
import Trade from "@/models/Trade";
import Bot from "@/models/Bot";
import { requireAuth } from "@/lib/api-helpers";

export async function GET(request) {
  const { session, error } = await requireAuth();
  if (error) return error;
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") || 50), 200);
  const botIdRaw = searchParams.get("botId");

  await connectDB();
  const filter = { userId: session.userId };
  if (botIdRaw) {
    if (!mongoose.Types.ObjectId.isValid(botIdRaw)) {
      return NextResponse.json({ error: "Invalid botId" }, { status: 400 });
    }
    const owned = await Bot.findOne({ _id: botIdRaw, userId: session.userId }).select("_id").lean();
    if (!owned) {
      return NextResponse.json({ error: "Bot not found" }, { status: 404 });
    }
    filter.botId = botIdRaw;
  }
  const trades = await Trade.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  return NextResponse.json({ trades });
}

import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/models/db";
import Trade from "@/models/Trade";
import Bot from "@/models/Bot";
import { requireAuth } from "@/lib/api-helpers";
import { normSpotPair } from "@/lib/market-defaults";

export async function GET(request) {
  const { session, error } = await requireAuth();
  if (error) return error;
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") || 50), 200);
  const botIdRaw = searchParams.get("botId");
  const pairRaw = searchParams.get("pair");
  const tradeSourceRaw = searchParams.get("tradeSource");
  const aiPilotControl =
    searchParams.get("aiPilotControl") === "1" || searchParams.get("aiPilot") === "1";
  /** Toate tranzacțiile cu botId setat (motor cron + manual pilot legat de bot). */
  const anyBot = searchParams.get("anyBot") === "1";
  const isPaperRaw = searchParams.get("isPaper");
  const sideRaw = searchParams.get("side");
  const fromRaw = searchParams.get("from");
  const toRaw = searchParams.get("to");

  await connectDB();
  const filter = { userId: session.userId };
  if (anyBot) {
    filter.botId = { $exists: true, $ne: null };
  }
  if (aiPilotControl) {
    filter["meta.aiPilotControl"] = true;
  }
  if (isPaperRaw === "1" || isPaperRaw === "true") {
    filter.isPaper = true;
  } else if (isPaperRaw === "0" || isPaperRaw === "false") {
    filter.$or = [{ isPaper: false }, { isPaper: { $exists: false } }];
  }
  if (pairRaw && String(pairRaw).trim()) {
    filter.pair = normSpotPair(pairRaw);
  }
  if (tradeSourceRaw === "manual" || tradeSourceRaw === "bot" || tradeSourceRaw === "copy") {
    filter.tradeSource = tradeSourceRaw;
  }
  if (sideRaw === "buy" || sideRaw === "sell") {
    filter.side = sideRaw;
  }
  if (fromRaw || toRaw) {
    const range = {};
    if (fromRaw) {
      const d = new Date(fromRaw);
      if (!Number.isNaN(d.getTime())) range.$gte = d;
    }
    if (toRaw) {
      const d = new Date(toRaw);
      if (!Number.isNaN(d.getTime())) range.$lt = d;
    }
    if (Object.keys(range).length) filter.createdAt = range;
  }
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

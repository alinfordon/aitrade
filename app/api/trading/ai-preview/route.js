import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import User from "@/models/User";
import { Bot } from "@/models";
import { requireAuth } from "@/lib/api-helpers";
import { respondIfMongoMissing } from "@/lib/mongo-env";
import { tradingAiPreRequestSchema } from "@/lib/validations/schemas";
import { canUsePreTradeAiAnalysis } from "@/lib/plans";
import { rateLimit } from "@/lib/redis/rate-limit";
import { getPrice } from "@/lib/binance/service";
import { runTradingPreTradeAnalysis } from "@/lib/ai/trading-preact-analyze";
import { buildAiRuntime, missingProviderKeyMessage, isAiProviderConfigured } from "@/lib/ai/ai-preferences";

export const dynamic = "force-dynamic";

const RL_MAX = 30;
const RL_WINDOW_SEC = 3600;

function normPairKey(p) {
  return String(p || "")
    .trim()
    .toUpperCase()
    .replace(/-/g, "/");
}

export async function POST(request) {
  const missing = respondIfMongoMissing();
  if (missing) return missing;

  const { session, error } = await requireAuth();
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalid" }, { status: 400 });
  }

  const parsed = tradingAiPreRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join(" · ") },
      { status: 400 }
    );
  }

  const { pair, side, timeframe } = parsed.data;

  const rl = await rateLimit(`trading-ai-preview:user:${session.userId}`, RL_MAX, RL_WINDOW_SEC);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Prea multe analize AI. Încearcă mai târziu.", retryAfterSec: rl.retryAfterSec },
      { status: 429 }
    );
  }

  await connectDB();
  const user = await User.findById(session.userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const aiRuntime = buildAiRuntime(user);
  if (!isAiProviderConfigured(user)) {
    return NextResponse.json({ error: missingProviderKeyMessage(aiRuntime.provider) }, { status: 503 });
  }

  if (!canUsePreTradeAiAnalysis(user.subscriptionPlan)) {
    return NextResponse.json(
      { error: "Analiza AI pre-tranzacție este disponibilă pe planurile Pro și Elite." },
      { status: 403 }
    );
  }

  const pairKey = normPairKey(pair);
  const botsRaw = await Bot.find({ userId: session.userId }).populate("strategyId").lean();
  const botsOnPair = botsRaw
    .filter((b) => normPairKey(b.pair) === pairKey)
    .map((b) => ({
      strategyName: String(b.strategyId?.name ?? "Strategie"),
      status: String(b.status ?? ""),
      mode: String(b.mode ?? ""),
    }));

  let markPrice = null;
  try {
    const mp = await getPrice(pair);
    markPrice = Number.isFinite(mp) && mp > 0 ? mp : null;
  } catch {
    markPrice = null;
  }

  let analysis;
  try {
    analysis = await runTradingPreTradeAnalysis({
      pair,
      side,
      timeframe,
      markPrice,
      botsOnPair,
      aiRuntime,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/GEMINI_API_KEY|ANTHROPIC_API_KEY|Ollama:/i.test(msg)) {
      return NextResponse.json({ error: missingProviderKeyMessage(aiRuntime.provider) }, { status: 503 });
    }
    if (e?.code === "MARKET_NOT_FOUND") {
      return NextResponse.json({ error: msg.slice(0, 500) }, { status: 404 });
    }
    return NextResponse.json({ error: msg.slice(0, 500) }, { status: 502 });
  }

  return NextResponse.json({
    pair,
    side,
    timeframe,
    ...analysis,
  });
}

import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import User from "@/models/User";
import { requireAuth } from "@/lib/api-helpers";
import { respondIfMongoMissing } from "@/lib/mongo-env";
import { liveAiProtectRequestSchema } from "@/lib/validations/schemas";
import { canUseLiveAiAnalysis } from "@/lib/plans";
import { rateLimit } from "@/lib/redis/rate-limit";
import { getPrice } from "@/lib/binance/service";
import { runLivePositionProtectAnalysis } from "@/lib/ai/live-position-analyze";

export const dynamic = "force-dynamic";

const RL_MAX = 24;
const RL_WINDOW_SEC = 3600;

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

  const parsed = liveAiProtectRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join(" · ") },
      { status: 400 }
    );
  }

  const { pair, apply } = parsed.data;

  const rl = await rateLimit(`live-ai-protect:user:${session.userId}`, RL_MAX, RL_WINDOW_SEC);
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

  if (!canUseLiveAiAnalysis(user.subscriptionPlan)) {
    return NextResponse.json(
      { error: "Analiza AI pentru SL/TP este disponibilă pe planurile Pro și Elite." },
      { status: 403 }
    );
  }

  const book =
    user.manualSpotBook && typeof user.manualSpotBook === "object" && !Array.isArray(user.manualSpotBook)
      ? user.manualSpotBook
      : {};
  const row = book[pair];
  const qty = Number(row?.qty ?? 0);
  if (!Number.isFinite(qty) || qty <= 1e-12) {
    return NextResponse.json({ error: "Nu există poziție manuală deschisă pentru această pereche." }, { status: 404 });
  }

  const avgEntry = Number(row?.avg ?? row?.avgEntry ?? 0);
  if (!Number.isFinite(avgEntry) || avgEntry <= 0) {
    return NextResponse.json({ error: "Preț mediu intrare invalid în carte." }, { status: 400 });
  }

  let markPrice = null;
  try {
    const mp = await getPrice(pair);
    markPrice = Number.isFinite(mp) && mp > 0 ? mp : null;
  } catch {
    markPrice = null;
  }

  let analysis;
  try {
    analysis = await runLivePositionProtectAnalysis({
      pair,
      avgEntry,
      qty,
      markPrice,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/GEMINI_API_KEY/i.test(msg)) {
      return NextResponse.json({ error: "Serviciul AI nu este configurat (cheie Gemini lipsă)." }, { status: 503 });
    }
    return NextResponse.json({ error: msg.slice(0, 500) }, { status: 502 });
  }

  let applied = false;
  if (apply === true) {
    const live =
      user.liveProtections && typeof user.liveProtections === "object" && !Array.isArray(user.liveProtections)
        ? { ...user.liveProtections }
        : {};
    const cur = { ...(live[pair] && typeof live[pair] === "object" ? live[pair] : {}) };
    cur.stopLoss = analysis.stopLoss;
    cur.takeProfit = analysis.takeProfit;
    live[pair] = cur;
    user.liveProtections = live;
    await user.save();
    applied = true;
  }

  return NextResponse.json({
    pair,
    ...analysis,
    applied,
  });
}

import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import User from "@/models/User";
import { requireAuth } from "@/lib/api-helpers";
import { respondIfMongoMissing } from "@/lib/mongo-env";
import { liveProtectSchema } from "@/lib/validations/schemas";
import { syncLiveProtectionOco } from "@/server/trading/live-protection-sync";

export const dynamic = "force-dynamic";

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

  const parsed = liveProtectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join(" · ") },
      { status: 400 }
    );
  }

  const { pair, stopLoss, takeProfit, clear } = parsed.data;

  await connectDB();
  const user = await User.findById(session.userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const live =
    user.liveProtections && typeof user.liveProtections === "object" && !Array.isArray(user.liveProtections)
      ? { ...user.liveProtections }
      : {};

  if (clear) {
    /** Păstrează tranzient `oco` ca syncLiveProtectionOco să știe ce să anuleze. */
    const had = live[pair] && typeof live[pair] === "object" ? live[pair] : null;
    if (had?.oco) {
      live[pair] = { oco: had.oco };
    } else {
      delete live[pair];
    }
    user.liveProtections = live;
    await user.save();
    const ocoRes = await syncLiveProtectionOco({
      userId: String(session.userId),
      pair,
      reason: "protection_cleared",
    });
    const fresh = await User.findById(session.userId).lean();
    return NextResponse.json({
      ok: true,
      liveProtections: fresh?.liveProtections || {},
      oco: ocoRes,
    });
  }

  const cur = { ...(live[pair] && typeof live[pair] === "object" ? live[pair] : {}) };
  if (stopLoss !== undefined) {
    if (stopLoss === null) delete cur.stopLoss;
    else cur.stopLoss = stopLoss;
  }
  if (takeProfit !== undefined) {
    if (takeProfit === null) delete cur.takeProfit;
    else cur.takeProfit = takeProfit;
  }

  const onlyHasOco =
    Object.keys(cur).length === 1 && cur.oco != null && cur.stopLoss == null && cur.takeProfit == null;
  if (Object.keys(cur).length === 0 || onlyHasOco) {
    /** Nu mai există SL/TP logic — păstrăm `oco` pentru ca sync-ul să-l anuleze. */
    if (cur.oco) {
      live[pair] = { oco: cur.oco };
    } else {
      delete live[pair];
    }
  } else {
    live[pair] = cur;
  }

  user.liveProtections = live;
  await user.save();

  const ocoRes = await syncLiveProtectionOco({
    userId: String(session.userId),
    pair,
    reason: "protection_saved",
  });
  const fresh = await User.findById(session.userId).lean();
  const freshProt = fresh?.liveProtections || {};

  return NextResponse.json({
    ok: true,
    pair,
    protection: freshProt[pair] || null,
    liveProtections: freshProt,
    oco: ocoRes,
  });
}

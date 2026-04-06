import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/models/db";
import User from "@/models/User";
import { Bot } from "@/models";
import { requireAuth } from "@/lib/api-helpers";
import { respondIfMongoMissing } from "@/lib/mongo-env";
import { aiPilotSettingsSchema } from "@/lib/validations/schemas";
import { canUseAiPilot } from "@/lib/plans";

export const dynamic = "force-dynamic";

export async function GET() {
  const missing = respondIfMongoMissing();
  if (missing) return missing;

  const { session, error } = await requireAuth();
  if (error) return error;

  await connectDB();
  const user = await User.findById(session.userId).lean();
  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const pilot = user.aiPilot && typeof user.aiPilot === "object" ? user.aiPilot : {};
  const bots = await Bot.find({ userId: session.userId })
    .select("_id pair mode status")
    .sort({ updatedAt: -1 })
    .lean();

  return NextResponse.json({
    canUse: canUseAiPilot(session.subscriptionPlan),
    settings: {
      enabled: Boolean(pilot.enabled),
      intervalMinutes: Number(pilot.intervalMinutes) || 15,
      botIds: (pilot.botIds || []).map((id) => String(id)),
      maxUsdcPerTrade: Number(pilot.maxUsdcPerTrade) || 150,
      pilotOrderMode: pilot.pilotOrderMode === "real" ? "real" : "paper",
      manualTradingEnabled: Boolean(pilot.manualTradingEnabled),
      createBotFromAnalysis: Boolean(pilot.createBotFromAnalysis),
      maxTradesPerRun: Math.min(20, Math.max(1, Number(pilot.maxTradesPerRun) || 3)),
      maxOpenManualPositions: Math.min(20, Math.max(1, Number(pilot.maxOpenManualPositions) || 3)),
      lastRunAt: pilot.lastRunAt ? new Date(pilot.lastRunAt).toISOString() : null,
      lastSummary: String(pilot.lastSummary || ""),
      lastError: String(pilot.lastError || ""),
    },
    bots: bots.map((b) => ({
      id: String(b._id),
      pair: b.pair,
      mode: b.mode,
      status: b.status,
    })),
  });
}

export async function PATCH(request) {
  const missing = respondIfMongoMissing();
  if (missing) return missing;

  const { session, error } = await requireAuth();
  if (error) return error;

  if (!canUseAiPilot(session.subscriptionPlan)) {
    return NextResponse.json(
      { error: "AI Pilot este disponibil pe planurile Pro și Elite." },
      { status: 403 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalid" }, { status: 400 });
  }

  const parsed = aiPilotSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join(" · ") },
      { status: 400 }
    );
  }

  await connectDB();

  const oids = [];
  if (parsed.data.botIds != null) {
    for (const id of parsed.data.botIds) {
      if (!mongoose.isValidObjectId(id)) {
        return NextResponse.json({ error: `ID bot invalid: ${id}` }, { status: 400 });
      }
      oids.push(new mongoose.Types.ObjectId(id));
    }
    if (oids.length) {
      const n = await Bot.countDocuments({ userId: session.userId, _id: { $in: oids } });
      if (n !== oids.length) {
        return NextResponse.json(
          { error: "Unul sau mai mulți boți nu aparțin contului tău." },
          { status: 400 }
        );
      }
    }
  }

  const patch = parsed.data;
  const $set = {};
  if (patch.enabled != null) $set["aiPilot.enabled"] = patch.enabled;
  if (patch.intervalMinutes != null) $set["aiPilot.intervalMinutes"] = patch.intervalMinutes;
  if (patch.maxUsdcPerTrade != null) $set["aiPilot.maxUsdcPerTrade"] = patch.maxUsdcPerTrade;
  if (patch.botIds != null) $set["aiPilot.botIds"] = oids;
  if (patch.pilotOrderMode != null) $set["aiPilot.pilotOrderMode"] = patch.pilotOrderMode;
  if (patch.manualTradingEnabled != null) $set["aiPilot.manualTradingEnabled"] = patch.manualTradingEnabled;
  if (patch.createBotFromAnalysis != null) $set["aiPilot.createBotFromAnalysis"] = patch.createBotFromAnalysis;
  if (patch.maxTradesPerRun != null) $set["aiPilot.maxTradesPerRun"] = patch.maxTradesPerRun;
  if (patch.maxOpenManualPositions != null) $set["aiPilot.maxOpenManualPositions"] = patch.maxOpenManualPositions;

  const user = await User.findByIdAndUpdate(session.userId, { $set }, { new: true });
  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ap = user.aiPilot && typeof user.aiPilot === "object" ? user.aiPilot : {};
  return NextResponse.json({
    ok: true,
    settings: {
      enabled: Boolean(ap.enabled),
      intervalMinutes: Number(ap.intervalMinutes) || 15,
      botIds: (ap.botIds || []).map((id) => String(id)),
      maxUsdcPerTrade: Number(ap.maxUsdcPerTrade) || 150,
      pilotOrderMode: ap.pilotOrderMode === "real" ? "real" : "paper",
      manualTradingEnabled: Boolean(ap.manualTradingEnabled),
      createBotFromAnalysis: Boolean(ap.createBotFromAnalysis),
      maxTradesPerRun: Math.min(20, Math.max(1, Number(ap.maxTradesPerRun) || 3)),
      maxOpenManualPositions: Math.min(20, Math.max(1, Number(ap.maxOpenManualPositions) || 3)),
    },
  });
}

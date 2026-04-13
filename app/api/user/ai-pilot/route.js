import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/models/db";
import User from "@/models/User";
import { Bot } from "@/models";
import CronRunLog from "@/models/CronRunLog";
import { requireAuth } from "@/lib/api-helpers";
import { respondIfMongoMissing } from "@/lib/mongo-env";
import { aiPilotSettingsSchema } from "@/lib/validations/schemas";
import { canUseAiPilot } from "@/lib/plans";

export const dynamic = "force-dynamic";

function extractLastManualLiveEvents(logs, userId) {
  const uid = String(userId);
  for (const log of logs) {
    const summary = log?.summary;
    const items = Array.isArray(summary?.items) ? summary.items : [];
    const mine = items.find((it) => String(it?.userId || "") === uid);
    if (!mine) continue;
    const events = Array.isArray(mine.events) ? mine.events : [];
    return events
      .filter((e) => e && (e.trigger === "sl_hit" || e.trigger === "tp_hit"))
      .slice(0, 8)
      .map((e) => ({
        pair: e.pair,
        trigger: e.trigger,
        price: Number.isFinite(Number(e.price)) ? Number(e.price) : null,
      }));
  }
  return [];
}

function extractLastManualLiveStats(logs, userId) {
  const uid = String(userId);
  for (const log of logs) {
    const summary = log?.summary;
    const items = Array.isArray(summary?.items) ? summary.items : [];
    const mine = items.find((it) => String(it?.userId || "") === uid);
    if (!mine) continue;
    return {
      slHits: Number(mine?.slHits) || 0,
      tpHits: Number(mine?.tpHits) || 0,
      positionsChecked: Number(mine?.positionsChecked) || 0,
      liveManualCount: Number(mine?.liveManualCount) || 0,
      protectedCount: Number(mine?.protectedCount) || 0,
    };
  }
  return { slHits: 0, tpHits: 0, positionsChecked: 0, liveManualCount: 0, protectedCount: 0 };
}

function extractLastManualLiveAiStatus(logs, userId) {
  const uid = String(userId);
  for (const log of logs) {
    const summary = log?.summary;
    const items = Array.isArray(summary?.items) ? summary.items : [];
    const mine = items.find((it) => String(it?.userId || "") === uid);
    if (!mine) continue;
    return {
      runAt: log?.createdAt ? new Date(log.createdAt).toISOString() : null,
      ok: Boolean(log?.ok),
      statusCode: Number(log?.statusCode) || null,
      summary: mine?.rezumat ? String(mine.rezumat) : "",
      error: mine?.error ? String(mine.error) : log?.error ? String(log.error) : "",
      sellsDone: Number(mine?.sellsDone) || 0,
      positionsChecked: Number(mine?.positionsChecked) || 0,
      skipped: Boolean(mine?.skipped),
      reason: mine?.reason ? String(mine.reason) : "",
      aiDecisions: Array.isArray(mine?.aiDecisions)
        ? mine.aiDecisions.slice(0, 8).map((d) => ({
            pair: d?.pair ? String(d.pair) : "",
            ok: Boolean(d?.ok),
            motiv: d?.motiv ? String(d.motiv) : "",
            detail: d?.detail ? String(d.detail) : "",
          }))
        : [],
    };
  }
  return {
    runAt: null,
    ok: null,
    statusCode: null,
    summary: "",
    error: "",
    sellsDone: 0,
    positionsChecked: 0,
    skipped: false,
    reason: "",
    aiDecisions: [],
  };
}

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
  const manualLiveLogs = await CronRunLog.find({ job: "ai-pilot-manual-live" })
    .sort({ createdAt: -1 })
    .limit(6)
    .select("summary")
    .lean();
  const manualLiveAiLogs = await CronRunLog.find({ job: "ai-pilot-manual-live-ai" })
    .sort({ createdAt: -1 })
    .limit(6)
    .select("summary ok error statusCode createdAt")
    .lean();
  const lastManualLiveEvents = extractLastManualLiveEvents(manualLiveLogs, session.userId);
  const lastManualLiveStats = extractLastManualLiveStats(manualLiveLogs, session.userId);
  const lastManualLiveAiStatus = extractLastManualLiveAiStatus(manualLiveAiLogs, session.userId);

  const botIdSet = new Set(bots.map((b) => String(b._id)));
  const storedRaw = (pilot.botIds || []).map((id) => String(id));
  const cleanedBotIds = [
    ...new Set(storedRaw.filter((id) => mongoose.isValidObjectId(id) && botIdSet.has(id))),
  ];
  const hasStaleOrDuplicate =
    cleanedBotIds.length !== storedRaw.length || new Set(storedRaw).size !== storedRaw.length;
  if (hasStaleOrDuplicate) {
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          "aiPilot.botIds": cleanedBotIds.map((id) => new mongoose.Types.ObjectId(id)),
        },
      }
    );
  }

  return NextResponse.json({
    canUse: canUseAiPilot(session.subscriptionPlan),
    settings: {
      enabled: Boolean(pilot.enabled),
      intervalMinutes: Number(pilot.intervalMinutes) || 15,
      botIds: cleanedBotIds,
      maxUsdcPerTrade: Number(pilot.maxUsdcPerTrade) || 150,
      pilotOrderMode: pilot.pilotOrderMode === "real" ? "real" : "paper",
      manualTradingEnabled: Boolean(pilot.manualTradingEnabled),
      createBotFromAnalysis: Boolean(pilot.createBotFromAnalysis),
      maxTradesPerRun: Math.min(20, Math.max(1, Number(pilot.maxTradesPerRun) || 3)),
      maxOpenManualPositions: Math.min(20, Math.max(1, Number(pilot.maxOpenManualPositions) || 3)),
      maxPilotBots: Math.min(20, Math.max(1, Number(pilot.maxPilotBots) || 5)),
      lastRunAt: pilot.lastRunAt ? new Date(pilot.lastRunAt).toISOString() : null,
      lastSummary: String(pilot.lastSummary || ""),
      lastError: String(pilot.lastError || ""),
      manualLiveAiEnabled: Boolean(pilot.manualLiveAiEnabled),
      manualLiveIntervalMinutes: Math.min(30, Math.max(1, Number(pilot.manualLiveIntervalMinutes) || 5)),
      lastManualLiveRunAt: pilot.lastManualLiveRunAt
        ? new Date(pilot.lastManualLiveRunAt).toISOString()
        : null,
      lastManualLiveSummary: String(pilot.lastManualLiveSummary || ""),
      lastManualLiveError: String(pilot.lastManualLiveError || ""),
      lastManualLiveEvents,
      lastManualLiveStats,
      lastManualLiveAiStatus,
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

  let oids = [];
  let prunedStaleBotIds = false;
  if (parsed.data.botIds != null) {
    const uniqueStr = [...new Set(parsed.data.botIds.map((id) => String(id)))];
    for (const id of uniqueStr) {
      if (!mongoose.isValidObjectId(id)) {
        return NextResponse.json({ error: `ID bot invalid: ${id}` }, { status: 400 });
      }
    }
    const uniqueObj = uniqueStr.map((id) => new mongoose.Types.ObjectId(id));
    if (uniqueObj.length) {
      const found = await Bot.find({ userId: session.userId, _id: { $in: uniqueObj } })
        .select("_id")
        .lean();
      const foundSet = new Set(found.map((b) => String(b._id)));
      oids = uniqueStr.filter((id) => foundSet.has(id)).map((id) => new mongoose.Types.ObjectId(id));
      prunedStaleBotIds = oids.length !== uniqueStr.length;
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
  if (patch.maxPilotBots != null) $set["aiPilot.maxPilotBots"] = patch.maxPilotBots;
  if (patch.manualLiveAiEnabled != null) $set["aiPilot.manualLiveAiEnabled"] = patch.manualLiveAiEnabled;
  if (patch.manualLiveIntervalMinutes != null) {
    $set["aiPilot.manualLiveIntervalMinutes"] = patch.manualLiveIntervalMinutes;
  }

  const user = await User.findByIdAndUpdate(session.userId, { $set }, { new: true });
  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ap = user.aiPilot && typeof user.aiPilot === "object" ? user.aiPilot : {};
  return NextResponse.json({
    ok: true,
    ...(prunedStaleBotIds ? { prunedStaleBotIds: true } : {}),
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
      maxPilotBots: Math.min(20, Math.max(1, Number(ap.maxPilotBots) || 5)),
      manualLiveAiEnabled: Boolean(ap.manualLiveAiEnabled),
      manualLiveIntervalMinutes: Math.min(30, Math.max(1, Number(ap.manualLiveIntervalMinutes) || 5)),
    },
  });
}

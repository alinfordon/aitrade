import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import User from "@/models/User";
import CronRunLog from "@/models/CronRunLog";
import { requireAuth } from "@/lib/api-helpers";
import { respondIfMongoMissing } from "@/lib/mongo-env";
import { manualLiveTpslSettingsSchema } from "@/lib/validations/schemas";

export const dynamic = "force-dynamic";

function extractLastEvents(logs, userId) {
  const uid = String(userId);
  for (const log of logs) {
    const items = Array.isArray(log?.summary?.items) ? log.summary.items : [];
    const mine = items.find((it) => String(it?.userId || "") === uid);
    if (!mine) continue;
    if (mine?.skipped && String(mine?.reason || "") === "throttle") continue;
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

function extractLastStats(logs, userId) {
  const uid = String(userId);
  for (const log of logs) {
    const items = Array.isArray(log?.summary?.items) ? log.summary.items : [];
    const mine = items.find((it) => String(it?.userId || "") === uid);
    if (!mine) continue;
    if (mine?.skipped && String(mine?.reason || "") === "throttle") continue;
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

function extractLastStatus(logs, userId) {
  const uid = String(userId);
  for (const log of logs) {
    const items = Array.isArray(log?.summary?.items) ? log.summary.items : [];
    const mine = items.find((it) => String(it?.userId || "") === uid);
    if (!mine) continue;
    return {
      runAt: log?.createdAt ? new Date(log.createdAt).toISOString() : null,
      ok: Boolean(log?.ok),
      statusCode: Number(log?.statusCode) || null,
      skipped: Boolean(mine?.skipped),
      reason: mine?.reason ? String(mine.reason) : "",
      error: mine?.error ? String(mine.error) : log?.error ? String(log.error) : "",
    };
  }
  return { runAt: null, ok: null, statusCode: null, skipped: false, reason: "", error: "" };
}

export async function GET() {
  const missing = respondIfMongoMissing();
  if (missing) return missing;

  const { session, error } = await requireAuth();
  if (error) return error;

  await connectDB();
  const user = await User.findById(session.userId).select("manualLiveTpsl aiPilot").lean();
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const cfg = user.manualLiveTpsl && typeof user.manualLiveTpsl === "object" ? user.manualLiveTpsl : {};
  const legacy = user.aiPilot && typeof user.aiPilot === "object" ? user.aiPilot : {};

  const logs = await CronRunLog.find({
    job: "ai-pilot-manual-live",
    "summary.items.userId": String(session.userId),
  })
    .sort({ createdAt: -1 })
    .limit(12)
    .select("summary ok error statusCode createdAt")
    .lean();

  return NextResponse.json({
    settings: {
      enabled: cfg.enabled != null ? Boolean(cfg.enabled) : true,
      intervalMinutes: Math.min(30, Math.max(1, Number(cfg.intervalMinutes) || 1)),
      lastRunAt: cfg.lastRunAt
        ? new Date(cfg.lastRunAt).toISOString()
        : legacy.lastManualLiveRunAt
          ? new Date(legacy.lastManualLiveRunAt).toISOString()
          : null,
      lastSummary: String(cfg.lastSummary || legacy.lastManualLiveSummary || ""),
      lastError: String(cfg.lastError || legacy.lastManualLiveError || ""),
      lastEvents: extractLastEvents(logs, session.userId),
      lastStats: extractLastStats(logs, session.userId),
      lastStatus: extractLastStatus(logs, session.userId),
    },
  });
}

export async function PATCH(request) {
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

  const parsed = manualLiveTpslSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join(" · ") },
      { status: 400 }
    );
  }

  await connectDB();
  const patch = {};
  if (parsed.data.enabled != null) patch["manualLiveTpsl.enabled"] = parsed.data.enabled;
  if (parsed.data.intervalMinutes != null) patch["manualLiveTpsl.intervalMinutes"] = parsed.data.intervalMinutes;

  const user = await User.findByIdAndUpdate(session.userId, { $set: patch }, { new: true })
    .select("manualLiveTpsl")
    .lean();
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const cfg = user.manualLiveTpsl && typeof user.manualLiveTpsl === "object" ? user.manualLiveTpsl : {};
  return NextResponse.json({
    ok: true,
    settings: {
      enabled: cfg.enabled != null ? Boolean(cfg.enabled) : true,
      intervalMinutes: Math.min(30, Math.max(1, Number(cfg.intervalMinutes) || 1)),
    },
  });
}


import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import { Bot } from "@/models";
import CronRunLog from "@/models/CronRunLog";
import { requireAuth } from "@/lib/api-helpers";
import { respondIfMongoMissing } from "@/lib/mongo-env";

export const dynamic = "force-dynamic";

export async function GET() {
  const missing = respondIfMongoMissing();
  if (missing) return missing;

  const { session, error } = await requireAuth();
  if (error) return error;

  await connectDB();
  const bots = await Bot.find({ userId: session.userId }).select("_id status positionState").lean();
  const botIdSet = new Set(bots.map((b) => String(b._id)));
  const totalBots = bots.length;
  const activeBots = bots.filter((b) => String(b?.status || "") === "active").length;
  const inactiveBots = Math.max(0, totalBots - activeBots);
  const withOpenPosition = bots.filter((b) => Boolean(b?.positionState?.open)).length;
  const withoutOpenPosition = Math.max(0, totalBots - withOpenPosition);

  const logs = await CronRunLog.find({ job: "run-bots" })
    .sort({ createdAt: -1 })
    .limit(20)
    .select("summary ok statusCode error createdAt")
    .lean();

  let selected = null;
  let mineItems = [];
  for (const log of logs) {
    const items = Array.isArray(log?.summary?.items) ? log.summary.items : [];
    const mine = items.filter((it) => botIdSet.has(String(it?.botId || "")));
    if (mine.length > 0) {
      selected = log;
      mineItems = mine;
      break;
    }
  }

  if (!selected) {
    return NextResponse.json({
      stats: {
        runAt: null,
        ok: null,
        statusCode: null,
        error: "",
        botsMatched: 0,
        overview: {
          totalBots,
          activeBots,
          inactiveBots,
          withOpenPosition,
          withoutOpenPosition,
        },
        actionCounts: {},
        skipReasons: {},
      },
    });
  }

  const actionCounts = {};
  const skipReasons = {};
  for (const it of mineItems) {
    if (it?.action) {
      const key = String(it.action);
      actionCounts[key] = (actionCounts[key] || 0) + 1;
    }
    if (it?.skipped) {
      const key = it?.reason ? String(it.reason) : "unknown";
      skipReasons[key] = (skipReasons[key] || 0) + 1;
    }
  }

  return NextResponse.json({
    stats: {
      runAt: selected?.createdAt ? new Date(selected.createdAt).toISOString() : null,
      ok: Boolean(selected?.ok),
      statusCode: Number(selected?.statusCode) || null,
      error: selected?.error ? String(selected.error) : "",
      botsMatched: mineItems.length,
      overview: {
        totalBots,
        activeBots,
        inactiveBots,
        withOpenPosition,
        withoutOpenPosition,
      },
      actionCounts,
      skipReasons,
    },
  });
}


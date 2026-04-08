import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import CronRunLog from "@/models/CronRunLog";
import { requireAdmin } from "@/lib/api-helpers";
import { MAX_CRON_RUN_LOGS } from "@/server/cron/persist-cron-log";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(
    Math.max(Number(searchParams.get("limit") || MAX_CRON_RUN_LOGS), 1),
    MAX_CRON_RUN_LOGS
  );

  await connectDB();
  const logs = await CronRunLog.find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return NextResponse.json({
    logs: logs.map((l) => ({
      id: String(l._id),
      job: l.job,
      ok: l.ok,
      statusCode: l.statusCode,
      durationMs: l.durationMs,
      error: l.error || "",
      summary: l.summary ?? {},
      createdAt: l.createdAt,
    })),
    maxRetained: MAX_CRON_RUN_LOGS,
  });
}

/** Șterge toate logurile cron (admin). */
export async function DELETE() {
  const { error } = await requireAdmin();
  if (error) return error;

  await connectDB();
  const r = await CronRunLog.deleteMany({});
  return NextResponse.json({ ok: true, deletedCount: r.deletedCount ?? 0 });
}

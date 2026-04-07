import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import CronRunLog from "@/models/CronRunLog";
import { requireAdmin } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(Number(searchParams.get("limit") || 15), 1), 50);

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
  });
}

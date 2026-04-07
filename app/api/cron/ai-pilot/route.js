import { NextResponse } from "next/server";
import { verifyCron } from "@/lib/api-helpers";
import { runAiPilotBatch } from "@/server/ai/pilot-engine";
import { persistCronRun } from "@/server/cron/persist-cron-log";

/**
 * Declanșare: același secret ca la /api/cron/run-bots (Bearer CRON_SECRET).
 * Recomandat: EasyCron sau Vercel cron la fiecare 15 minute.
 * Motorul respectă `aiPilot.intervalMinutes` per utilizator (implicit 15).
 */
export async function GET(request) {
  const t0 = Date.now();
  if (!verifyCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await runAiPilotBatch({ limit: 12 });
    const body = { ok: true, results };
    await persistCronRun({
      job: "ai-pilot",
      ok: true,
      statusCode: 200,
      body,
      durationMs: Date.now() - t0,
    });
    return NextResponse.json(body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await persistCronRun({
      job: "ai-pilot",
      ok: false,
      statusCode: 500,
      error: msg,
      durationMs: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

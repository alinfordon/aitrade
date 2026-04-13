import { NextResponse } from "next/server";
import { verifyCron } from "@/lib/api-helpers";
import { runAiPilotManualLiveAiBatch } from "@/server/ai/pilot-engine";
import { persistCronRun } from "@/server/cron/persist-cron-log";

/**
 * Rulare la 5 minute: AI verifică pozițiile live ale AI Pilot și poate propune intervenții (sell).
 * Declanșare: Bearer CRON_SECRET.
 */
export async function GET(request) {
  const t0 = Date.now();
  if (!verifyCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await runAiPilotManualLiveAiBatch({ limit: 16 });
    const body = { ok: true, results };
    await persistCronRun({
      job: "ai-pilot-manual-live-ai",
      ok: true,
      statusCode: 200,
      body,
      durationMs: Date.now() - t0,
    });
    return NextResponse.json(body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await persistCronRun({
      job: "ai-pilot-manual-live-ai",
      ok: false,
      statusCode: 500,
      error: msg,
      durationMs: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { verifyCron } from "@/lib/api-helpers";
import { runAiPilotManualLiveBatch } from "@/server/ai/pilot-engine";
import { persistCronRun } from "@/server/cron/persist-cron-log";

/**
 * Verifică pozițiile manuale Spot Live și execută vânzări la recomandarea AI (dacă e cazul).
 * Declanșare: același secret ca la celelalte cron-uri (Bearer CRON_SECRET).
 * Throttle per user: `aiPilot.manualLiveIntervalMinutes` (implicit 5).
 */
export async function GET(request) {
  const t0 = Date.now();
  if (!verifyCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await runAiPilotManualLiveBatch({ limit: 16 });
    const body = { ok: true, results };
    await persistCronRun({
      job: "ai-pilot-manual-live",
      ok: true,
      statusCode: 200,
      body,
      durationMs: Date.now() - t0,
    });
    return NextResponse.json(body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await persistCronRun({
      job: "ai-pilot-manual-live",
      ok: false,
      statusCode: 500,
      error: msg,
      durationMs: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

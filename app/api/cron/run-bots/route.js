import { NextResponse } from "next/server";
import { verifyCron } from "@/lib/api-helpers";
import { runActiveBotsBatch } from "@/server/engine/bot-runner";
import { persistCronRun } from "@/server/cron/persist-cron-log";

/**
 * Declanșare: EasyCron (recomandat 1 min) — vezi `docs/easycron.md`.
 * Header: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request) {
  const t0 = Date.now();
  if (!verifyCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const results = await runActiveBotsBatch(20);
    const body = { ok: true, processed: results.length, results };
    await persistCronRun({
      job: "run-bots",
      ok: true,
      statusCode: 200,
      body,
      durationMs: Date.now() - t0,
    });
    return NextResponse.json(body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await persistCronRun({
      job: "run-bots",
      ok: false,
      statusCode: 500,
      error: msg,
      durationMs: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

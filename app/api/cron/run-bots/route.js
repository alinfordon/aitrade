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
    const configured = Number(process.env.RUN_BOTS_BATCH_LIMIT);
    const batchLimit = Number.isFinite(configured) ? Math.min(Math.max(configured, 1), 5000) : 200;
    const results = await runActiveBotsBatch(batchLimit);
    const summary = results.reduce(
      (acc, item) => {
        if (item?.action) {
          const k = String(item.action);
          acc.actionCounts[k] = (acc.actionCounts[k] || 0) + 1;
        }
        if (item?.skipped) {
          const reason = item?.reason ? String(item.reason) : "unknown";
          acc.skipReasons[reason] = (acc.skipReasons[reason] || 0) + 1;
        }
        if (item?.ok === false && !item?.skipped) {
          acc.failed += 1;
          const reason = item?.error ? String(item.error) : item?.reason ? String(item.reason) : "unknown_error";
          const key = reason.slice(0, 120);
          acc.errorReasons[key] = (acc.errorReasons[key] || 0) + 1;
        }
        return acc;
      },
      { processed: results.length, failed: 0, actionCounts: {}, skipReasons: {}, errorReasons: {} }
    );
    const body = { ok: true, processed: results.length, summary, results };
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

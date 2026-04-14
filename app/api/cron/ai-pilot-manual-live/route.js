import { NextResponse } from "next/server";
import { verifyCron } from "@/lib/api-helpers";
import { runAiPilotManualLiveBatch } from "@/server/ai/pilot-engine";
import { persistCronRun } from "@/server/cron/persist-cron-log";

/**
 * Verifică la minut pozițiile manuale Live și aplică strict TP/SL salvat pe pereche (fără decizie AI nouă).
 * Independent de toggle-urile AI Pilot; necesită doar chei API valide și poziții/protecții live.
 * Declanșare: același secret ca la celelalte cron-uri (Bearer CRON_SECRET).
 */
export async function GET(request) {
  const t0 = Date.now();
  if (!verifyCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await runAiPilotManualLiveBatch({ limit: 1000 });
    const summary = results.reduce(
      (acc, item) => {
        const applied = Array.isArray(item?.applied) ? item.applied : [];
        const sl = applied.filter((a) => a?.ok && a?.trigger === "sl").length;
        const tp = applied.filter((a) => a?.ok && a?.trigger === "tp").length;
        acc.slHits += sl;
        acc.tpHits += tp;
        if (item?.ok) acc.okUsers += 1;
        if (item?.skipped) {
          const reason = item?.reason ? String(item.reason) : "unknown";
          acc.skipReasons[reason] = (acc.skipReasons[reason] || 0) + 1;
        }
        if (sl > 0 || tp > 0) {
          acc.triggeredUsers += 1;
        }
        return acc;
      },
      { matchedUsers: results.length, okUsers: 0, slHits: 0, tpHits: 0, triggeredUsers: 0, skipReasons: {} }
    );
    const body = { ok: true, summary, results };
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

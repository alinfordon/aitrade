import { NextResponse } from "next/server";
import { verifyCron } from "@/lib/api-helpers";
import { runOcoReconcileBatch } from "@/server/trading/oco-reconcile";
import { persistCronRun } from "@/server/cron/persist-cron-log";

/**
 * Cron recomandat la 10–15 min: verifică pe Binance ordinele OCO înregistrate
 * în `user.liveProtections[pair].oco` și sincronizează DB-ul:
 *  - OCO încă activ → nothing;
 *  - OCO cu fill (SL / TP hit pe Binance) → creează Trade filled, scade qty,
 *    bump stats, curăță referința;
 *  - OCO dispărut fără fill (anulat manual pe Binance) → curăță referința.
 */
export async function GET(request) {
  const t0 = Date.now();
  if (!verifyCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await runOcoReconcileBatch({ limit: 1000 });
    const summary = results.reduce(
      (acc, item) => {
        acc.matchedUsers += 1;
        if (item?.skipped) {
          const reason = item?.reason ? String(item.reason) : "unknown";
          acc.skipReasons[reason] = (acc.skipReasons[reason] || 0) + 1;
          return acc;
        }
        const events = Array.isArray(item?.events) ? item.events : [];
        for (const ev of events) {
          if (ev.action === "oco_filled_synced") acc.ocoFilled += 1;
          else if (ev.action === "oco_cancelled_externally") acc.ocoCancelledExternally += 1;
          else if (ev.action === "still_active") acc.ocoStillActive += 1;
          else if (ev.action === "status_error" || ev.action === "fill_error") acc.ocoErrors += 1;
        }
        return acc;
      },
      {
        matchedUsers: 0,
        ocoFilled: 0,
        ocoCancelledExternally: 0,
        ocoStillActive: 0,
        ocoErrors: 0,
        skipReasons: {},
      }
    );
    const body = { ok: true, summary, results };
    await persistCronRun({
      job: "reconcile-oco",
      ok: true,
      statusCode: 200,
      body,
      durationMs: Date.now() - t0,
    });
    return NextResponse.json(body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await persistCronRun({
      job: "reconcile-oco",
      ok: false,
      statusCode: 500,
      error: msg,
      durationMs: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

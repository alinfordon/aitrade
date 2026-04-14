"use client";

import { cn } from "@/lib/utils";

export function ManualLiveTpslSummary({
  lastRunAt,
  lastSummary,
  lastError,
  lastStats = { slHits: 0, tpHits: 0, positionsChecked: 0, liveManualCount: 0, protectedCount: 0 },
  lastStatus = { runAt: null, ok: null, skipped: false, reason: "", error: "" },
  lastEvents = [],
  className,
}) {
  const statusLabel = (() => {
    if (lastStatus?.error) return "eroare";
    if (lastStatus?.skipped) {
      const reason = String(lastStatus?.reason || "");
      if (reason === "throttle") return "throttle";
      if (reason === "no_live_manual") return "fara pozitii live";
      if (reason === "no_live_protections") return "fara SL/TP";
      if (reason === "manual_live_tpsl_off") return "oprit din setari";
      return `skip: ${reason || "n/a"}`;
    }
    if (lastStatus?.ok) return "rulat";
    return "necunoscut";
  })();

  const statusClass = (() => {
    if (lastStatus?.error) return "border-rose-500/35 bg-rose-500/15 text-rose-200";
    if (lastStatus?.skipped) return "border-amber-500/35 bg-amber-500/15 text-amber-100";
    if (lastStatus?.ok) return "border-emerald-500/35 bg-emerald-500/15 text-emerald-200";
    return "border-white/20 bg-white/[0.06] text-muted-foreground";
  })();

  return (
    <div className={cn("space-y-2 text-xs", className)}>
      {lastRunAt ? (
        <p>
          <span className="font-medium text-foreground">Ultima verificare:</span>{" "}
          {new Date(lastRunAt).toLocaleString("ro-RO")}
        </p>
      ) : null}
      <p>
        <span className="font-medium text-foreground">Ultimul status cron:</span>{" "}
        <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-medium", statusClass)}>
          {statusLabel}
        </span>
      </p>
      {lastSummary ? (
        <p>
          <span className="font-medium text-foreground">Rezumat:</span> {lastSummary}
        </p>
      ) : null}
      <p>
        <span className="font-medium text-foreground">Statistici:</span> perechi verificate{" "}
        {Number(lastStats?.positionsChecked) || 0} · SL hit {Number(lastStats?.slHits) || 0} · TP hit{" "}
        {Number(lastStats?.tpHits) || 0}
      </p>
      <p>
        <span className="font-medium text-foreground">Acoperire TP/SL:</span> manual live{" "}
        {Number(lastStats?.liveManualCount) || 0} · cu SL/TP {Number(lastStats?.protectedCount) || 0}
      </p>
      {lastError ? (
        <p className="text-destructive">
          <span className="font-medium">Eroare:</span> {lastError}
        </p>
      ) : null}
      {Array.isArray(lastEvents) && lastEvents.length > 0 ? (
        <div className="space-y-1">
          <p>
            <span className="font-medium text-foreground">Evenimente cron (TP/SL):</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {lastEvents.map((ev, idx) => (
              <span
                key={`${ev.pair || "?"}-${ev.trigger || "?"}-${idx}`}
                className="rounded border border-white/15 bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px]"
              >
                {ev.pair || "?"} · {ev.trigger === "sl_hit" ? "SL" : "TP"}
                {Number.isFinite(Number(ev.price)) ? ` @ ${Number(ev.price).toFixed(4)}` : ""}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}


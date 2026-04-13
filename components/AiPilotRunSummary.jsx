"use client";

import { cn } from "@/lib/utils";

/**
 * Rezumat ultimă rundă pilot + Live manual (fără fetch — doar afișare).
 * @param {{ variant?: "default" | "fleet" }} [props]
 */
export function AiPilotRunSummary({
  pilotLastRun,
  pilotLastSummary,
  pilotLastError,
  pilotLastManualLiveRun,
  pilotLastManualLiveSummary,
  pilotLastManualLiveError,
  pilotLastManualLiveEvents = [],
  className,
  variant = "default",
}) {
  const k = variant === "fleet" ? "font-medium text-amber-200/90" : "font-medium text-foreground";
  const hasAny =
    pilotLastRun ||
    pilotLastSummary ||
    pilotLastError ||
    pilotLastManualLiveRun ||
    pilotLastManualLiveSummary ||
    pilotLastManualLiveError;

  if (!hasAny) return null;

  return (
    <div className={cn("space-y-2 text-xs", className)}>
      {pilotLastRun && (
        <p>
          <span className={k}>Ultima rundă pilot:</span>{" "}
          {new Date(pilotLastRun).toLocaleString("ro-RO")}
        </p>
      )}
      {pilotLastSummary && (
        <p>
          <span className={k}>Rezumat pilot:</span> {pilotLastSummary}
        </p>
      )}
      {pilotLastError && (
        <p className="text-destructive">
          <span className="font-medium">Eroare pilot:</span> {pilotLastError}
        </p>
      )}
      {pilotLastManualLiveRun && (
        <p>
          <span className={k}>Ultima verificare Live manual:</span>{" "}
          {new Date(pilotLastManualLiveRun).toLocaleString("ro-RO")}
        </p>
      )}
      {pilotLastManualLiveSummary && (
        <p>
          <span className={k}>Rezumat Live manual:</span> {pilotLastManualLiveSummary}
        </p>
      )}
      {pilotLastManualLiveError && (
        <p className="text-destructive">
          <span className="font-medium">Eroare Live manual:</span> {pilotLastManualLiveError}
        </p>
      )}
      {Array.isArray(pilotLastManualLiveEvents) && pilotLastManualLiveEvents.length > 0 && (
        <div className="space-y-1">
          <p>
            <span className={k}>Evenimente cron (TP/SL):</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {pilotLastManualLiveEvents.map((ev, idx) => (
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
      )}
    </div>
  );
}

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
  pilotLastManualLiveStats = {
    slHits: 0,
    tpHits: 0,
    positionsChecked: 0,
    liveManualCount: 0,
    protectedCount: 0,
  },
  pilotLastManualLiveAiStatus = {
    runAt: null,
    ok: null,
    statusCode: null,
    summary: "",
    error: "",
    sellsDone: 0,
    positionsChecked: 0,
    skipped: false,
    reason: "",
    aiDecisions: [],
  },
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
      <p>
        <span className={k}>Statistici ultim cron Live manual:</span>{" "}
        perechi verificate {Number(pilotLastManualLiveStats?.positionsChecked) || 0} · SL hit{" "}
        {Number(pilotLastManualLiveStats?.slHits) || 0} · TP hit{" "}
        {Number(pilotLastManualLiveStats?.tpHits) || 0}
      </p>
      <p>
        <span className={k}>Acoperire TP/SL:</span> manual live{" "}
        {Number(pilotLastManualLiveStats?.liveManualCount) || 0} · cu SL/TP{" "}
        {Number(pilotLastManualLiveStats?.protectedCount) || 0}
      </p>
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
      {(pilotLastManualLiveAiStatus?.runAt ||
        pilotLastManualLiveAiStatus?.summary ||
        pilotLastManualLiveAiStatus?.error) && (
        <div className="space-y-1.5 rounded border border-white/10 bg-white/[0.02] px-2 py-1.5">
          <p>
            <span className={k}>Ultima verificare Live AI (5m):</span>{" "}
            {pilotLastManualLiveAiStatus?.runAt
              ? new Date(pilotLastManualLiveAiStatus.runAt).toLocaleString("ro-RO")
              : "—"}
          </p>
          <p>
            <span className={k}>Statistici Live AI:</span> perechi verificate{" "}
            {Number(pilotLastManualLiveAiStatus?.positionsChecked) || 0} · intervenții{" "}
            {Number(pilotLastManualLiveAiStatus?.sellsDone) || 0}
            {pilotLastManualLiveAiStatus?.skipped && pilotLastManualLiveAiStatus?.reason
              ? ` · skip: ${pilotLastManualLiveAiStatus.reason}`
              : ""}
          </p>
          {pilotLastManualLiveAiStatus?.summary ? (
            <p>
              <span className={k}>Rezumat Live AI:</span> {pilotLastManualLiveAiStatus.summary}
            </p>
          ) : null}
          {pilotLastManualLiveAiStatus?.error ? (
            <p className="text-destructive">
              <span className="font-medium">Eroare Live AI:</span>{" "}
              {pilotLastManualLiveAiStatus.error}
            </p>
          ) : null}
          {Array.isArray(pilotLastManualLiveAiStatus?.aiDecisions) &&
          pilotLastManualLiveAiStatus.aiDecisions.length > 0 ? (
            <div className="space-y-1">
              <p>
                <span className={k}>Explicații AI (5m):</span>
              </p>
              <div className="space-y-1">
                {pilotLastManualLiveAiStatus.aiDecisions.map((d, idx) => (
                  <p key={`${d.pair || "?"}-${idx}`} className="text-[11px] leading-snug text-muted-foreground">
                    <span className="font-mono text-foreground">{d.pair || "?"}</span>
                    {" · "}
                    {d.ok ? "intervenție" : "fără execuție"}
                    {d.motiv ? ` · ${d.motiv}` : d.detail ? ` · ${d.detail}` : ""}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

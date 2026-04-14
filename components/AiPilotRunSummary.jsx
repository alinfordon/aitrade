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
  pilotLastManualLiveStatus = {
    runAt: null,
    ok: null,
    statusCode: null,
    skipped: false,
    reason: "",
    error: "",
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
  const manualLiveStatusLabel = (() => {
    if (pilotLastManualLiveStatus?.error) return "eroare";
    if (pilotLastManualLiveStatus?.skipped) {
      const reason = String(pilotLastManualLiveStatus?.reason || "");
      if (reason === "throttle") return "throttle";
      if (reason === "no_live_manual") return "fara pozitii live";
      if (reason === "no_live_protections") return "fara SL/TP";
      return `skip: ${reason || "n/a"}`;
    }
    if (pilotLastManualLiveStatus?.ok) return "rulat";
    return "necunoscut";
  })();
  const manualLiveStatusClass = (() => {
    if (pilotLastManualLiveStatus?.error) return "border-rose-500/35 bg-rose-500/15 text-rose-200";
    if (pilotLastManualLiveStatus?.skipped) return "border-amber-500/35 bg-amber-500/15 text-amber-100";
    if (pilotLastManualLiveStatus?.ok) return "border-emerald-500/35 bg-emerald-500/15 text-emerald-200";
    return "border-white/20 bg-white/[0.06] text-muted-foreground";
  })();
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
      {(pilotLastRun || pilotLastSummary || pilotLastError) && (
        <div className="space-y-1 rounded border border-amber-500/20 bg-amber-500/[0.04] px-2 py-1.5">
          <p className={k}>Pilot</p>
          {pilotLastRun ? (
            <p>
              <span className={k}>Ultima rundă pilot:</span> {new Date(pilotLastRun).toLocaleString("ro-RO")}
            </p>
          ) : null}
          {pilotLastSummary ? (
            <p>
              <span className={k}>Rezumat pilot:</span> {pilotLastSummary}
            </p>
          ) : null}
          {pilotLastError ? (
            <p className="text-destructive">
              <span className="font-medium">Eroare pilot:</span> {pilotLastError}
            </p>
          ) : null}
        </div>
      )}

      {(pilotLastManualLiveRun ||
        pilotLastManualLiveSummary ||
        pilotLastManualLiveError ||
        (Array.isArray(pilotLastManualLiveEvents) && pilotLastManualLiveEvents.length > 0)) && (
        <div className="space-y-1 rounded border border-cyan-500/20 bg-cyan-500/[0.04] px-2 py-1.5">
          <p className={k}>Live manual (TP/SL fără AI)</p>
          {pilotLastManualLiveRun ? (
            <p>
              <span className={k}>Ultima verificare:</span> {new Date(pilotLastManualLiveRun).toLocaleString("ro-RO")}
            </p>
          ) : null}
          <p>
            <span className={k}>Ultimul status cron:</span>{" "}
            <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-medium", manualLiveStatusClass)}>
              {manualLiveStatusLabel}
            </span>
          </p>
          {pilotLastManualLiveSummary ? (
            <p>
              <span className={k}>Rezumat:</span> {pilotLastManualLiveSummary}
            </p>
          ) : null}
          <p>
            <span className={k}>Statistici:</span> perechi verificate{" "}
            {Number(pilotLastManualLiveStats?.positionsChecked) || 0} · SL hit{" "}
            {Number(pilotLastManualLiveStats?.slHits) || 0} · TP hit{" "}
            {Number(pilotLastManualLiveStats?.tpHits) || 0}
          </p>
          <p>
            <span className={k}>Acoperire TP/SL:</span> manual live{" "}
            {Number(pilotLastManualLiveStats?.liveManualCount) || 0} · cu SL/TP{" "}
            {Number(pilotLastManualLiveStats?.protectedCount) || 0}
          </p>
          {pilotLastManualLiveError ? (
            <p className="text-destructive">
              <span className="font-medium">Eroare Live manual:</span> {pilotLastManualLiveError}
            </p>
          ) : null}
          {Array.isArray(pilotLastManualLiveEvents) && pilotLastManualLiveEvents.length > 0 ? (
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
          ) : null}
        </div>
      )}

      {(pilotLastManualLiveAiStatus?.runAt ||
        pilotLastManualLiveAiStatus?.summary ||
        pilotLastManualLiveAiStatus?.error) && (
        <div className="space-y-1.5 rounded border border-violet-500/20 bg-violet-500/[0.04] px-2 py-1.5">
          <p className={k}>Live AI (decizii la interval)</p>
          <p>
            <span className={k}>Ultima verificare:</span>{" "}
            {pilotLastManualLiveAiStatus?.runAt
              ? new Date(pilotLastManualLiveAiStatus.runAt).toLocaleString("ro-RO")
              : "—"}
          </p>
          <p>
            <span className={k}>Statistici:</span> perechi verificate{" "}
            {Number(pilotLastManualLiveAiStatus?.positionsChecked) || 0} · intervenții{" "}
            {Number(pilotLastManualLiveAiStatus?.sellsDone) || 0}
            {pilotLastManualLiveAiStatus?.skipped && pilotLastManualLiveAiStatus?.reason
              ? ` · skip: ${pilotLastManualLiveAiStatus.reason}`
              : ""}
          </p>
          {pilotLastManualLiveAiStatus?.summary ? (
            <p>
              <span className={k}>Rezumat:</span> {pilotLastManualLiveAiStatus.summary}
            </p>
          ) : null}
          {pilotLastManualLiveAiStatus?.error ? (
            <p className="text-destructive">
              <span className="font-medium">Eroare Live AI:</span> {pilotLastManualLiveAiStatus.error}
            </p>
          ) : null}
          {Array.isArray(pilotLastManualLiveAiStatus?.aiDecisions) &&
          pilotLastManualLiveAiStatus.aiDecisions.length > 0 ? (
            <div className="space-y-1">
              <p>
                <span className={k}>Explicații AI:</span>
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

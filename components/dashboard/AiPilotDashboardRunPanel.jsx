"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Cpu, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { AiPilotRunSummary } from "@/components/AiPilotRunSummary";

export function AiPilotDashboardRunPanel() {
  const [loading, setLoading] = useState(true);
  const [canUse, setCanUse] = useState(false);
  const [pilotEnabled, setPilotEnabled] = useState(false);
  const [pilotIntervalMinutes, setPilotIntervalMinutes] = useState(15);
  const [manualLiveIntervalMinutes, setManualLiveIntervalMinutes] = useState(1);
  const [manualLiveAiEnabled, setManualLiveAiEnabled] = useState(false);
  const [runNowLoading, setRunNowLoading] = useState(false);
  const [lastRun, setLastRun] = useState(null);
  const [lastSummary, setLastSummary] = useState("");
  const [lastError, setLastError] = useState("");
  const [lastManualLiveAiStatus, setLastManualLiveAiStatus] = useState({
    runAt: null,
    ok: null,
    statusCode: null,
    summary: "",
    error: "",
    sellsDone: 0,
    positionsChecked: 0,
    skipped: false,
    reason: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/user/ai-pilot");
      const j = await r.json();
      if (!r.ok) {
        throw new Error(typeof j.error === "string" ? j.error : "Pilot");
      }
      setCanUse(Boolean(j.canUse));
      const s = j.settings || {};
      setPilotEnabled(Boolean(s.enabled));
      setPilotIntervalMinutes(Math.max(1, Number(s.intervalMinutes) || 15));
      setManualLiveIntervalMinutes(Math.max(1, Number(s.manualLiveIntervalMinutes) || 5));
      setManualLiveAiEnabled(Boolean(s.manualLiveAiEnabled));
      setLastSummary(String(s.lastSummary || ""));
      setLastError(String(s.lastError || ""));
      setLastRun(s.lastRunAt || null);
      setLastManualLiveAiStatus(
        s.lastManualLiveAiStatus && typeof s.lastManualLiveAiStatus === "object"
          ? {
              runAt: s.lastManualLiveAiStatus.runAt || null,
              ok:
                typeof s.lastManualLiveAiStatus.ok === "boolean"
                  ? s.lastManualLiveAiStatus.ok
                  : null,
              statusCode: Number(s.lastManualLiveAiStatus.statusCode) || null,
              summary: String(s.lastManualLiveAiStatus.summary || ""),
              error: String(s.lastManualLiveAiStatus.error || ""),
              sellsDone: Number(s.lastManualLiveAiStatus.sellsDone) || 0,
              positionsChecked: Number(s.lastManualLiveAiStatus.positionsChecked) || 0,
              skipped: Boolean(s.lastManualLiveAiStatus.skipped),
              reason: String(s.lastManualLiveAiStatus.reason || ""),
            }
          : {
              runAt: null,
              ok: null,
              statusCode: null,
              summary: "",
              error: "",
              sellsDone: 0,
              positionsChecked: 0,
              skipped: false,
              reason: "",
            }
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Pilot AI");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runNow = useCallback(async () => {
    if (!pilotEnabled) {
      toast.info("Activează AI Pilot din setări înainte de rulare manuală.");
      return;
    }
    setRunNowLoading(true);
    try {
      const r = await fetch("/api/user/ai-pilot/run", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(typeof j.error === "string" ? j.error : "Rulare AI Pilot eșuată");
      }
      toast.success("Rundă AI Pilot pornită.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rulare AI Pilot eșuată");
    } finally {
      setRunNowLoading(false);
    }
  }, [load, pilotEnabled]);

  const hasSummary = lastRun || lastSummary || lastError;

  return (
    <div className="fleet-pilot-panel h-full overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-white/[0.08] bg-black/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-amber-500/25 bg-amber-500/10 text-amber-200">
            <Cpu className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          </div>
          <div>
            <p className="fleet-section-label text-[9px] text-amber-200/80">AI Pilot</p>
            <h2 className="font-display text-base font-semibold tracking-tight text-foreground">
              Ultima activitate cron
            </h2>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="shrink-0 border border-amber-500/30 bg-amber-500/10 text-xs text-amber-100 hover:bg-amber-500/15"
            disabled={loading || runNowLoading || !canUse || !pilotEnabled}
            onClick={() => void runNow()}
            title={!pilotEnabled ? "Activează AI Pilot din setări pentru rulare manuală." : undefined}
          >
            {runNowLoading ? "Rulează…" : "Pornește rundă"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0 border-white/15 bg-white/[0.04] text-xs"
            disabled={loading || runNowLoading}
            onClick={() => void load()}
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
            Reîncarcă
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="shrink-0 border border-white/10 bg-white/[0.06] text-xs"
            asChild
          >
            <Link href="/ai-pilot#ai-pilot" className="inline-flex items-center gap-1.5">
              Setări pilot
              <ExternalLink className="h-3.5 w-3.5 opacity-80" aria-hidden />
            </Link>
          </Button>
        </div>
      </div>
      <div className="px-4 py-4 sm:px-5 sm:py-5">
        {loading ? (
          <p className="text-sm text-muted-foreground">Se încarcă…</p>
        ) : !canUse ? (
          <p className="text-sm text-muted-foreground">
            AI Pilot (cron) este disponibil pe planurile Pro și Elite. Upgrade din secțiunea de mai jos sau din{" "}
            <Link href="/settings" className="font-medium text-primary underline underline-offset-2">
              Settings
            </Link>
            .
          </p>
        ) : hasSummary ? (
          <div className="fleet-pilot-summary">
            <div className="mb-3 grid gap-1.5 text-[10px] xl:grid-cols-2">
              <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-100">
                <p>Pilot cron: {pilotEnabled ? `ON · la ${pilotIntervalMinutes}m` : "OFF"}</p>
              </div>
              <div className="rounded border border-violet-500/25 bg-violet-500/10 px-2 py-1 text-violet-100">
                <p>
                  Live AI:{" "}
                  {pilotEnabled && manualLiveAiEnabled ? `ON · la ${manualLiveIntervalMinutes}m` : "OFF"}
                </p>
              </div>
            </div>
            <AiPilotRunSummary
              variant="fleet"
              pilotLastRun={lastRun}
              pilotLastSummary={lastSummary}
              pilotLastError={lastError}
              pilotLastManualLiveAiStatus={lastManualLiveAiStatus}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Încă nu există o rundă înregistrată după ultima salvare. Asigură-te că ai configurat cron-ul pentru{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">/api/cron/ai-pilot</code>.
          </p>
        )}
      </div>
    </div>
  );
}

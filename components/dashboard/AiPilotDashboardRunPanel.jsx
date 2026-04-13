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
  const [lastRun, setLastRun] = useState(null);
  const [lastSummary, setLastSummary] = useState("");
  const [lastError, setLastError] = useState("");
  const [lastManualLiveRun, setLastManualLiveRun] = useState(null);
  const [lastManualLiveSummary, setLastManualLiveSummary] = useState("");
  const [lastManualLiveError, setLastManualLiveError] = useState("");
  const [lastManualLiveEvents, setLastManualLiveEvents] = useState([]);

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
      setLastSummary(String(s.lastSummary || ""));
      setLastError(String(s.lastError || ""));
      setLastRun(s.lastRunAt || null);
      setLastManualLiveRun(s.lastManualLiveRunAt || null);
      setLastManualLiveSummary(String(s.lastManualLiveSummary || ""));
      setLastManualLiveError(String(s.lastManualLiveError || ""));
      setLastManualLiveEvents(Array.isArray(s.lastManualLiveEvents) ? s.lastManualLiveEvents : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Pilot AI");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hasSummary =
    lastRun ||
    lastSummary ||
    lastError ||
    lastManualLiveRun ||
    lastManualLiveSummary ||
    lastManualLiveError;

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
            variant="outline"
            className="shrink-0 border-white/15 bg-white/[0.04] text-xs"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
            Refresh
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
            <AiPilotRunSummary
              variant="fleet"
              pilotLastRun={lastRun}
              pilotLastSummary={lastSummary}
              pilotLastError={lastError}
              pilotLastManualLiveRun={lastManualLiveRun}
              pilotLastManualLiveSummary={lastManualLiveSummary}
              pilotLastManualLiveError={lastManualLiveError}
              pilotLastManualLiveEvents={lastManualLiveEvents}
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

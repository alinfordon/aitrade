"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck, RefreshCw, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ManualLiveTpslSummary } from "@/components/ManualLiveTpslSummary";

export function ManualLiveTpslDashboardPanel() {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/user/manual-live-tpsl");
      const j = await r.json();
      if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : "Live manual TP/SL");
      setSettings(j.settings || null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Live manual TP/SL");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="fleet-pilot-panel h-full overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-white/[0.08] bg-black/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-500/25 bg-cyan-500/10 text-cyan-200">
            <ShieldCheck className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          </div>
          <div>
            <p className="fleet-section-label text-[9px] text-cyan-200/80">Live manual</p>
            <h2 className="font-display text-base font-semibold tracking-tight text-foreground">
              TP/SL fara AI
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
            Reincarca
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="shrink-0 border border-white/10 bg-white/[0.06] text-xs"
            asChild
          >
            <Link href="/settings" className="inline-flex items-center gap-1.5">
              Setari TP/SL
              <ExternalLink className="h-3.5 w-3.5 opacity-80" aria-hidden />
            </Link>
          </Button>
        </div>
      </div>
      <div className="px-4 py-4 sm:px-5 sm:py-5">
        {loading ? (
          <p className="text-sm text-muted-foreground">Se incarca…</p>
        ) : settings ? (
          <>
            <div className="mb-3 text-[10px]">
              <span className="rounded border border-cyan-500/25 bg-cyan-500/10 px-2 py-1 text-cyan-100">
                TP/SL cron: {settings.enabled ? `ON · la ${settings.intervalMinutes}m` : "OFF"}
              </span>
            </div>
            <ManualLiveTpslSummary
              lastRunAt={settings.lastRunAt}
              lastSummary={settings.lastSummary}
              lastError={settings.lastError}
              lastStats={settings.lastStats}
              lastStatus={settings.lastStatus}
              lastEvents={settings.lastEvents}
            />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Nu exista date pentru modul TP/SL.</p>
        )}
      </div>
    </div>
  );
}


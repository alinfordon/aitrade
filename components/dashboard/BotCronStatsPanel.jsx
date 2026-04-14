"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const SKIP_REASON_LABELS = {
  no_entry_signal: "Fara semnal de intrare",
  insufficient_quote: "Fonduri insuficiente in quote",
  no_api_keys: "Chei API lipsa",
  no_candles: "Date de piata insuficiente",
  no_price: "Pret indisponibil",
  max_daily_loss: "Limita pierdere zilnica atinsa",
  no_alloc: "Alocare calculata prea mica",
  dedupe: "Evitare ordin duplicat",
  inactive: "Bot inactiv",
  no_strategy: "Strategie lipsa",
  no_user: "Utilizator lipsa",
};

const ACTION_LABELS = {
  live_buy: "Buy live executat",
  paper_buy: "Buy paper executat",
  hold: "Fara actiune (hold)",
  live_sell: "Sell live executat",
  paper_sell: "Sell paper executat",
};

export function BotCronStatsPanel() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/user/bot-cron-stats");
      const j = await r.json();
      if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : "Cron boti");
      setStats(j.stats || null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cron boti");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const actionEntries = Object.entries(stats?.actionCounts || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const skipEntries = Object.entries(stats?.skipReasons || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);

  return (
    <div className="fleet-pilot-panel h-full overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-white/[0.08] bg-black/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-violet-500/25 bg-violet-500/10 text-violet-200">
            <Bot className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          </div>
          <div>
            <p className="fleet-section-label text-[9px] text-violet-200/80">Cron boți</p>
            <h2 className="font-display text-base font-semibold tracking-tight text-foreground">
              Statistici ultimă rulare
            </h2>
          </div>
        </div>
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
      </div>
      <div className="space-y-2 px-4 py-4 text-xs sm:px-5 sm:py-5">
        {loading ? (
          <p className="text-sm text-muted-foreground">Se incarca…</p>
        ) : !stats?.runAt ? (
          <p className="text-sm text-muted-foreground">Nu exista inca o rulare cron care sa includa botii tai.</p>
        ) : (
          <>
            <p>
              <span className="font-medium text-foreground">Ultima rulare:</span>{" "}
              {new Date(stats.runAt).toLocaleString("ro-RO")}
            </p>
            <p>
              <span className="font-medium text-foreground">Status:</span>{" "}
              {stats.ok ? (
                <Badge variant="outline" className="border-emerald-500/40 text-emerald-400">
                  OK{stats.statusCode ? `${stats.statusCode}` : ""}
                </Badge>
              ) : (
                <Badge variant="outline" className="border-rose-500/40 text-rose-400">
                  Eroare{stats.statusCode ? `${stats.statusCode}` : ""}
                </Badge>
              )}
            </p>
            <p>
              <span className="font-medium text-foreground">Boți în eșantion:</span> {Number(stats.botsMatched) || 0}
            </p>
            <p>
              <span className="font-medium text-foreground">Boți activi/inactivi:</span>{" "}
              {Number(stats?.overview?.activeBots) || 0} / {Number(stats?.overview?.inactiveBots) || 0}
            </p>
            <p>
              <span className="font-medium text-foreground">Poziții deschise/închise:</span>{" "}
              {Number(stats?.overview?.withOpenPosition) || 0} /{" "}
              {Number(stats?.overview?.withoutOpenPosition) || 0}
            </p>
            {actionEntries.length > 0 ? (
              <div className="space-y-1">
                <p className="font-medium text-foreground">Acțiuni:</p>
                <div className="flex flex-wrap gap-1.5">
                  {actionEntries.map(([k, v]) => (
                    <Badge key={`a-${k}`} variant="outline" className="text-[10px]">
                      {ACTION_LABELS[k] || k} · {v}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
            {skipEntries.length > 0 ? (
              <div className="space-y-1">
                <p className="font-medium text-foreground">Motive skip:</p>
                <div className="flex flex-wrap gap-1.5">
                  {skipEntries.map(([k, v]) => (
                    <Badge key={`s-${k}`} variant="outline" className="text-[10px]">
                      {SKIP_REASON_LABELS[k] || k} · {v}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
            {stats.error ? (
              <p className="text-destructive">
                <span className="font-medium">Eroare cron:</span> {stats.error}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}


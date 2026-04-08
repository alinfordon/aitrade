"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bot } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const POLL_MS = 15_000;

function localDayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export function AiPilotTradesColumn() {
  const [trades, setTrades] = useState([]);
  const [daySummary, setDaySummary] = useState(null);
  const [dayLabel, setDayLabel] = useState("");
  const [loading, setLoading] = useState(true);
  /** real = doar tranzacții live; paper = simulate / paper */
  const [modeTab, setModeTab] = useState("real");

  const load = useCallback(async () => {
    const { start, end } = localDayBounds();
    setDayLabel(
      start.toLocaleDateString("ro-RO", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    );

    try {
      const paperParam = modeTab === "paper" ? "1" : "0";
      const qs = `from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}&isPaper=${paperParam}`;
      const [r, rStats] = await Promise.all([
        fetch(`/api/trades?aiPilotControl=1&limit=80&isPaper=${paperParam}`),
        fetch(`/api/trades/pilot-daily-stats?${qs}`),
      ]);
      const j = await r.json();
      if (!r.ok) {
        throw new Error(typeof j.error === "string" ? j.error : "Eroare încărcare");
      }
      setTrades(Array.isArray(j.trades) ? j.trades : []);

      try {
        const js = await rStats.json();
        if (rStats.ok && js.summary) {
          setDaySummary(js.summary);
        } else {
          setDaySummary(null);
        }
      } catch {
        setDaySummary(null);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Tranzacții pilot");
      setTrades([]);
      setDaySummary(null);
    } finally {
      setLoading(false);
    }
  }, [modeTab]);

  useEffect(() => {
    setLoading(true);
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  return (
    <Card className="border-white/[0.08] bg-card/50 backdrop-blur-md lg:sticky lg:top-24 lg:max-h-[calc(100vh-8rem)] lg:overflow-hidden">
      <CardHeader className="border-b border-white/[0.06] pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 font-display text-base">
              <Bot className="h-4 w-4 text-primary" strokeWidth={1.75} aria-hidden />
              Tranzacții AI Pilot
            </CardTitle>
            <CardDescription className="text-xs leading-relaxed">
              Ordine manuale deschise/închise de pilot, legate de bot când există pe pereche. La „eșuat”, treci cu mouse-ul
              peste badge pentru motivul salvat (tooltip).
            </CardDescription>
            <div
              className="mt-3 flex max-w-xs rounded-lg border border-border/80 bg-muted/30 p-0.5"
              role="tablist"
              aria-label="Mod tranzacții pilot"
            >
              <button
                type="button"
                role="tab"
                aria-selected={modeTab === "real"}
                className={cn(
                  "flex-1 rounded-md px-2 py-1.5 text-center text-[11px] font-medium transition-colors",
                  modeTab === "real"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setModeTab("real")}
              >
                Real (live)
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={modeTab === "paper"}
                className={cn(
                  "flex-1 rounded-md px-2 py-1.5 text-center text-[11px] font-medium transition-colors",
                  modeTab === "paper"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setModeTab("paper")}
              >
                Paper
              </button>
            </div>
          </div>
          <Button type="button" size="sm" variant="secondary" className="shrink-0 text-xs" onClick={() => void load()}>
            Reîmprospătează
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0 lg:max-h-[calc(100vh-14rem)] lg:overflow-y-auto">
        {!loading && daySummary != null && (
          <div className="border-b border-white/[0.08] bg-gradient-to-br from-primary/[0.06] via-transparent to-accent/[0.04] p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Rezultat ziua curentă
            </p>
            <p className="mt-0.5 text-xs capitalize leading-snug text-foreground/90">{dayLabel}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Suma PnL din tranzacțiile pilot {modeTab === "paper" ? "paper" : "live"} din intervalul local 00:00–24:00.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-white/[0.06] bg-background/40 px-3 py-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Câștig / pierdere</p>
                <p
                  className={`mt-1 font-mono text-[12px] font-semibold tabular-nums tracking-tight ${
                    daySummary.totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {daySummary.totalPnl >= 0 ? "+" : ""}
                  {Number(daySummary.totalPnl).toFixed(4)} <span className="text-xs font-normal text-muted-foreground">USDC</span>
                </p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-background/40 px-3 py-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Tranzacții</p>
                <p className="mt-1 font-mono text-lg tabular-nums text-foreground">{daySummary.tradeCount}</p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-background/40 px-3 py-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">În câștig</p>
                <p className="mt-1 font-mono text-lg tabular-nums text-emerald-400/90">{daySummary.wins}</p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-background/40 px-3 py-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">În pierdere</p>
                <p className="mt-1 font-mono text-lg tabular-nums text-rose-400/90">{daySummary.losses}</p>
              </div>
            </div>
            {daySummary.neutral > 0 ? (
              <p className="mt-2 text-[10px] text-muted-foreground">
                + {daySummary.neutral} cu PnL 0 (ex. cumpărări la intrare).
              </p>
            ) : null}
          </div>
        )}
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">Se încarcă…</p>
        ) : trades.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            {modeTab === "paper"
              ? "Încă nu există tranzacții pilot în modul paper pentru filtrul curent."
              : "Încă nu există tranzacții pilot live (real). Verifică modul „Real” la ordine în setările pilot sau cron-ul."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[320px] text-left text-xs">
              <thead>
                <tr className="border-b border-border/80 bg-white/[0.02] text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Data</th>
                  <th className="px-2 py-2">Pereche</th>
                  <th className="px-2 py-2">Op</th>
                  <th className="px-2 py-2 text-right">PnL</th>
                  <th className="px-3 py-2">Detalii</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => {
                  const pnl = t.pnl != null ? Number(t.pnl) : null;
                  const botId = t.botId ? String(t.botId) : null;
                  return (
                    <tr key={t._id} className="border-b border-border/50 transition-colors hover:bg-white/[0.03]">
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {new Date(t.createdAt).toLocaleString("ro-RO", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-2 py-2 font-medium">{t.pair}</td>
                      <td className="px-2 py-2">
                        <span
                          className={
                            t.side === "buy"
                              ? "font-medium text-emerald-400"
                              : "font-medium text-amber-400/90"
                          }
                        >
                          {t.side}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">
                        {pnl != null && Number.isFinite(pnl) ? (
                          <span className={pnl >= 0 ? "text-emerald-400" : "text-rose-400"}>
                            {pnl >= 0 ? "+" : ""}
                            {pnl.toFixed(2)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1">
                          {t.isPaper ? (
                            <Badge variant="outline" className="text-[10px]">
                              paper
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px]">
                              live
                            </Badge>
                          )}
                          {t.status === "failed" && (
                            <span
                              className="inline-flex cursor-help"
                              title={
                                String(t.errorMessage || "").trim() ||
                                "Motiv indisponibil — verifică logurile serverului."
                              }
                            >
                              <Badge variant="destructive" className="pointer-events-none text-[10px]">
                                eșuat
                              </Badge>
                            </span>
                          )}
                          {botId ? (
                            <Link
                              href="/bots"
                              title={`Bot ${botId}`}
                              className="max-w-[5.5rem] truncate text-[10px] text-primary underline-offset-2 hover:underline"
                            >
                              bot…{botId.slice(-6)}
                            </Link>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

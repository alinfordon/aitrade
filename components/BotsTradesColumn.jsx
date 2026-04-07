"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSpotWallet } from "@/components/SpotWalletProvider";
import { Bot } from "lucide-react";
import { toast } from "sonner";

const POLL_MS = 15_000;
/** Max rânduri în tabel; API sortează descendent după dată → mereu cele mai noi primele. */
const TRADES_LIMIT = 50;

function localDayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function fmtUsdc(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `${Number(n).toFixed(2)} USDC`;
}

export function BotsTradesColumn() {
  const { wallet, loadWallet } = useSpotWallet();
  const [trades, setTrades] = useState([]);
  const [daySummary, setDaySummary] = useState(null);
  const [dayLabel, setDayLabel] = useState("");
  const [loading, setLoading] = useState(true);

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
      const qs = `from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`;
      const [r, rStats] = await Promise.all([
        fetch(`/api/trades?anyBot=1&limit=${TRADES_LIMIT}`),
        fetch(`/api/trades/bot-daily-stats?${qs}`),
        loadWallet({ silent: true }),
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
      toast.error(e instanceof Error ? e.message : "Tranzacții boți");
      setTrades([]);
      setDaySummary(null);
    } finally {
      setLoading(false);
    }
  }, [loadWallet]);

  useEffect(() => {
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
              Tranzacții boți
            </CardTitle>
            <CardDescription className="text-xs leading-relaxed">
              Ordine de la motorul de strategie (cron) și cele legate de un anumit bot (inclusiv manual pilot).
            </CardDescription>
          </div>
          <Button type="button" size="sm" variant="secondary" className="shrink-0 text-xs" onClick={() => void load()}>
            Reîmprospătează
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0 lg:max-h-[calc(100vh-14rem)] lg:overflow-y-auto">
        {wallet?.overview?.paper ? (
          <div className="border-b border-white/[0.08] bg-white/[0.02] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Paper (simulator)
              </p>
              <Badge variant="outline" className="text-[9px] font-normal">
                USDC
              </Badge>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-white/[0.06] bg-background/30 px-3 py-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Disponibil
                </p>
                <p className="mt-1 font-mono text-sm tabular-nums text-foreground">
                  {fmtUsdc(wallet.overview.paper.usdcFreeTotal)}
                </p>
                <p className="mt-1 text-[9px] leading-snug text-muted-foreground">
                  Manual + cotă liberă boți paper
                </p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-background/30 px-3 py-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Investit (la cost)
                </p>
                <p className="mt-1 font-mono text-sm tabular-nums text-amber-200/90">
                  {fmtUsdc(wallet.overview.paper.usdcInPositionsAtCost)}
                </p>
                <p className="mt-1 text-[9px] leading-snug text-muted-foreground">
                  Poziții manual + bot, preț mediu intrare
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {wallet?.overview?.real ? (
          <div className="border-b border-white/[0.08] bg-white/[0.02] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Binance spot (real)
              </p>
              <Badge variant="secondary" className="text-[9px] font-normal">
                USDC
              </Badge>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-white/[0.06] bg-background/30 px-3 py-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  USDC liber
                </p>
                <p className="mt-1 font-mono text-sm tabular-nums text-emerald-300/90">
                  {fmtUsdc(wallet.overview.real.usdcFree)}
                </p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-background/30 px-3 py-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  În active (estim.)
                </p>
                <p className="mt-1 font-mono text-sm tabular-nums text-sky-200/90">
                  {fmtUsdc(wallet.overview.real.inAssetsUsdcEstimate)}
                </p>
                <p className="mt-1 text-[9px] leading-snug text-muted-foreground">
                  Solduri non-USDC × preț piață (USDC)
                </p>
              </div>
            </div>
          </div>
        ) : wallet?.hasApiKeys && !wallet?.real?.connected ? (
          <div className="border-b border-white/[0.08] px-4 py-3 text-[11px] text-muted-foreground">
            Real: nu s-a putut citi soldul Binance
            {wallet?.real?.error ? ` — ${wallet.real.error}` : ""}.
          </div>
        ) : null}

        {!loading && daySummary != null && (
          <div className="border-b border-white/[0.08] bg-gradient-to-br from-primary/[0.06] via-transparent to-accent/[0.04] p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Rezultat ziua curentă
            </p>
            <p className="mt-0.5 text-xs capitalize leading-snug text-foreground/90">{dayLabel}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Suma PnL din tranzacțiile cu botId în intervalul local 00:00–24:00.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-white/[0.06] bg-background/40 px-3 py-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Câștig / pierdere</p>
                <p
                  className={`mt-1 font-mono text-[11px] font-semibold tabular-nums tracking-tight ${
                    daySummary.totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {daySummary.totalPnl >= 0 ? "+" : ""}
                  {Number(daySummary.totalPnl).toFixed(4)}{" "}
                  <span className="text-xs font-normal text-muted-foreground">USDC</span>
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
            Încă nu există tranzacții asociate boților. Pornește un bot și lasă cron-ul să ruleze, sau leagă tranzacții
            manuale de un bot pe aceeași pereche.
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
                  const pilotTag = t.meta && typeof t.meta === "object" && t.meta.aiPilotControl;
                  const motor = t.tradeSource === "bot";
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
                            t.side === "buy" ? "font-medium text-emerald-400" : "font-medium text-amber-400/90"
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
                          {motor ? (
                            <Badge variant="outline" className="text-[10px] text-sky-200/90">
                              cron
                            </Badge>
                          ) : null}
                          {pilotTag ? (
                            <Badge variant="outline" className="border-amber-500/35 text-[10px] text-amber-200">
                              Pilot
                            </Badge>
                          ) : null}
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
                            <Badge variant="destructive" className="text-[10px]">
                              eșuat
                            </Badge>
                          )}
                          {botId ? (
                            <span title={botId} className="max-w-[5.5rem] truncate font-mono text-[10px] text-primary/90">
                              …{botId.slice(-6)}
                            </span>
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

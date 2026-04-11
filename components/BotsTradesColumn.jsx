"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSpotWallet } from "@/components/SpotWalletProvider";
import { Bot, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const POLL_MS = 15_000;
const SELLS_LIMIT = 150;

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

function liveHrefForBot(botId) {
  return `/live?bot=${encodeURIComponent(String(botId))}`;
}

export function BotsTradesColumn() {
  const { wallet, loadWallet } = useSpotWallet();
  const [activeBots, setActiveBots] = useState([]);
  const [closedToday, setClosedToday] = useState([]);
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
      const [rPos, rTrades, rStats] = await Promise.all([
        fetch("/api/live/positions"),
        fetch(`/api/trades?anyBot=1&limit=${SELLS_LIMIT}&side=sell&${qs}`),
        fetch(`/api/trades/bot-daily-stats?${qs}`),
      ]);
      void loadWallet({ silent: true });
      const jPos = await rPos.json();
      if (!rPos.ok) {
        throw new Error(typeof jPos.error === "string" ? jPos.error : "Eroare poziții");
      }
      const botRows = Array.isArray(jPos.bots) ? jPos.bots : [];
      const isPaperTab = modeTab === "paper";
      const openBots = botRows.filter((b) => (b.botMode === "paper") === isPaperTab);
      setActiveBots(openBots);

      const jTr = await rTrades.json();
      if (!rTrades.ok) {
        throw new Error(typeof jTr.error === "string" ? jTr.error : "Eroare tranzacții");
      }
      const sells = Array.isArray(jTr.trades) ? jTr.trades : [];
      sells.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setClosedToday(sells);

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
      setActiveBots([]);
      setClosedToday([]);
      setDaySummary(null);
    } finally {
      setLoading(false);
    }
  }, [loadWallet, modeTab]);

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
              Tranzacții boți
            </CardTitle>
            <CardDescription className="text-xs leading-relaxed">
              Poziții deschise la boți (cu legătură în Live). Vânzările asociate unui bot din ziua curentă (ora locală
              00:00–24:00), inclusiv închideri din cron sau manual legat de bot.
            </CardDescription>
            <div
              className="mt-3 flex max-w-xs rounded-lg border border-border/80 bg-muted/30 p-0.5"
              role="tablist"
              aria-label="Mod tranzacții boți"
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
              Suma PnL din tranzacțiile cu botId ({modeTab === "paper" ? "paper" : "live"}) în intervalul local 00:00–24:00
              (inclusiv vânzările de mai jos).
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
        ) : (
          <div className="space-y-6 p-4">
            <section>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Poziții active (boți)
              </h3>
              {activeBots.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Niciun bot cu poziție deschisă în modul {modeTab === "paper" ? "paper" : "live"}.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border border-border/60">
                  <table className="w-full min-w-[300px] text-left text-xs">
                    <thead>
                      <tr className="border-b border-border/80 bg-white/[0.02] text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2">Strategie / pereche</th>
                        <th className="px-2 py-2 text-right">Cant.</th>
                        <th className="px-2 py-2 text-right">Intrare</th>
                        <th className="px-2 py-2 text-right">Mark</th>
                        <th className="px-3 py-2">Live</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeBots.map((b) => (
                        <tr key={b.botId} className="border-b border-border/50 transition-colors hover:bg-white/[0.03]">
                          <td className="px-3 py-2">
                            <div className="flex flex-col gap-0.5">
                              <span className="line-clamp-2 font-medium leading-tight">{b.strategyName || "—"}</span>
                              <span className="text-[10px] text-muted-foreground">{b.pair}</span>
                              <div className="flex flex-wrap gap-1 pt-0.5">
                                {b.origin === "pilot" ? (
                                  <Badge variant="outline" className="border-amber-500/35 text-[9px] text-amber-200">
                                    Pilot
                                  </Badge>
                                ) : null}
                                {b.futuresEnabled ? (
                                  <Badge variant="outline" className="text-[9px]">
                                    futures
                                  </Badge>
                                ) : null}
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-2 text-right font-mono tabular-nums">
                            {Number(b.qty).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                          </td>
                          <td className="px-2 py-2 text-right font-mono tabular-nums text-muted-foreground">
                            {b.avgEntry != null && Number.isFinite(Number(b.avgEntry))
                              ? Number(b.avgEntry).toLocaleString(undefined, { maximumFractionDigits: 4 })
                              : "—"}
                          </td>
                          <td className="px-2 py-2 text-right font-mono tabular-nums text-muted-foreground">
                            {b.markPrice != null && Number.isFinite(Number(b.markPrice))
                              ? Number(b.markPrice).toLocaleString(undefined, { maximumFractionDigits: 4 })
                              : "—"}
                          </td>
                          <td className="px-3 py-2">
                            <Link
                              href={liveHrefForBot(b.botId)}
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                            >
                              Deschide în Live
                              <ExternalLink className="h-3 w-3 opacity-80" aria-hidden />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Închideri astăzi (vânzări)
              </h3>
              {closedToday.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nicio vânzare asociată boților în ziua curentă ({modeTab === "paper" ? "paper" : "live"}).
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border border-border/60">
                  <table className="w-full min-w-[320px] text-left text-xs">
                    <thead>
                      <tr className="border-b border-border/80 bg-white/[0.02] text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2">Ora</th>
                        <th className="px-2 py-2">Pereche</th>
                        <th className="px-2 py-2 text-right">PnL</th>
                        <th className="px-3 py-2">Detalii</th>
                      </tr>
                    </thead>
                    <tbody>
                      {closedToday.map((t) => {
                        const pnl = t.pnl != null ? Number(t.pnl) : null;
                        const botId = t.botId ? String(t.botId) : null;
                        const pilotTag = t.meta && typeof t.meta === "object" && t.meta.aiPilotControl;
                        const motor = t.tradeSource === "bot";
                        const liveBot = botId ? liveHrefForBot(botId) : "/live";
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
                            <td className="px-2 py-2">
                              <div className="flex flex-col gap-0.5">
                                <span className="font-medium">{t.pair}</span>
                                {botId ? (
                                  <Link
                                    href={liveBot}
                                    className="inline-flex w-fit items-center gap-0.5 text-[10px] text-primary underline-offset-2 hover:underline"
                                  >
                                    Live
                                    <ExternalLink className="h-2.5 w-2.5" aria-hidden />
                                  </Link>
                                ) : null}
                              </div>
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
            </section>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

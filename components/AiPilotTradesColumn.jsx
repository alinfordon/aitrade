"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bot, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ensureLivePositionsPolling,
  refreshLivePositionsFromServer,
  useLivePositions,
} from "@/lib/client/live-positions-store";

const POLL_MS = 15_000;

function normPair(p) {
  return String(p ?? "")
    .trim()
    .toUpperCase()
    .replace(/-/g, "/");
}

function localDayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function liveHrefForPair(pair) {
  const q = encodeURIComponent(normPair(pair));
  return `/live?pair=${q}`;
}

/**
 * @param {{ className?: string; variant?: "default" | "dashboard" }} [props]
 */
export function AiPilotTradesColumn({ className, variant = "default" } = {}) {
  const isDashboard = variant === "dashboard";
  const live = useLivePositions();
  const [activePilot, setActivePilot] = useState([]);
  const [closedToday, setClosedToday] = useState([]);
  const [daySummary, setDaySummary] = useState(null);
  const [dayLabel, setDayLabel] = useState("");
  const [loading, setLoading] = useState(true);
  /** real = doar tranzacții live; paper = simulate / paper */
  const [modeTab, setModeTab] = useState("real");

  const load = useCallback(async () => {
    if (isDashboard) return;
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

      const [rTrades, rStats] = await Promise.all([
        fetch(`/api/trades?aiPilotControl=1&limit=150&side=sell&${qs}`),
        fetch(`/api/trades/pilot-daily-stats?${qs}`),
      ]);

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
      toast.error(e instanceof Error ? e.message : "Tranzacții pilot");
      setActivePilot([]);
      setClosedToday([]);
      setDaySummary(null);
    } finally {
      setLoading(false);
    }
  }, [isDashboard, modeTab]);

  useEffect(() => {
    ensureLivePositionsPolling();
  }, []);

  useEffect(() => {
    if (isDashboard) {
      const manual = live.manual || [];
      const openPilot = manual.filter((m) => m.origin === "pilot" && Boolean(m.paper) === false);
      setActivePilot(openPilot);
      setClosedToday([]);
      setDaySummary(null);
      setLoading(Boolean(live.loading) && manual.length === 0);
      return;
    }
    const manual = live.manual || [];
    const isPaperTab = modeTab === "paper";
    setActivePilot(
      manual.filter((m) => m.origin === "pilot" && Boolean(m.paper) === isPaperTab)
    );
  }, [isDashboard, live.manual, live.loading, live.version, modeTab]);

  useEffect(() => {
    if (isDashboard) return;
    setLoading(true);
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [load, isDashboard]);

  return (
    <Card
      className={cn(
        "border-white/[0.08] bg-card/50 backdrop-blur-md",
        isDashboard
          ? "fleet-feed-card lg:static lg:max-h-none lg:overflow-visible"
          : "lg:sticky lg:top-24 lg:h-[calc(100vh-8rem)] lg:max-h-[calc(100vh-8rem)] lg:flex lg:flex-col lg:overflow-hidden",
        className
      )}
    >
      <CardHeader className="border-b border-white/[0.06] pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <CardTitle className="flex flex-wrap items-center gap-2 font-display text-base">
              <Bot className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden />
              {isDashboard ? "Pilot · poziții live" : "Tranzacții AI Pilot"}
            </CardTitle>
            <CardDescription className="text-xs leading-relaxed">
              {isDashboard
                ? "Doar poziții deschise acum (real). Istoric și paper pe pagina AI Pilot."
                : "Poziții manuale pilot încă deschise (cu legătură în Live). Vânzările / închiderile din ziua curentă (ora locală 00:00–24:00) apar mai jos. La „eșuat”, treci cu mouse-ul peste badge pentru motiv."}
            </CardDescription>
            {!isDashboard ? (
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
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
            {isDashboard ? (
              <span className="fleet-mini-live" title="Flux date poziții">
                <span className="fleet-mini-live-dot" aria-hidden />
                Live
              </span>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="text-xs"
              onClick={() => {
                void refreshLivePositionsFromServer();
                if (!isDashboard) void load();
              }}
            >
              Reîmprospătează
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 pb-[15px] lg:flex-1 lg:overflow-y-auto">
        {!isDashboard && !loading && daySummary != null && (
          <div className="border-b border-white/[0.08] bg-gradient-to-br from-primary/[0.06] via-transparent to-accent/[0.04] p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Rezultat ziua curentă
            </p>
            <p className="mt-0.5 text-xs capitalize leading-snug text-foreground/90">{dayLabel}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Suma PnL din tranzacțiile pilot {modeTab === "paper" ? "paper" : "live"} din intervalul local 00:00–24:00
              (inclusiv vânzările de mai jos).
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
          <div className={cn("p-4 pb-[15px]", !isDashboard && "space-y-6")}>
            <section className={cn(isDashboard && "fleet-live-positions")}>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {isDashboard ? "Deschise acum" : "Poziții active (pilot)"}
              </h3>
              {activePilot.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {isDashboard
                    ? "Nicio poziție pilot deschisă în live."
                    : `Nicio poziție manuală deschisă marcată pilot în modul ${modeTab === "paper" ? "paper" : "live"}.`}
                </p>
              ) : (
                <div className="fleet-table-shell overflow-x-auto rounded-md border border-border/60">
                  <table className="w-full min-w-[280px] text-left text-xs">
                    <thead>
                      <tr className="border-b border-border/80 bg-white/[0.02] text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2">Pereche</th>
                        <th className="px-2 py-2 text-right">Cant.</th>
                        <th className="px-2 py-2 text-right">Intrare</th>
                        <th className="px-2 py-2 text-right">Mark</th>
                        <th className="px-3 py-2">Live</th>
                      </tr>
                    </thead>
                    <tbody className="fleet-tbody-live">
                      {activePilot.map((m) => (
                        <tr key={m.pair} className="border-b border-border/50 transition-colors hover:bg-white/[0.03]">
                          <td className="px-3 py-2 font-medium">{m.pair}</td>
                          <td className="px-2 py-2 text-right font-mono tabular-nums">
                            {Number(m.qty).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                          </td>
                          <td className="px-2 py-2 text-right font-mono tabular-nums text-muted-foreground">
                            {m.avgEntry != null && Number.isFinite(Number(m.avgEntry))
                              ? Number(m.avgEntry).toLocaleString(undefined, { maximumFractionDigits: 4 })
                              : "—"}
                          </td>
                          <td className="px-2 py-2 text-right font-mono tabular-nums text-muted-foreground">
                            {m.markPrice != null && Number.isFinite(Number(m.markPrice))
                              ? Number(m.markPrice).toLocaleString(undefined, { maximumFractionDigits: 4 })
                              : "—"}
                          </td>
                          <td className="px-3 py-2">
                            <Link
                              href={liveHrefForPair(m.pair)}
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

            {!isDashboard ? (
            <section>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Închideri astăzi (vânzări)
              </h3>
              {closedToday.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nicio vânzare pilot în ziua curentă ({modeTab === "paper" ? "paper" : "live"}).
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
                                <Link
                                  href={liveHrefForPair(t.pair)}
                                  className="inline-flex w-fit items-center gap-0.5 text-[10px] text-primary underline-offset-2 hover:underline"
                                >
                                  Live
                                  <ExternalLink className="h-2.5 w-2.5" aria-hidden />
                                </Link>
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
            </section>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

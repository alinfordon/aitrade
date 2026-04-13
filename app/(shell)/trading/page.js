"use client";

import { Suspense, useEffect, useLayoutEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TradingChart } from "@/components/TradingChart";
import { BinanceConnectionBadge } from "@/components/BinanceConnectionBadge";
import { RealSpotBalancesTable } from "@/components/RealSpotBalancesTable";
import { useSpotWallet } from "@/components/SpotWalletProvider";
import { toast } from "sonner";
import { DEFAULT_SPOT_PAIR, DEFAULT_QUOTE_ASSET } from "@/lib/market-defaults";
import { PageHeader } from "@/components/shell/PageHeader";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { canUsePreTradeAiAnalysis } from "@/lib/plans";
import "@/app/(shell)/trading/trading-dashboard.css";

const TF_OPTIONS = ["15m", "1h", "4h", "1d"];

const statLabels = {
  netProfit: "Profit net",
  grossProfit: "Profit brut",
  grossLoss: "Pierdere brută",
  profitFactor: "Profit factor",
  totalTrades: "Tranzacții totale",
  winningTrades: "Câștigătoare",
  losingTrades: "Pierzătoare",
  percentProfitable: "% profitabile",
  avgTrade: "Medie / tranzacție",
  avgWinningTrade: "Medie câștig",
  avgLosingTrade: "Medie pierdere",
  payoff: "Raport mediu W/L",
  largestWin: "Cel mai mare câștig",
  largestLoss: "Cea mai mare pierdere",
  maxDrawdown: "Drawdown max (valoare)",
  maxDrawdownPct: "Drawdown max %",
};

function fmt(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "—";
    if (Math.abs(v) >= 1000 || (Math.abs(v) > 0 && Math.abs(v) < 0.0001)) return v.toExponential(2);
    return v.toFixed(v % 1 === 0 ? 0 : Math.abs(v) >= 1 ? 4 : 8);
  }
  return String(v);
}

function normPair(p) {
  return String(p || "")
    .trim()
    .toUpperCase()
    .replace(/-/g, "/");
}

function parsePair(pair) {
  const p = normPair(pair);
  const [base, quote] = p.split("/");
  return { base, quote, key: p };
}

function freesForPair(pair, mode, wallet) {
  const { base, quote } = parsePair(pair);
  if (!base || !quote) return { baseFree: 0, quoteFree: 0 };

  if (mode === "paper") {
    const quoteBal = Number(wallet?.paper?.quoteBalance ?? 0);
    const pkey = normPair(pair);
    const book = wallet?.paper?.positions || {};
    const pos = book[pkey] || book[pair] || {};
    const baseFree = Number(pos.qty ?? 0);
    const quoteFree = quote === DEFAULT_QUOTE_ASSET ? quoteBal : 0;
    return { baseFree, quoteFree };
  }

  const rows = wallet?.real?.balances || [];
  const baseFree = Number(rows.find((r) => r.currency === base)?.free ?? 0);
  const quoteFree = Number(rows.find((r) => r.currency === quote)?.free ?? 0);
  return { baseFree, quoteFree };
}

function TradingPageInner() {
  const searchParams = useSearchParams();
  const [symbol, setSymbol] = useState(DEFAULT_SPOT_PAIR);
  const [timeframe, setTimeframe] = useState("1h");
  const [summary, setSummary] = useState(null);
  const [filterSource, setFilterSource] = useState("all");
  const { wallet, loadWallet } = useSpotWallet();
  const binanceErrSeen = useRef(null);
  useEffect(() => {
    const e = wallet?.real?.error ?? null;
    if (e && binanceErrSeen.current !== e) {
      binanceErrSeen.current = e;
      toast.error(`Binance: ${e}`);
    }
    if (!e) binanceErrSeen.current = null;
  }, [wallet?.real?.error]);

  const [side, setSide] = useState("buy");
  const [mode, setMode] = useState("paper");
  const [spendQuote, setSpendQuote] = useState("100");
  const [amountBase, setAmountBase] = useState("0.001");
  const [loading, setLoading] = useState(false);
  const [customPair, setCustomPair] = useState(false);
  const [subscriptionPlan, setSubscriptionPlan] = useState(null);
  const [preTradeAiLoading, setPreTradeAiLoading] = useState(false);
  const [preTradeAiError, setPreTradeAiError] = useState(null);
  const [preTradeAi, setPreTradeAi] = useState(null);

  const canTradingAi = canUsePreTradeAiAnalysis(subscriptionPlan ?? "free");

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/auth/me");
        const j = await r.json();
        if (r.ok && j.user?.subscriptionPlan != null) {
          setSubscriptionPlan(String(j.user.subscriptionPlan));
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    setPreTradeAi(null);
    setPreTradeAiError(null);
  }, [symbol, timeframe, side]);

  const loadStats = useCallback(async () => {
    const q = new URLSearchParams({ source: filterSource, paper: "real" });
    const r = await fetch(`/api/analytics/performance?${q}`);
    const j = await r.json();
    if (j.summary) setSummary(j.summary);
  }, [filterSource]);

  useEffect(() => {
    loadStats().catch(() => {});
  }, [loadStats]);

  const chartSpotOnly = searchParams.get("from") === "discover";

  useLayoutEffect(() => {
    const p = searchParams.get("pair");
    if (!p) return;
    const n = normPair(p);
    const { base, quote } = parsePair(n);
    if (!base || !quote) return;
    setSymbol(n);
  }, [searchParams]);

  useEffect(() => {
    const p = searchParams.get("pair");
    if (!p || !wallet?.suggestedPairs) return;
    const n = normPair(p);
    setCustomPair(!wallet.suggestedPairs.includes(n));
  }, [searchParams, wallet?.suggestedPairs]);

  const paperQuoteLabel = wallet?.paper?.quoteAsset || DEFAULT_QUOTE_ASSET;
  const paperBal = wallet?.paper?.quoteBalance ?? 0;
  const suggested = wallet?.suggestedPairs || [];
  const { baseFree, quoteFree } = freesForPair(symbol, mode, wallet);

  async function submitManual(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const body = { pair: normPair(symbol), side, mode };
      if (side === "buy") {
        const sq = spendQuote?.trim() ? Number(spendQuote) : NaN;
        const ab = amountBase?.trim() ? Number(amountBase) : NaN;
        if (Number.isFinite(sq) && sq > 0) body.spendQuote = sq;
        else if (Number.isFinite(ab) && ab > 0) body.amountBase = ab;
      } else {
        const ab = amountBase?.trim() ? Number(amountBase) : NaN;
        if (Number.isFinite(ab) && ab > 0) body.amountBase = ab;
      }
      const r = await fetch("/api/trading/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) {
        const msg =
          typeof j.error === "string"
            ? j.error
            : j.error && typeof j.error === "object"
              ? Object.values(j.error.fieldErrors || {})
                  .flat()
                  .filter(Boolean)
                  .join(" · ") || JSON.stringify(j.error)
              : "Eroare";
        toast.error(msg || "Eroare");
        return;
      }
      toast.success("Ordin înregistrat");
      loadStats();
      void loadWallet({ silent: true });
    } finally {
      setLoading(false);
    }
  }

  async function runPreTradeAi() {
    setPreTradeAiLoading(true);
    setPreTradeAiError(null);
    try {
      const r = await fetch("/api/trading/ai-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pair: normPair(symbol),
          side,
          timeframe,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setPreTradeAiError(typeof j.error === "string" ? j.error : "Eroare analiză AI");
        return;
      }
      setPreTradeAi(j);
    } catch (e) {
      setPreTradeAiError(e instanceof Error ? e.message : "Eroare");
    } finally {
      setPreTradeAiLoading(false);
    }
  }

  async function resetPaper() {
    await fetch("/api/user/paper-reset", { method: "POST" });
    toast.success(`Paper ${DEFAULT_QUOTE_ASSET} resetat la 10.000`);
    void loadWallet({ silent: true });
    loadStats();
  }

  function applyPctSell(pct) {
    const v = baseFree * (pct / 100);
    if (v > 0) setAmountBase(String(v > 1 ? v.toFixed(6) : v.toFixed(8)));
  }

  const orderRows = summary
    ? Object.entries(statLabels).map(([key, label]) => ({
        key,
        label,
        value: fmt(summary[key]),
      }))
    : [];

  return (
    <div className="trading-dashboard space-y-8">
      <header className="trading-hero">
        <div className="trading-hero-inner space-y-4">
          <PageHeader
            title="Tranzacții manuale & grafic"
            description="Vezi soldul Spot (real sau paper), alege perechea și plasează ordine market. Plan Pro/Elite: analiză AI înainte de ordin, cu indicatori pe grafic și verdict (intră acum / așteaptă) plus sugestie bot."
          />
        </div>
      </header>

      <Card className="trading-card-shell">
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Soldă Spot</CardTitle>
            <CardDescription>
              Real = Binance (necesită API keys în Settings). Paper = simulare în aplicație.
            </CardDescription>
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={() => loadWallet()}>
            Reîmprospătează soldul
          </Button>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-2">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium">
              <span>Live Binance Spot</span>
              <BinanceConnectionBadge wallet={wallet} />
            </div>
            {wallet?.real?.error && (
              <p className="mb-2 text-sm text-destructive">{wallet.real.error}</p>
            )}
            <RealSpotBalancesTable wallet={wallet} minUsdTotal={1} />
          </div>

          <div>
            <div className="mb-2 text-sm font-medium">Paper (simulat)</div>
            <p className="mb-2 text-sm text-muted-foreground">
              {paperQuoteLabel} disponibil:{" "}
              <span className="font-mono text-foreground">{paperBal != null ? fmt(paperBal) : "—"}</span>
            </p>
            <div className="max-h-56 overflow-auto rounded-md border border-border">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-muted/80">
                  <tr className="text-muted-foreground">
                    <th className="px-3 py-2">Activ / pereche</th>
                    <th className="px-3 py-2">Cantitate</th>
                    <th className="px-3 py-2">Intrare medie</th>
                  </tr>
                </thead>
                <tbody>
                  {(wallet?.paper?.balances || []).map((r) => (
                    <tr key={r.currency + (r.pair || "")} className="border-t border-border/60">
                      <td className="px-3 py-1.5">
                        {r.pair ? (
                          <button
                            type="button"
                            className="font-medium text-primary hover:underline"
                            onClick={() => {
                              setSymbol(r.pair);
                              setCustomPair(false);
                            }}
                          >
                            {r.pair}
                          </button>
                        ) : (
                          r.currency
                        )}
                      </td>
                      <td className="px-3 py-1.5 font-mono">{fmt(r.free)}</td>
                      <td className="px-3 py-1.5 font-mono text-muted-foreground">
                        {r.avgEntry != null ? fmt(r.avgEntry) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="trading-card-shell">
        <CardHeader>
          <CardTitle>Analiză AI înainte de ordin</CardTitle>
          <CardDescription>
            Evaluează contextul OHLC pe același timeframe ca graficul, pentru latura curentă (cumpără / vinde).
            Indicatorii aleși apar pe candlestick-uri. Educațional — nu este sfat financiar. Disponibil pe Pro și
            Elite (ca analiza Live SL/TP).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!canTradingAi ? (
            <p className="text-xs text-muted-foreground">
              Activează planul Pro sau Elite din{" "}
              <Link href="/settings" className="font-medium text-primary underline underline-offset-2">
                Settings
              </Link>{" "}
              pentru analiza pre-tranzacție.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={preTradeAiLoading}
                  onClick={() => runPreTradeAi()}
                >
                  {preTradeAiLoading ? "…" : "Generează analiză AI"}
                </Button>
                <span className="text-xs text-muted-foreground self-center">
                  Pereche: <span className="font-mono text-foreground">{normPair(symbol)}</span> · TF:{" "}
                  <span className="font-mono text-foreground">{timeframe}</span> ·{" "}
                  {side === "buy" ? "cumpără" : "vinde"}
                </span>
              </div>
              {preTradeAiError ? (
                <p className="text-xs text-destructive">{preTradeAiError}</p>
              ) : null}
              {preTradeAi ? (
                <div className="space-y-3 rounded-md border border-border/80 bg-muted/15 p-3 text-xs leading-relaxed">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase text-muted-foreground">Verdict</span>
                    {preTradeAi.verdict === "ACUM" ? (
                      <Badge className="bg-emerald-700 hover:bg-emerald-700">Favorabil acum</Badge>
                    ) : preTradeAi.verdict === "ASTEAPTA" ? (
                      <Badge variant="destructive">Așteaptă</Badge>
                    ) : (
                      <Badge variant="secondary">Neutru</Badge>
                    )}
                  </div>
                  {preTradeAi.notaExecutive ? (
                    <p className="font-medium text-foreground">{preTradeAi.notaExecutive}</p>
                  ) : null}
                  {preTradeAi.analizaTehnica ? (
                    <div>
                      <p className="text-[10px] font-semibold uppercase text-muted-foreground">Analiză tehnică</p>
                      <p className="whitespace-pre-wrap text-muted-foreground">{preTradeAi.analizaTehnica}</p>
                    </div>
                  ) : null}
                  {Array.isArray(preTradeAi.chartOverlaySpecs) && preTradeAi.chartOverlaySpecs.length > 0 ? (
                    <div>
                      <p className="text-[10px] font-semibold uppercase text-muted-foreground">Indicatori pe grafic</p>
                      <p className="text-muted-foreground">
                        {preTradeAi.chartOverlaySpecs.map((s) => s.title).join(" · ")}
                      </p>
                    </div>
                  ) : null}
                  {preTradeAi.sugestieBot ? (
                    <div>
                      <p className="text-[10px] font-semibold uppercase text-muted-foreground">Bot / strategie</p>
                      <p className="whitespace-pre-wrap text-muted-foreground">{preTradeAi.sugestieBot}</p>
                      <Link
                        href="/bots"
                        className="mt-1 inline-block text-xs font-medium text-primary underline underline-offset-2"
                      >
                        Deschide Bots
                      </Link>
                    </div>
                  ) : null}
                  {Array.isArray(preTradeAi.avertismente) && preTradeAi.avertismente.length > 0 ? (
                    <ul className="list-inside list-disc text-amber-200/90">
                      {preTradeAi.avertismente.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="trading-card-shell lg:col-span-2">
          <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-4">
            <div>
              <CardTitle>Grafic candlestick</CardTitle>
              <CardDescription>Pereche: {normPair(symbol)}</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!customPair ? (
                <select
                  className="h-10 min-w-[10rem] rounded-md border border-input bg-background px-3 text-sm"
                  value={suggested.includes(normPair(symbol)) ? normPair(symbol) : "__custom__"}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__custom__") {
                      setCustomPair(true);
                      return;
                    }
                    setSymbol(v);
                  }}
                >
                  {suggested.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                  <option value="__custom__">Alta (scrie manual)…</option>
                </select>
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    className="w-36"
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                    placeholder={DEFAULT_SPOT_PAIR}
                  />
                  <Button type="button" size="sm" variant="outline" onClick={() => setCustomPair(false)}>
                    Listă
                  </Button>
                </div>
              )}
              <div className="flex gap-1">
                {TF_OPTIONS.map((tf) => (
                  <Button
                    key={tf}
                    type="button"
                    size="sm"
                    variant={timeframe === tf ? "default" : "outline"}
                    onClick={() => setTimeframe(tf)}
                  >
                    {tf}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <TradingChart
              key={`${normPair(symbol)}-${timeframe}-${chartSpotOnly ? "spot" : "all"}`}
              symbol={normPair(symbol)}
              timeframe={timeframe}
              spotOnly={chartSpotOnly}
              aiOverlaySpecs={
                preTradeAi?.chartOverlaySpecs?.length ? preTradeAi.chartOverlaySpecs : null
              }
            />
          </CardContent>
        </Card>

        <Card className="trading-card-shell">
          <CardHeader>
            <CardTitle>Ordin manual</CardTitle>
            <CardDescription>
              Pereche activă: <strong className="text-foreground">{normPair(symbol)}</strong>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
              <div className="font-medium text-muted-foreground">Disponibil pentru această pereche ({mode})</div>
              <div className="mt-1 font-mono">
                <span className="text-muted-foreground">{parsePair(symbol).base}:</span> {fmt(baseFree)}{" "}
                <span className="text-muted-foreground">| {parsePair(symbol).quote}:</span> {fmt(quoteFree)}
              </div>
              {mode === "paper" && parsePair(symbol).quote !== DEFAULT_QUOTE_ASSET && (
                <p className="mt-1 text-xs text-amber-600">
                  Paper: doar perechi {DEFAULT_QUOTE_ASSET} (ex. BTC/{DEFAULT_QUOTE_ASSET}). Pentru alte cote folosește Real.
                </p>
              )}
            </div>

            <form className="space-y-4" onSubmit={submitManual}>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={mode === "paper" ? "default" : "outline"} onClick={() => setMode("paper")}>
                  Paper
                </Button>
                <Button type="button" size="sm" variant={mode === "real" ? "default" : "outline"} onClick={() => setMode("real")}>
                  Real (Binance)
                </Button>
              </div>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={side === "buy" ? "default" : "outline"} onClick={() => setSide("buy")}>
                  Cumpără
                </Button>
                <Button type="button" size="sm" variant={side === "sell" ? "secondary" : "outline"} onClick={() => setSide("sell")}>
                  Vinde
                </Button>
              </div>
              {side === "buy" ? (
                <div className="space-y-2">
                  <Label>Cheltuială în {parsePair(symbol).quote} (market buy)</Label>
                  <Input value={spendQuote} onChange={(e) => setSpendQuote(e.target.value)} inputMode="decimal" />
                  <p className="text-xs text-muted-foreground">sau cantitate în {parsePair(symbol).base} mai jos</p>
                  <Label>Cantitate bază (opțional)</Label>
                  <Input value={amountBase} onChange={(e) => setAmountBase(e.target.value)} inputMode="decimal" />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Cantitate {parsePair(symbol).base} de vândut</Label>
                  <div className="flex flex-wrap gap-1">
                    <Button type="button" size="sm" variant="outline" onClick={() => applyPctSell(25)}>
                      25%
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => applyPctSell(50)}>
                      50%
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => applyPctSell(100)}>
                      MAX
                    </Button>
                  </div>
                  <Input value={amountBase} onChange={(e) => setAmountBase(e.target.value)} inputMode="decimal" />
                </div>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "…" : `Trimite — ${normPair(symbol)}`}
              </Button>
              <Button type="button" variant="outline" className="w-full" onClick={resetPaper}>
                Resetează paper (10k {DEFAULT_QUOTE_ASSET})
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card className="trading-card-shell">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Raport performanță</CardTitle>
            <CardDescription>Similar TradingView Strategy Tester (eșantion din istoricul tău).</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
            >
              <option value="all">Toate sursele</option>
              <option value="manual">Doar manual</option>
              <option value="bot">Doar bot</option>
              <option value="copy">Doar copy</option>
            </select>
            <Button type="button" size="sm" variant="secondary" onClick={() => loadStats()}>
              Reîncarcă
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {orderRows.map((row) => (
              <div key={row.key} className="rounded-md border border-border bg-card/50 px-3 py-2">
                <div className="text-xs text-muted-foreground">{row.label}</div>
                <div className="font-mono text-sm font-medium">{row.value}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function TradingPage() {
  return (
    <Suspense
      fallback={
        <div className="py-16 text-center text-muted-foreground">Se încarcă trading…</div>
      }
    >
      <TradingPageInner />
    </Suspense>
  );
}

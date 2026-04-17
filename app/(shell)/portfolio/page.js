"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shell/PageHeader";
import "@/app/(shell)/portfolio/portfolio-dashboard.css";

const STABLE_SYMBOLS = ["USDC", "USDT", "FDUSD", "DAI"];

function fmtUsd(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function fmtPct(n, withSign = false) {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = Number(n).toFixed(2);
  if (withSign) return `${n >= 0 ? "+" : ""}${s}%`;
  return `${s}%`;
}

function fmtQty(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1) return Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 });
  if (abs === 0) return "0";
  return Number(n).toPrecision(4);
}

function normSymbol(s) {
  return String(s ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function actionLabel(a) {
  switch (a) {
    case "buy":
      return "Cumpără";
    case "sell":
      return "Vinde";
    case "open":
      return "Deschide";
    case "close":
      return "Lichidează";
    default:
      return "Menține";
  }
}

function actionBadge(a) {
  if (a === "buy" || a === "open") return "border-emerald-500/50 text-emerald-300";
  if (a === "sell" || a === "close") return "border-red-500/50 text-red-300";
  return "border-white/15 text-muted-foreground";
}

function defaultTargets() {
  return [
    { symbol: "BTC", targetPct: 40, note: "" },
    { symbol: "ETH", targetPct: 30, note: "" },
    { symbol: "USDC", targetPct: 30, note: "Cash pentru rebalansări" },
  ];
}

export default function PortfolioPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState(null);
  const [tolerance, setTolerance] = useState(5);
  const [dustThreshold, setDustThreshold] = useState(1);
  const [includeRealSpot, setIncludeRealSpot] = useState(true);
  const [includeManual, setIncludeManual] = useState(true);
  const [targets, setTargets] = useState([]);
  const [manualHoldings, setManualHoldings] = useState([]);
  /** Card-ul de praf e ascuns implicit; utilizatorul îl expandează la cerere. */
  const [showDust, setShowDust] = useState(false);

  const hydrate = useCallback((payload) => {
    setData(payload);
    const p = payload?.portfolio || {};
    setTolerance(Number(p.tolerancePct ?? 5));
    setDustThreshold(Number(p.dustThresholdUsd ?? 1));
    setIncludeRealSpot(p.includeRealSpot !== false);
    setIncludeManual(p.includeManual !== false);
    setTargets(
      Array.isArray(p.targets) && p.targets.length > 0
        ? p.targets.map((t) => ({ ...t }))
        : []
    );
    setManualHoldings(
      Array.isArray(p.manualHoldings) ? p.manualHoldings.map((h) => ({ ...h })) : []
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/portfolio");
        const j = await r.json();
        if (!r.ok) {
          toast.error(j.error || "Nu s-au putut încărca datele");
          return;
        }
        if (!cancelled) hydrate(j);
      } catch {
        toast.error("Eroare rețea");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrate]);

  const targetsTotal = useMemo(
    () => targets.reduce((s, t) => s + (Number(t.targetPct) || 0), 0),
    [targets]
  );

  const targetsValid = Math.abs(targetsTotal - 100) < 0.01 || targets.length === 0;

  async function save() {
    setSaving(true);
    try {
      const cleanedTargets = targets
        .map((t) => ({
          symbol: normSymbol(t.symbol),
          targetPct: Number(t.targetPct) || 0,
          note: String(t.note || "").slice(0, 200),
        }))
        .filter((t) => t.symbol && t.targetPct >= 0);

      const cleanedHoldings = manualHoldings
        .map((h) => ({
          symbol: normSymbol(h.symbol),
          quantity: Number(h.quantity) || 0,
          avgCost: Number(h.avgCost) || 0,
          note: String(h.note || "").slice(0, 200),
        }))
        .filter((h) => h.symbol && h.quantity > 0);

      const r = await fetch("/api/portfolio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tolerancePct: Number(tolerance) || 5,
          dustThresholdUsd: Math.max(0, Number(dustThreshold) || 0),
          includeRealSpot,
          includeManual,
          targets: cleanedTargets,
          manualHoldings: cleanedHoldings,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error(j.error || "Salvare eșuată");
        return;
      }
      hydrate(j);
      toast.success("Portofoliu salvat");
    } catch {
      toast.error("Eroare rețea la salvare");
    } finally {
      setSaving(false);
    }
  }

  function addTarget() {
    setTargets((prev) => [...prev, { symbol: "", targetPct: 0, note: "" }]);
  }
  function updateTarget(idx, patch) {
    setTargets((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  }
  function removeTarget(idx) {
    setTargets((prev) => prev.filter((_, i) => i !== idx));
  }
  function loadTemplate() {
    setTargets(defaultTargets());
  }
  function normalizeTargets() {
    const total = targets.reduce((s, t) => s + (Number(t.targetPct) || 0), 0);
    if (total <= 0) return;
    setTargets((prev) =>
      prev.map((t) => ({
        ...t,
        targetPct: Number((((Number(t.targetPct) || 0) / total) * 100).toFixed(2)),
      }))
    );
  }

  function addHolding() {
    setManualHoldings((prev) => [...prev, { symbol: "", quantity: 0, avgCost: 0, note: "" }]);
  }
  function updateHolding(idx, patch) {
    setManualHoldings((prev) => prev.map((h, i) => (i === idx ? { ...h, ...patch } : h)));
  }
  function removeHolding(idx) {
    setManualHoldings((prev) => prev.filter((_, i) => i !== idx));
  }

  const snapshot = data?.snapshot;
  const allRows = snapshot?.rows || [];
  const alerts = snapshot?.alerts || [];
  const totals = snapshot?.totals;
  const dustThresholdUsd = snapshot?.dustThresholdUsd ?? 1;
  /** Ascundem praful din tabelul principal; apare în cardul dedicat de mai jos. */
  const rows = allRows.filter((r) => !r.isDust);
  const dustRows = allRows.filter((r) => r.isDust);

  return (
    <div className="portfolio-dashboard space-y-8">
      <header className="portfolio-hero">
        <div className="portfolio-hero-inner">
          <PageHeader
            title="Portofoliu"
            description="Setează alocări țintă pe termen lung (ex. 40% BTC · 30% ETH · 30% stable) și primești alerte clare când driftul depășește toleranța ta."
          >
            <div className="flex flex-wrap items-center gap-2 pt-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="border-purple-400/40 text-purple-200">
                Țintele pe termen lung
              </Badge>
              {data?.real?.connected ? (
                <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">
                  Spot Binance conectat
                </Badge>
              ) : (
                <Badge variant="outline" className="border-amber-500/40 text-amber-200">
                  Spot Binance neconectat
                </Badge>
              )}
              <span>Moneda de referință: USDC</span>
            </div>
          </PageHeader>
        </div>
      </header>

      {loading ? (
        <p className="text-sm text-muted-foreground">Se încarcă portofoliul…</p>
      ) : (
        <>
          <section className="portfolio-kpi-grid">
            <div className="portfolio-kpi">
              <div className="portfolio-kpi-label">Valoare totală</div>
              <div className="portfolio-kpi-value">{fmtUsd(totals?.valueUsd)}</div>
            </div>
            <div className="portfolio-kpi">
              <div className="portfolio-kpi-label">Cost total (cost basis)</div>
              <div className="portfolio-kpi-value">{fmtUsd(totals?.costUsd)}</div>
            </div>
            <div className="portfolio-kpi">
              <div className="portfolio-kpi-label">PnL</div>
              <div
                className={`portfolio-kpi-value ${
                  (totals?.pnlUsd ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {totals?.costUsd > 0
                  ? `${(totals.pnlUsd ?? 0) >= 0 ? "+" : ""}${fmtUsd(totals.pnlUsd).replace("$", "$")} · ${fmtPct(totals.pnlPct, true)}`
                  : "—"}
              </div>
            </div>
            <div className="portfolio-kpi">
              <div className="portfolio-kpi-label">Active cu balanță</div>
              <div className="portfolio-kpi-value">
                {totals?.assetCount ?? 0}
                {totals?.dustCount > 0 && (
                  <span
                    className="ml-2 text-xs font-normal text-amber-300"
                    title={`Praf (< $${dustThresholdUsd}): ${totals.dustCount} · ${fmtUsd(totals.dustValueUsd)}`}
                  >
                    · praf {totals.dustCount} ({fmtUsd(totals.dustValueUsd)})
                  </span>
                )}
              </div>
            </div>
          </section>

          {alerts.length > 0 && (
            <Card className="portfolio-card-shell border-amber-500/20">
              <CardContent className="flex flex-col gap-1.5 py-3 text-sm">
                {alerts.map((a, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <Badge
                      variant="outline"
                      className={
                        a.level === "warn"
                          ? "border-amber-500/40 text-amber-200"
                          : "border-sky-400/40 text-sky-200"
                      }
                    >
                      {a.level === "warn" ? "Atenție" : "Info"}
                    </Badge>
                    <span className="text-muted-foreground">{a.message}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card className="portfolio-card-shell">
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  Alocare curentă vs țintă
                  <Badge variant="secondary" className="font-normal">
                    ±{Number(tolerance).toFixed(1)} pp toleranță
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Bara violet/cyan arată alocarea curentă; liniuța galbenă marchează ținta. Acțiunile
                  recomandate readuc portofoliul în toleranță.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border border-border/70">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/60 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Activ</th>
                      <th className="px-3 py-2">Cantitate</th>
                      <th className="px-3 py-2">Valoare</th>
                      <th className="px-3 py-2 min-w-[220px]">Alocare (curent vs țintă)</th>
                      <th className="px-3 py-2">Drift</th>
                      <th className="px-3 py-2">Acțiune</th>
                      <th className="px-3 py-2">Δ ≈ USD</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                          Încă nu există holdings. Conectează Binance sau adaugă manual mai jos.
                        </td>
                      </tr>
                    ) : (
                      rows.map((row) => {
                        const targetPct = row.targetPct;
                        const curW = Math.min(100, Math.max(0, row.currentPct));
                        const tgtLeft = targetPct == null ? null : Math.min(100, Math.max(0, targetPct));
                        const tradingPair = row.isStable ? null : `${row.symbol}/USDC`;
                        return (
                          <tr key={row.symbol} className="border-t border-border/60">
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{row.symbol}</span>
                                {row.isStable && (
                                  <Badge variant="outline" className="text-[10px] font-normal">
                                    stable
                                  </Badge>
                                )}
                                {row.sources?.manual > 0 && row.sources?.real > 0 ? (
                                  <Badge variant="outline" className="text-[10px] font-normal">
                                    spot + manual
                                  </Badge>
                                ) : row.sources?.manual > 0 ? (
                                  <Badge variant="outline" className="text-[10px] font-normal">
                                    manual
                                  </Badge>
                                ) : null}
                              </div>
                              {row.note && (
                                <div className="truncate text-xs text-muted-foreground" title={row.note}>
                                  {row.note}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">{fmtQty(row.quantity)}</td>
                            <td className="px-3 py-2 font-mono">{fmtUsd(row.valueUsd)}</td>
                            <td className="px-3 py-2">
                              <div className="space-y-1">
                                <div className="portfolio-bar-track">
                                  <div
                                    className="portfolio-bar-current"
                                    style={{ width: `${curW}%` }}
                                  />
                                  {tgtLeft != null && (
                                    <div
                                      className="portfolio-bar-target"
                                      style={{ left: `${tgtLeft}%` }}
                                    />
                                  )}
                                </div>
                                <div className="flex justify-between text-[11px] text-muted-foreground">
                                  <span>Curent: {fmtPct(row.currentPct)}</span>
                                  <span>Țintă: {targetPct == null ? "—" : fmtPct(targetPct)}</span>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-2 font-mono">
                              {targetPct == null ? (
                                <span className="text-muted-foreground">—</span>
                              ) : (
                                <span
                                  className={
                                    Math.abs(row.driftPct) > tolerance
                                      ? row.driftPct > 0
                                        ? "text-red-400"
                                        : "text-emerald-400"
                                      : "text-muted-foreground"
                                  }
                                >
                                  {fmtPct(row.driftPct, true)}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <Badge variant="outline" className={actionBadge(row.action)}>
                                {actionLabel(row.action)}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">
                              {row.targetPct == null
                                ? "—"
                                : row.deltaUsd >= 0
                                  ? `+${fmtUsd(row.deltaUsd)}`
                                  : `−${fmtUsd(Math.abs(row.deltaUsd))}`}
                            </td>
                            <td className="px-2 py-2">
                              {tradingPair ? (
                                <Button variant="ghost" size="sm" className="h-8 px-2" asChild>
                                  <Link href={`/trading?pair=${encodeURIComponent(tradingPair)}&from=portfolio`}>
                                    Trading
                                  </Link>
                                </Button>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="portfolio-card-shell">
              <CardHeader className="pb-3">
                <CardTitle>Setări</CardTitle>
                <CardDescription>
                  Toleranța și sursele considerate în calculul alocării.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="tolerance">Toleranță rebalansare (± puncte procentuale)</Label>
                  <Input
                    id="tolerance"
                    type="number"
                    min={0.5}
                    max={30}
                    step={0.5}
                    value={tolerance}
                    onChange={(e) => setTolerance(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Ex. toleranță 5 pp înseamnă că o țintă de 40% e ok între 35% și 45%.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dustThreshold">Prag „praf” (USD)</Label>
                  <Input
                    id="dustThreshold"
                    type="number"
                    min={0}
                    max={1000}
                    step="any"
                    value={dustThreshold}
                    onChange={(e) => setDustThreshold(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Activele sub această valoare sunt mutate în secțiunea „Praf” (ascunsă implicit), ca
                    să nu încarce tabelul principal.
                  </p>
                </div>
                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border/70 bg-background/50 px-3 py-2 text-sm">
                  <span>
                    <span className="font-medium">Include Spot Binance</span>
                    <span className="block text-[11px] text-muted-foreground">
                      Balanțele reale de pe Binance (necesită API key).
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={includeRealSpot}
                    onChange={(e) => setIncludeRealSpot(e.target.checked)}
                    className="h-4 w-4"
                  />
                </label>
                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border/70 bg-background/50 px-3 py-2 text-sm">
                  <span>
                    <span className="font-medium">Include holdings manuale</span>
                    <span className="block text-[11px] text-muted-foreground">
                      Monede ținute off-exchange (hardware wallet, altă bursă).
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={includeManual}
                    onChange={(e) => setIncludeManual(e.target.checked)}
                    className="h-4 w-4"
                  />
                </label>
                <Button
                  type="button"
                  onClick={save}
                  disabled={saving || !targetsValid}
                  className="w-full font-semibold"
                >
                  {saving ? "Se salvează…" : "Salvează portofoliul"}
                </Button>
                {!targetsValid && (
                  <p className="text-[11px] text-amber-300">
                    Suma țintelor este {targetsTotal.toFixed(2)}% (trebuie 100% pentru a salva).
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="portfolio-card-shell">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between gap-2">
                  <span>Ținte alocare</span>
                  <span
                    className={`text-xs font-mono ${
                      targetsValid ? "text-muted-foreground" : "text-amber-300"
                    }`}
                  >
                    {targetsTotal.toFixed(2)}% / 100%
                  </span>
                </CardTitle>
                <CardDescription>Definește ponderile pe termen lung per simbol.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {targets.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border/70 p-3 text-xs text-muted-foreground">
                    Nu ai definit ținte. Poți porni de la un șablon de bază sau să adaugi manual.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {targets.map((t, idx) => (
                      <div
                        key={idx}
                        className="grid grid-cols-[1fr,90px,auto] gap-2 rounded-md border border-border/60 bg-background/50 p-2"
                      >
                        <Input
                          value={t.symbol}
                          placeholder="Ex. BTC"
                          onChange={(e) => updateTarget(idx, { symbol: e.target.value.toUpperCase() })}
                        />
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          step={0.5}
                          value={t.targetPct}
                          onChange={(e) => updateTarget(idx, { targetPct: Number(e.target.value) })}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeTarget(idx)}
                          className="shrink-0"
                        >
                          ✕
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={addTarget}>
                    + Adaugă țintă
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={loadTemplate}>
                    Șablon 40/30/30
                  </Button>
                  {targets.length > 0 && Math.abs(targetsTotal - 100) > 0.01 && targetsTotal > 0 && (
                    <Button type="button" variant="ghost" size="sm" onClick={normalizeTargets}>
                      Normalizează la 100%
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="portfolio-card-shell">
              <CardHeader className="pb-3">
                <CardTitle>Holdings manuale (off-exchange)</CardTitle>
                <CardDescription>
                  Adaugă cantități ținute în afara Binance (hardware wallet, altă platformă).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {manualHoldings.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border/70 p-3 text-xs text-muted-foreground">
                    Nimic manual. Adaugă un activ dacă ai fonduri în afara Binance.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {manualHoldings.map((h, idx) => (
                      <div
                        key={idx}
                        className="grid grid-cols-[1fr,1fr,1fr,auto] gap-2 rounded-md border border-border/60 bg-background/50 p-2"
                      >
                        <Input
                          placeholder="Simbol"
                          value={h.symbol}
                          onChange={(e) => updateHolding(idx, { symbol: e.target.value.toUpperCase() })}
                        />
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          placeholder="Cantitate"
                          value={h.quantity}
                          onChange={(e) => updateHolding(idx, { quantity: Number(e.target.value) })}
                        />
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          placeholder="Cost mediu (USD)"
                          value={h.avgCost}
                          onChange={(e) => updateHolding(idx, { avgCost: Number(e.target.value) })}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeHolding(idx)}
                          className="shrink-0"
                        >
                          ✕
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <Button type="button" variant="outline" size="sm" onClick={addHolding}>
                  + Adaugă holding
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Stabile recunoscute ca ~1 USD: {STABLE_SYMBOLS.join(", ")} etc.
                </p>
              </CardContent>
            </Card>
          </div>

          {dustRows.length > 0 && (
            <Card className="portfolio-card-shell border-amber-500/20">
              <CardHeader className="pb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    <span>Praf (&lt; {fmtUsd(dustThresholdUsd)})</span>
                    <Badge variant="outline" className="border-amber-500/40 text-amber-200">
                      {dustRows.length} {dustRows.length === 1 ? "activ" : "active"}
                    </Badge>
                    <Badge variant="secondary" className="font-mono font-normal">
                      ≈ {fmtUsd(totals?.dustValueUsd)}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    Fragmente reziduale sub pragul de {fmtUsd(dustThresholdUsd)} — ascunse implicit
                    din tabelul principal. Poți converti rapid praful în BNB direct pe Binance
                    (funcția „Convert Small Balance”).
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDust((v) => !v)}
                  className="shrink-0"
                >
                  {showDust ? "Ascunde praful" : "Arată praful"}
                </Button>
              </CardHeader>
              {showDust && (
                <CardContent>
                  <div className="overflow-x-auto rounded-md border border-border/70">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-muted/60 text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2">Activ</th>
                          <th className="px-3 py-2">Cantitate</th>
                          <th className="px-3 py-2">Preț</th>
                          <th className="px-3 py-2">Valoare</th>
                          <th className="px-3 py-2">Sursă</th>
                          <th className="px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {dustRows.map((row) => {
                          const tradingPair = `${row.symbol}/USDC`;
                          return (
                            <tr key={row.symbol} className="border-t border-border/60">
                              <td className="px-3 py-2 font-medium">{row.symbol}</td>
                              <td className="px-3 py-2 font-mono text-xs">{fmtQty(row.quantity)}</td>
                              <td className="px-3 py-2 font-mono text-xs">
                                {row.price > 0 ? fmtUsd(row.price) : "—"}
                              </td>
                              <td className="px-3 py-2 font-mono text-amber-200">{fmtUsd(row.valueUsd)}</td>
                              <td className="px-3 py-2 text-xs text-muted-foreground">
                                {row.sources?.real > 0 && row.sources?.manual > 0
                                  ? "spot + manual"
                                  : row.sources?.manual > 0
                                    ? "manual"
                                    : "spot"}
                              </td>
                              <td className="px-2 py-2">
                                <div className="flex items-center gap-1">
                                  <Button variant="ghost" size="sm" className="h-8 px-2" asChild>
                                    <Link
                                      href={`/trading?pair=${encodeURIComponent(tradingPair)}&from=portfolio`}
                                    >
                                      Trading
                                    </Link>
                                  </Button>
                                  <Button variant="ghost" size="sm" className="h-8 px-2" asChild>
                                    <a
                                      href="https://www.binance.com/en/my/wallet/account/main/convert-small-balance"
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      Convertește
                                    </a>
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              )}
            </Card>
          )}

          <p className="text-xs text-muted-foreground">
            Nu este sfat financiar. Prețurile vin de la Binance public API și pot fi întârziate câteva
            secunde. Acțiunile recomandate sunt orientative — execuția rămâne la tine din pagina Trading.
          </p>
        </>
      )}
    </div>
  );
}

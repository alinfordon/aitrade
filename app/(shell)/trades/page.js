"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shell/PageHeader";
import "@/app/(shell)/trades/trades-dashboard.css";

const PAGE_SIZE = 50;

export default function TradesPage() {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pair, setPair] = useState("");
  const [side, setSide] = useState("all");
  const [mode, setMode] = useState("real");
  const [source, setSource] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [aiPilotOnly, setAiPilotOnly] = useState(false);

  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  const buildQuery = useCallback(() => {
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String((page - 1) * PAGE_SIZE));
    if (pair.trim()) params.set("pair", pair.trim());
    if (side !== "all") params.set("side", side);
    if (mode === "paper") params.set("isPaper", "1");
    if (mode === "real") params.set("isPaper", "0");
    if (source !== "all") params.set("tradeSource", source);
    if (from) params.set("from", new Date(from).toISOString());
    if (to) {
      const d = new Date(to);
      d.setDate(d.getDate() + 1);
      params.set("to", d.toISOString());
    }
    if (aiPilotOnly) params.set("aiPilotControl", "1");
    return params.toString();
  }, [page, pair, side, mode, source, from, to, aiPilotOnly]);

  const load = useCallback(() => {
    setLoading(true);
    const qs = buildQuery();
    fetch(`/api/trades?${qs}`)
      .then((r) => r.json())
      .then((j) => {
        setTrades(Array.isArray(j.trades) ? j.trades : []);
        setTotal(Number(j.total) || 0);
      })
      .catch(() => {
        setTrades([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [buildQuery]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  return (
    <div className="trades-dashboard space-y-8">
      <header className="trades-hero">
        <div className="trades-hero-inner">
          <PageHeader
            title="Tranzacții"
            description="Istoric tranzacții live, simulate și copy trading — cu marcaje paper / copy unde e cazul."
          />
        </div>
      </header>

      <Card className="trades-card-shell">
        <CardHeader>
          <CardTitle>Filtre</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Pereche</Label>
            <Input
              value={pair}
              onChange={(e) => {
                setPair(e.target.value);
                setPage(1);
              }}
              placeholder="ex: BTC/USDC"
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Side</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={side}
              onChange={(e) => {
                setSide(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">Toate</option>
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Mod</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={mode}
              onChange={(e) => {
                setMode(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">Toate</option>
              <option value="real">Real</option>
              <option value="paper">Paper</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Sursă</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">Toate</option>
              <option value="manual">Manual</option>
              <option value="bot">Bot</option>
              <option value="copy">Copy</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>De la</Label>
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Până la</Label>
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={aiPilotOnly}
                onChange={(e) => {
                  setAiPilotOnly(e.target.checked);
                  setPage(1);
                }}
              />
              Doar AI Pilot
            </label>
          </div>
          <div className="flex items-end justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => load()}>
              Reîncarcă
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setPair("");
                setSide("all");
                setMode("all");
                setSource("all");
                setFrom("");
                setTo("");
                setAiPilotOnly(false);
                setPage(1);
              }}
            >
              Resetează
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="trades-card-shell">
        <CardHeader>
          <CardTitle>
            Recent · {total} total · pagina {page}/{pageCount}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-2 pr-4">Time</th>
                <th className="py-2 pr-4">Pair</th>
                <th className="py-2 pr-4">Side</th>
                <th className="py-2 pr-4">Qty</th>
                <th className="py-2 pr-4">Price</th>
                <th className="py-2 pr-4">PnL</th>
                <th className="py-2">Flags</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="py-4 text-muted-foreground" colSpan={7}>
                    Se încarcă…
                  </td>
                </tr>
              ) : trades.length === 0 ? (
                <tr>
                  <td className="py-4 text-muted-foreground" colSpan={7}>
                    Nu există tranzacții pentru filtrele curente.
                  </td>
                </tr>
              ) : (
                trades.map((t) => (
                <tr key={t._id} className="border-b border-border/60">
                  <td className="py-2 pr-4 text-muted-foreground">
                    {new Date(t.createdAt).toLocaleString()}
                  </td>
                  <td className="py-2 pr-4">{t.pair}</td>
                  <td
                    className={`py-2 pr-4 font-semibold ${
                      t.side === "buy"
                        ? "text-amber-300"
                        : t.pnl != null && Number(t.pnl) >= 0
                          ? "text-emerald-400"
                          : "text-rose-400"
                    }`}
                  >
                    {t.side}
                  </td>
                  <td className="py-2 pr-4">{Number(t.quantity).toFixed(6)}</td>
                  <td className="py-2 pr-4">{Number(t.price).toFixed(4)}</td>
                  <td className="py-2 pr-4">
                    {t.side === "buy" ? (
                      <span className="font-semibold text-amber-300">
                        {(Number(t.quantity) * Number(t.price)).toFixed(4)}
                      </span>
                    ) : t.pnl != null ? (
                      <span
                        className={
                          Number(t.pnl) >= 0
                            ? "font-semibold text-emerald-400"
                            : "font-semibold text-rose-400"
                        }
                      >
                        {Number(t.pnl) >= 0 ? "+" : ""}
                        {Number(t.pnl).toFixed(4)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2">
                    {t.isPaper && <Badge variant="outline">paper</Badge>}
                    {t.traderId && <Badge className="ml-1">copy</Badge>}
                    {t.meta?.aiPilotControl && <Badge className="ml-1" variant="secondary">pilot</Badge>}
                  </td>
                </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button type="button" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Anterior
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={page >= pageCount}
              onClick={() => setPage((p) => p + 1)}
            >
              Următor
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shell/PageHeader";

const TRADES_POLL_MS = 14_000;

export default function TradesPage() {
  const [trades, setTrades] = useState([]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/trades?limit=100")
        .then((r) => r.json())
        .then((j) => {
          if (!cancelled) setTrades(j.trades || []);
        })
        .catch(() => {
          if (!cancelled) setTrades([]);
        });
    };
    load();
    const id = setInterval(load, TRADES_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Tranzacții"
        description="Istoric tranzacții live, simulate și copy trading — cu marcaje paper / copy unde e cazul."
      />

      <Card>
        <CardHeader>
          <CardTitle>Recent</CardTitle>
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
              {trades.map((t) => (
                <tr key={t._id} className="border-b border-border/60">
                  <td className="py-2 pr-4 text-muted-foreground">
                    {new Date(t.createdAt).toLocaleString()}
                  </td>
                  <td className="py-2 pr-4">{t.pair}</td>
                  <td className="py-2 pr-4">{t.side}</td>
                  <td className="py-2 pr-4">{Number(t.quantity).toFixed(6)}</td>
                  <td className="py-2 pr-4">{Number(t.price).toFixed(4)}</td>
                  <td className="py-2 pr-4">{t.pnl != null ? Number(t.pnl).toFixed(4) : "—"}</td>
                  <td className="py-2">
                    {t.isPaper && <Badge variant="outline">paper</Badge>}
                    {t.traderId && <Badge className="ml-1">copy</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { PageHeader } from "@/components/shell/PageHeader";

export default function LeaderboardPage() {
  const [rows, setRows] = useState([]);
  const [loadState, setLoadState] = useState("loading");
  const [loadError, setLoadError] = useState(null);
  const [traderId, setTraderId] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadState("loading");
      setLoadError(null);
      try {
        const r = await fetch("/api/leaderboard");
        const j = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) {
          setRows([]);
          setLoadError(j.error || r.statusText || "Nu s-au putut încărca datele.");
          setLoadState("error");
          return;
        }
        setRows(Array.isArray(j.leaderboard) ? j.leaderboard : []);
        setLoadState("idle");
      } catch (e) {
        if (cancelled) return;
        setRows([]);
        setLoadError(e instanceof Error ? e.message : "Eroare la încărcare.");
        setLoadState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function follow() {
    const r = await fetch("/api/follow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ traderId }),
    });
    const j = await r.json();
    if (!r.ok) toast.error(j.error || "Follow failed");
    else toast.success("Now following");
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Leaderboard"
        description="Clasament pe performanță modelată. Urmărește traderi pentru execuție copy proporțională în pereche."
      />

      <Card>
        <CardHeader>
          <CardTitle>Copy trading</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs text-muted-foreground">Trader user ID</label>
            <Input value={traderId} onChange={(e) => setTraderId(e.target.value)} placeholder="Mongo ObjectId" />
          </div>
          <Button type="button" onClick={follow}>
            Follow
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rankings</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {loadState === "loading" ? (
            <p className="text-sm text-muted-foreground">Se încarcă clasamentul…</p>
          ) : loadState === "error" ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Niciun utilizator în baza de date sau toate valorile sunt încă zero — statisticile de profit și tranzacții
              se actualizează la paper/live manual și boturi.
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 pr-4">#</th>
                  <th className="py-2 pr-4">User</th>
                  <th className="py-2 pr-4">Profit</th>
                  <th className="py-2 pr-4">Win rate</th>
                  <th className="py-2 pr-4">Trades</th>
                  <th className="py-2">Plan</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.userId} className="border-b border-border/60">
                    <td className="py-2 pr-4">{r.rank}</td>
                    <td className="py-2 pr-4">
                      <div className="flex flex-col gap-0.5">
                        {r.displayName ? (
                          <span className="font-medium text-foreground">{r.displayName}</span>
                        ) : null}
                        <span className="font-mono text-xs text-muted-foreground">{r.userId}</span>
                      </div>
                    </td>
                    <td className="py-2 pr-4">{Number(r.totalProfit).toFixed(4)}</td>
                    <td className="py-2 pr-4">{(Number(r.winRate) * 100).toFixed(1)}%</td>
                    <td className="py-2 pr-4">{r.totalTrades}</td>
                    <td className="py-2 capitalize">{r.plan ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

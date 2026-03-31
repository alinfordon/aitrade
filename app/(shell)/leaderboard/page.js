"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { PageHeader } from "@/components/shell/PageHeader";

export default function LeaderboardPage() {
  const [rows, setRows] = useState([]);
  const [traderId, setTraderId] = useState("");

  useEffect(() => {
    fetch("/api/leaderboard")
      .then((r) => r.json())
      .then((j) => setRows(j.leaderboard || []));
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
                  <td className="py-2 pr-4 font-mono text-xs">{r.userId}</td>
                  <td className="py-2 pr-4">{Number(r.totalProfit).toFixed(4)}</td>
                  <td className="py-2 pr-4">{(Number(r.winRate) * 100).toFixed(1)}%</td>
                  <td className="py-2 pr-4">{r.totalTrades}</td>
                  <td className="py-2 capitalize">{r.plan}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

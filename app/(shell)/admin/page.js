"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  Bot,
  LayoutDashboard,
  Layers,
  Link2,
  Play,
  RefreshCw,
  Shield,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function StatCard({ icon: Icon, label, value, sub }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/[0.08] bg-gradient-to-br from-card/80 via-card/50 to-card/25 p-4 backdrop-blur-xl",
        "shadow-lg shadow-black/20"
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-primary">
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="font-mono text-2xl tabular-nums text-foreground">{value}</p>
          {sub ? <p className="text-[11px] text-muted-foreground">{sub}</p> : null}
        </div>
      </div>
    </div>
  );
}

function fmtRoShort(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ro-RO", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "—";
  }
}

const TRADE_STATUS_RO = {
  filled: "Executat",
  simulated: "Simulat",
  failed: "Eșuat",
  cancelled: "Anulat",
};

/** PnL în DB e setat la ieșire (sell); la buy e mereu 0 — nu îl afișăm ca să nu pară „eșuat”. */
function formatAdminTradeNote(t) {
  const bits = [t.isPaper ? "paper" : "real"];
  if (t.botId) bits.push("bot");
  if (t.side === "sell" && t.pnl != null && Number.isFinite(Number(t.pnl))) {
    bits.push(`PnL ${Number(t.pnl).toFixed(2)}`);
  } else if (t.side === "buy") {
    bits.push("intrare");
  }
  return bits.join(" · ");
}

export default function AdminPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/overview");
      const j = await r.json();
      if (!r.ok) {
        toast.error(typeof j.error === "string" ? j.error : "Nu s-au putut încărca datele");
        setData(null);
        return;
      }
      setData(j);
    } catch {
      toast.error("Eroare rețea");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function runBotsBatch() {
    setRunning(true);
    try {
      const r = await fetch("/api/bot/run", { method: "POST" });
      const j = await r.json();
      if (!r.ok) {
        toast.error(typeof j.error === "string" ? j.error : "Eroare rulare");
        return;
      }
      toast.success(`Batch rulat: ${j.processed ?? 0} boturi procesate.`);
      await load();
    } catch {
      toast.error("Eroare rețea");
    } finally {
      setRunning(false);
    }
  }

  const pb = data?.planBreakdown || {};

  return (
    <div className="space-y-8">
      <PageHeader
        title="Panou de control"
        description="Statistici la nivel de platformă și operațiuni. Gestionarea utilizatorilor este în meniul din stânga."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} />
            Reîncarcă
          </Button>
          <Button type="button" size="sm" onClick={runBotsBatch} disabled={running}>
            <Play className="mr-1.5 h-3.5 w-3.5" />
            {running ? "Se rulează…" : "Rulează batch bots"}
          </Button>
          <Button type="button" variant="secondary" size="sm" asChild>
            <Link href="/admin/users">
              <Users className="mr-1.5 h-3.5 w-3.5" />
              Utilizatori
            </Link>
          </Button>
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href="/dashboard">
              <LayoutDashboard className="mr-1.5 h-3.5 w-3.5" />
              Dashboard app
            </Link>
          </Button>
        </div>
      </PageHeader>

      {loading && !data ? (
        <p className="text-sm text-muted-foreground">Se încarcă…</p>
      ) : data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <StatCard icon={Users} label="Utilizatori" value={data.usersTotal} />
            <StatCard
              icon={Shield}
              label="Distribuție plan"
              value={`${pb.free ?? 0} / ${pb.pro ?? 0} / ${pb.elite ?? 0}`}
              sub="free · pro · elite"
            />
            <StatCard
              icon={Bot}
              label="Bots"
              value={data.botsTotal}
              sub={`active ${data.botsActive} · paper ${data.botsPaper} · real ${data.botsReal}`}
            />
            <StatCard icon={Layers} label="Strategii" value={data.strategiesTotal} />
            <StatCard
              icon={Link2}
              label="Follow-uri active"
              value={data.followsActive}
              sub="copy trading"
            />
            <StatCard
              icon={Activity}
              label="Tranzacții (total)"
              value={data.tradesTotal}
              sub={`ultimele 24h: ${data.trades24h}${data.tradesFailed24h ? ` · eșuate 24h: ${data.tradesFailed24h}` : ""}`}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="border-white/10 bg-card/40 backdrop-blur-md">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Utilizatori noi (ultimii)</CardTitle>
                <CardDescription className="text-xs">Email, plan și dată creare</CardDescription>
              </CardHeader>
              <CardContent className="max-h-80 overflow-auto text-xs">
                <table className="w-full border-collapse font-mono">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-[10px] uppercase text-muted-foreground">
                      <th className="pb-2 pr-2">Creat</th>
                      <th className="pb-2 pr-2">Email</th>
                      <th className="pb-2 pr-2">Plan</th>
                      <th className="pb-2">Rol</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.recentUsers || []).map((u) => (
                      <tr key={u.id} className="border-b border-white/[0.06]">
                        <td className="py-1.5 pr-2 text-muted-foreground">{fmtRoShort(u.createdAt)}</td>
                        <td className="max-w-[200px] truncate py-1.5 pr-2" title={u.email}>
                          {u.email}
                        </td>
                        <td className="py-1.5 pr-2">
                          <Badge variant="outline" className="text-[10px] font-normal capitalize">
                            {u.subscriptionPlan}
                          </Badge>
                        </td>
                        <td className="py-1.5">
                          {u.role === "admin" ? (
                            <Badge className="text-[10px]">admin</Badge>
                          ) : (
                            <span className="text-muted-foreground">user</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-card/40 backdrop-blur-md">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Ultimele tranzacții (platformă)</CardTitle>
                <CardDescription className="text-xs leading-relaxed">
                  Toți utilizatorii — confidențial admin.                 
                </CardDescription>
              </CardHeader>
              <CardContent className="max-h-80 overflow-auto text-xs">
                <table className="w-full border-collapse font-mono">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-[10px] uppercase text-muted-foreground">
                      <th className="pb-2 pr-2">Timp</th>
                      <th className="pb-2 pr-2">Pair</th>
                      <th className="pb-2 pr-2">Side</th>
                      <th className="pb-2 pr-2">Status</th>
                      <th className="pb-2">Notă</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.recentTrades || []).map((t) => (
                      <tr key={t.id} className="border-b border-white/[0.06]">
                        <td className="whitespace-nowrap py-1.5 pr-2 text-muted-foreground">
                          {fmtRoShort(t.createdAt)}
                        </td>
                        <td className="py-1.5 pr-2">{t.pair}</td>
                        <td className="py-1.5 pr-2 capitalize">{t.side}</td>
                        <td className="py-1.5 pr-2">
                          <span
                            className={
                              t.status === "failed"
                                ? "text-red-400"
                                : t.status === "simulated"
                                  ? "text-amber-200/90"
                                  : "text-foreground"
                            }
                          >
                            {TRADE_STATUS_RO[t.status] || t.status}
                          </span>
                        </td>
                        <td className="py-1.5 text-[10px] text-muted-foreground">
                          {formatAdminTradeNote(t)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Pentru a acorda rol admin: în MongoDB setează{" "}
            <code className="rounded bg-white/5 px-1 py-0.5">role: &quot;admin&quot;</code> pe documentul
            utilizatorului, apoi utilizatorul face din nou login pentru a actualiza cookie-ul JWT.
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Nu sunt date de afișat.</p>
      )}
    </div>
  );
}

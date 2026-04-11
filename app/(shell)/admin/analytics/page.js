"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Bot,
  Clock,
  Globe,
  LineChart,
  Radio,
  RefreshCw,
  Sparkles,
  Trash2,
  TrendingUp,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function StatBlock({ icon: Icon, label, value, sub, accent }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/[0.08] bg-gradient-to-br from-card/85 via-card/45 to-card/20 p-4 backdrop-blur-xl",
        "shadow-lg shadow-black/15"
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]",
            accent ?? "text-primary"
          )}
        >
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="font-mono text-xl tabular-nums text-foreground sm:text-2xl">{value}</p>
          {sub ? <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{sub}</p> : null}
        </div>
      </div>
    </div>
  );
}

function HorizontalBars({ rows, labelKey, valueKey, formatValue }) {
  const max = useMemo(() => {
    if (!rows.length) return 1;
    return Math.max(...rows.map((r) => Number(r[valueKey]) || 0), 1);
  }, [rows, valueKey]);

  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">—</p>;
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const v = Number(row[valueKey]) || 0;
        const pct = (v / max) * 100;
        return (
          <li key={String(row[labelKey])}>
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
              <span className="truncate font-medium text-foreground">{row[labelKey]}</span>
              <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                {formatValue ? formatValue(v) : v}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary/80 to-accent/60"
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const SOURCE_RO = {
  bot: "Bot",
  manual: "Manual",
  copy: "Copy",
  unknown: "Necunoscut",
};

const CRON_JOB_LABEL = {
  "run-bots": "Run bots",
  "ai-pilot": "AI Pilot",
  "ai-pilot-manual-live": "AI Pilot · Live manual",
  "ai-optimize": "AI Optimize",
};

function cronRunSummaryLine(job, summary) {
  if (!summary || typeof summary !== "object") return "—";
  if (job === "run-bots") {
    const n = summary.processed ?? (Array.isArray(summary.items) ? summary.items.length : 0);
    return `${n} boți în rundă`;
  }
  if (job === "ai-pilot") {
    const u = summary.batchUsers ?? (Array.isArray(summary.items) ? summary.items.length : 0);
    return `${u} utilizatori în batch`;
  }
  if (job === "ai-pilot-manual-live") {
    const u = summary.batchUsers ?? (Array.isArray(summary.items) ? summary.items.length : 0);
    return `${u} utilizatori · verificare Live manual`;
  }
  if (job === "ai-optimize") {
    const t = summary.elitesTried ?? (Array.isArray(summary.items) ? summary.items.length : 0);
    return `${t} conturi elite încercate`;
  }
  return "—";
}

export default function AdminAnalyticsPage() {
  const [data, setData] = useState(null);
  const [cronLogs, setCronLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cleaningCron, setCleaningCron] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, rCron] = await Promise.all([
        fetch("/api/admin/analytics"),
        fetch("/api/admin/cron-runs?limit=50"),
      ]);
      const j = await r.json();
      let logs = [];
      if (rCron.ok) {
        const jc = await rCron.json();
        logs = Array.isArray(jc.logs) ? jc.logs : [];
      }
      setCronLogs(logs);
      if (!r.ok) {
        toast.error(typeof j.error === "string" ? j.error : "Eroare analytics");
        setData(null);
        return;
      }
      setData(j);
    } catch {
      toast.error("Rețea sau server");
      setData(null);
      setCronLogs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const cleanAllCronLogs = useCallback(async () => {
    if (
      !window.confirm(
        "Ștergi toate înregistrările de execuții cron din baza de date? Acțiunea nu poate fi anulată."
      )
    ) {
      return;
    }
    setCleaningCron(true);
    try {
      const r = await fetch("/api/admin/cron-runs", { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) {
        toast.error(typeof j.error === "string" ? j.error : "Eroare la ștergere");
        return;
      }
      toast.success(
        `Șterse ${typeof j.deletedCount === "number" ? j.deletedCount : 0} înregistrări cron`
      );
      await load();
    } catch {
      toast.error("Rețea sau server");
    } finally {
      setCleaningCron(false);
    }
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  const rel = data?.reliability;
  const failRatePct = rel ? (rel.failRate * 100).toFixed(2) : "0";

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <PageHeader
          title="Analytics"
          description="Tendințe agregate (UTC), surse de ordin, perechi active, AI Pilot și calitatea execuțiilor — vizibil doar pentru admin."
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="border-white/15" asChild>
            <Link href="/admin">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Înapoi admin
            </Link>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="border border-white/10"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
            Reîncarcă
          </Button>
        </div>
      </div>

      {loading && !data ? (
        <p className="text-sm text-muted-foreground">Se încarcă raportul…</p>
      ) : data ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="font-mono text-[10px]">
              <Globe className="mr-1 h-3 w-3" />
              Agregare {data.timezoneNote}
            </Badge>
            <span>
              Fereastră: ultimele <strong className="text-foreground">{data.rangeDays}</strong> zile · generat{" "}
              {new Date(data.generatedAt).toLocaleString("ro-RO")}
            </span>
          </div>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatBlock
              icon={Users}
              label="Utilizatori (total)"
              value={data.totals.users.toLocaleString("ro-RO")}
              sub="În întreaga bază"
            />
            <StatBlock
              icon={Bot}
              label="Boți / activi"
              value={`${data.totals.bots.toLocaleString("ro-RO")} / ${data.totals.botsActive}`}
              sub="Flux automatizat"
              accent="text-violet-400"
            />
            <StatBlock
              icon={Activity}
              label="Tranzacții (total)"
              value={data.totals.trades.toLocaleString("ro-RO")}
              sub="Toate statusurile"
            />
            <StatBlock
              icon={Sparkles}
              label="AI Pilot (ordin manual marcat)"
              value={data.aiPilot.tradesTotal.toLocaleString("ro-RO")}
              sub={`Ultimele 24h: ${data.aiPilot.tradesLast24h.toLocaleString("ro-RO")}`}
              accent="text-amber-400"
            />
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-white/[0.08] bg-card/40 backdrop-blur-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 font-display text-base">
                  <LineChart className="h-4 w-4 text-primary" />
                  Tranzacții pe zi (UTC)
                </CardTitle>
                <CardDescription className="text-xs">
                  Volum zilnic în fereastra de {data.rangeDays} zile; PnL însumat pe fișă (live vs paper).
                </CardDescription>
              </CardHeader>
              <CardContent>
                {data.tradesByDay.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nu există tranzacții în perioadă.</p>
                ) : (
                  <HorizontalBars
                    rows={data.tradesByDay.map((d) => ({
                      label: d.date,
                      value: d.count,
                    }))}
                    labelKey="label"
                    valueKey="value"
                  />
                )}
                {data.tradesByDay.length > 0 && (
                  <div className="mt-4 space-y-2 border-t border-white/[0.06] pt-4 text-[11px] text-muted-foreground">
                    {data.tradesByDay.slice(-5).map((d) => (
                      <div key={d.date} className="flex justify-between gap-2 font-mono">
                        <span>{d.date}</span>
                        <span>
                          PnL live {d.pnlLiveSum.toFixed(2)} · paper {d.pnlPaperSum.toFixed(2)} · eșuate{" "}
                          {d.failed}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-white/[0.08] bg-card/40 backdrop-blur-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 font-display text-base">
                  <Users className="h-4 w-4 text-accent" />
                  Înregistrări utilizatori (UTC)
                </CardTitle>
                <CardDescription className="text-xs">Conturi noi pe zi în aceeași fereastră.</CardDescription>
              </CardHeader>
              <CardContent>
                {data.usersByDay.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Fără înregistrări în perioadă.</p>
                ) : (
                  <HorizontalBars
                    rows={data.usersByDay.map((d) => ({ label: d.date, value: d.count }))}
                    labelKey="label"
                    valueKey="value"
                  />
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="border-white/[0.08] bg-card/40 backdrop-blur-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 font-display text-base">
                  <BarChart3 className="h-4 w-4 text-cyan-400" />
                  Sursă ordin
                </CardTitle>
                <CardDescription className="text-xs">În fereastra de {data.rangeDays} zile.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {data.tradeSource.map((s) => (
                    <li key={s.source} className="flex justify-between gap-2 border-b border-white/[0.05] py-2 last:border-0">
                      <span>{SOURCE_RO[s.source] ?? s.source}</span>
                      <span className="font-mono tabular-nums text-muted-foreground">{s.count}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-xs">
                  <p className="font-medium text-foreground">Paper vs real (perioadă)</p>
                  <p className="mt-1 text-muted-foreground">
                    Paper: <span className="font-mono text-foreground">{data.paperVsReal.paper}</span> · Real:{" "}
                    <span className="font-mono text-foreground">{data.paperVsReal.real}</span>
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-white/[0.08] bg-card/40 backdrop-blur-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 font-display text-base">
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                  Top perechi (perioadă)
                </CardTitle>
                <CardDescription className="text-xs">După număr de tranzacții înregistrate.</CardDescription>
              </CardHeader>
              <CardContent>
                <HorizontalBars rows={data.topPairs} labelKey="pair" valueKey="count" />
              </CardContent>
            </Card>

            <Card className="border-white/[0.08] bg-card/40 backdrop-blur-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 font-display text-base">
                  <Radio className="h-4 w-4 text-rose-400" />
                  Activitate 24h
                </CardTitle>
                <CardDescription className="text-xs">Perechile cele mai tranzacționate recent.</CardDescription>
              </CardHeader>
              <CardContent>
                {data.topPairs24h.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nicio tranzacție în ultimele 24h.</p>
                ) : (
                  <HorizontalBars rows={data.topPairs24h} labelKey="pair" valueKey="count" />
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="border-white/[0.08] bg-card/40 backdrop-blur-md">
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <CardTitle className="flex items-center gap-2 font-display text-base">
                  <Clock className="h-4 w-4 text-sky-400" />
                  Ultimele execuții cron (HTTP)
                </CardTitle>
                <CardDescription className="text-xs">
                  Log în Mongo la <span className="font-mono">/api/cron/*</span>. Se păstrează automat doar{" "}
                  <strong className="text-foreground">ultimele 50</strong> rulări; detaliul JSON e rezumat (nu
                  răspuns integral).
                </CardDescription>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={loading || cleaningCron}
                className="shrink-0 border-rose-500/40 text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
                onClick={() => void cleanAllCronLogs()}
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                {cleaningCron ? "Se șterge…" : "Curăță cron"}
              </Button>
            </CardHeader>
            <CardContent>
              {cronLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {loading ? "Se încarcă…" : "Încă nu există înregistrări (după deploy, rulează un cron)."}
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-white/[0.06]">
                  <table className="w-full min-w-[640px] text-left text-xs">
                    <thead className="border-b border-white/[0.06] bg-white/[0.02] text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Job</th>
                        <th className="px-3 py-2 font-medium">Timp</th>
                        <th className="px-3 py-2 font-medium">Rezultat</th>
                        <th className="px-3 py-2 font-medium">Durată</th>
                        <th className="px-3 py-2 font-medium">Rezumat</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cronLogs.map((log) => (
                        <tr key={log.id} className="border-b border-white/[0.04] align-top last:border-0">
                          <td className="px-3 py-2 font-mono text-foreground">
                            {CRON_JOB_LABEL[log.job] ?? log.job}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                            {log.createdAt
                              ? new Date(log.createdAt).toLocaleString("ro-RO", {
                                  dateStyle: "short",
                                  timeStyle: "medium",
                                })
                              : "—"}
                          </td>
                          <td className="px-3 py-2">
                            {log.ok ? (
                              <Badge variant="outline" className="border-emerald-500/40 text-emerald-400">
                                OK
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="border-rose-500/40 text-rose-400">
                                Eroare
                              </Badge>
                            )}
                            {log.statusCode ? (
                              <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                                {log.statusCode}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 font-mono tabular-nums text-muted-foreground">
                            {typeof log.durationMs === "number" ? `${log.durationMs} ms` : "—"}
                          </td>
                          <td className="max-w-[280px] px-3 py-2">
                            <p className="text-foreground">
                              {cronRunSummaryLine(log.job, log.summary)}
                            </p>
                            {log.error ? (
                              <p className="mt-1 line-clamp-2 text-[11px] text-rose-400">{log.error}</p>
                            ) : null}
                            <details className="mt-1">
                              <summary className="cursor-pointer text-[10px] text-primary hover:underline">
                                Detaliu JSON
                              </summary>
                              <pre className="mt-2 max-h-40 overflow-auto rounded bg-black/30 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                                {JSON.stringify({ summary: log.summary, error: log.error || undefined }, null, 2)}
                              </pre>
                            </details>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-white/[0.08] bg-card/40 backdrop-blur-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 font-display text-base">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Calitate execuții (fereastră)
              </CardTitle>
              <CardDescription className="text-xs">
                Raport eșecuri vs tranzacții totale în ultimele {data.rangeDays} zile (UTC).
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-mono text-3xl tabular-nums text-foreground">{failRatePct}%</p>
                <p className="text-xs text-muted-foreground">Rată eșecuri declarate (status failed)</p>
              </div>
              <div className="text-sm text-muted-foreground">
                <p>
                  Tranzacții: <span className="font-mono text-foreground">{rel?.windowTrades ?? 0}</span>
                </p>
                <p>
                  Eșuate: <span className="font-mono text-rose-400">{rel?.windowFailed ?? 0}</span>
                </p>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <p className="text-sm text-destructive">Nu s-au putut încărca datele.</p>
      )}
    </div>
  );
}

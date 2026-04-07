"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowLeftRight,
  Bot,
  Clock,
  FileCode2,
  Filter,
  RefreshCw,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const KIND_FILTERS = [
  { id: "all", label: "Toate" },
  { id: "registration", label: "Înregistrări" },
  { id: "trade", label: "Tranzacții" },
  { id: "bot", label: "Boți" },
  { id: "strategy", label: "Strategii" },
  { id: "follow", label: "Copy" },
  { id: "cron", label: "Cron" },
];

const KIND_ICON = {
  registration: UserPlus,
  trade: ArrowLeftRight,
  bot: Bot,
  strategy: FileCode2,
  follow: UsersRound,
  cron: Clock,
};

const KIND_ACCENT = {
  registration: "text-sky-400",
  trade: "text-emerald-400",
  bot: "text-violet-400",
  strategy: "text-amber-400",
  follow: "text-cyan-400",
  cron: "text-rose-300",
};

const KIND_BADGE = {
  registration: "border-sky-500/35 text-sky-300",
  trade: "border-emerald-500/35 text-emerald-300",
  bot: "border-violet-500/35 text-violet-300",
  strategy: "border-amber-500/35 text-amber-200",
  follow: "border-cyan-500/35 text-cyan-200",
  cron: "border-rose-500/35 text-rose-200",
};

export default function AdminActivityPage() {
  const [events, setEvents] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/activity?limit=100");
      const j = await r.json();
      if (!r.ok) {
        toast.error(typeof j.error === "string" ? j.error : "Eroare activitate");
        setEvents([]);
        setMeta(null);
        return;
      }
      setEvents(Array.isArray(j.events) ? j.events : []);
      setMeta({ generatedAt: j.generatedAt, limits: j.limits });
    } catch {
      toast.error("Rețea sau server");
      setEvents([]);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === "all") return events;
    return events.filter((e) => e.kind === filter);
  }, [events, filter]);

  const counts = useMemo(() => {
    const c = { all: events.length };
    for (const e of events) {
      c[e.kind] = (c[e.kind] || 0) + 1;
    }
    return c;
  }, [events]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <PageHeader
          title="Activitate"
          description="Flux cronologic recent: înregistrări, tranzacții, boți, strategii, copy trading și job-uri cron — agregat din Mongo (fără log de acces HTTP)."
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

      {meta?.generatedAt ? (
        <p className="text-[11px] text-muted-foreground">
          Generat{" "}
          {new Date(meta.generatedAt).toLocaleString("ro-RO", { dateStyle: "medium", timeStyle: "medium" })}
          {meta.limits?.mergedCap ? (
            <>
              {" "}
              · maxim <span className="font-mono text-foreground">{meta.limits.mergedCap}</span> evenimente
              după sortare
            </>
          ) : null}
        </p>
      ) : null}

      <Card className="border-white/[0.08] bg-card/40 backdrop-blur-md">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 font-display text-base">
            <Filter className="h-4 w-4 text-primary" />
            Filtru tip eveniment
          </CardTitle>
          <CardDescription className="text-xs">
            Numărul din paranteză = câte sunt în lotul curent (nu total istoric).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {KIND_FILTERS.map((f) => {
            const n = f.id === "all" ? counts.all : counts[f.id] || 0;
            const active = filter === f.id;
            return (
              <Button
                key={f.id}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                className={cn(
                  "h-8 rounded-full border-white/12 text-xs",
                  !active && "bg-transparent text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
                <span className="ml-1.5 font-mono tabular-nums opacity-70">({n})</span>
              </Button>
            );
          })}
        </CardContent>
      </Card>

      {loading && !events.length ? (
        <p className="text-sm text-muted-foreground">Se încarcă evenimentele…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {events.length === 0
            ? "Nu există evenimente sau nu ai permisiuni."
            : "Niciun eveniment pentru filtrul selectat."}
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((ev) => {
            const Icon = KIND_ICON[ev.kind] || Clock;
            const accent = KIND_ACCENT[ev.kind] || "text-muted-foreground";
            const badgeCls = KIND_BADGE[ev.kind] || "border-white/20";
            return (
              <li key={ev.id}>
                <Card className="border-white/[0.07] bg-gradient-to-br from-card/80 via-card/50 to-card/25 shadow-md shadow-black/20">
                  <CardContent className="flex gap-3 p-3 sm:gap-4 sm:p-4">
                    <div
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]",
                        accent
                      )}
                    >
                      <Icon className="h-5 w-5" strokeWidth={1.75} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">{ev.title}</span>
                        <Badge variant="outline" className={cn("text-[10px] font-normal", badgeCls)}>
                          {ev.kind}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground">
                          {ev.at
                            ? new Date(ev.at).toLocaleString("ro-RO", {
                                dateStyle: "short",
                                timeStyle: "medium",
                              })
                            : "—"}
                        </span>
                      </div>
                      <p className="mt-1 break-words text-sm leading-snug text-muted-foreground">{ev.detail}</p>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[11px] text-primary hover:underline">
                          Meta (JSON)
                        </summary>
                        <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-white/[0.06] bg-black/35 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                          {JSON.stringify(ev.meta ?? {}, null, 2)}
                        </pre>
                      </details>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

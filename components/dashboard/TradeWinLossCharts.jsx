"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";
import { toast } from "sonner";
const WIN = "rgb(52, 211, 153)";
const LOSS = "rgb(244, 63, 94)";
const NEU = "rgba(148, 163, 184, 0.85)";

/**
 * @param {{ buckets: { key: string, label: string, wins: number, losses: number, neutral: number, total: number }[], labelEvery: number }} props
 */
function StackedOutcomeBars({ buckets, labelEvery = 1 }) {
  if (!buckets?.length) {
    return (
      <div className="flex h-[220px] items-center justify-center text-xs text-muted-foreground">
        Fără tranzacții cu PnL în perioadă
      </div>
    );
  }

  const maxTotal = Math.max(1, ...buckets.map((b) => b.total));
  const n = buckets.length;
  const w = 100;
  const h = 56;
  const padB = 11;
  const padT = 6;
  const innerH = h - padB - padT;
  const slotW = w / n;
  const barW = Math.min(slotW * 0.72, n > 20 ? 2.2 : 3.5);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-[220px] w-full overflow-visible"
        preserveAspectRatio="none"
        role="img"
        aria-label="Grafic stack: tranzacții câștigătoare, pierzătoare și egale"
      >
        {[0, 0.5, 1].map((t) => {
          const yl = padT + innerH * t;
          return (
            <line
              key={t}
              x1="1"
              x2={w - 1}
              y1={yl}
              y2={yl}
              stroke="currentColor"
              strokeOpacity="0.06"
              strokeWidth="0.25"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {buckets.map((b, i) => {
          const cx = i * slotW + slotW / 2;
          const x0 = cx - barW / 2;
          const totalH = (b.total / maxTotal) * innerH;
          let yCursor = padT + innerH;
          const parts = [
            { c: b.losses, color: LOSS, name: "pierderi" },
            { c: b.neutral, color: NEU, name: "egal PnL" },
            { c: b.wins, color: WIN, name: "câștiguri" },
          ];
          const segs = [];
          for (const p of parts) {
            if (p.c <= 0) continue;
            const segH = (p.c / maxTotal) * innerH;
            yCursor -= segH;
            segs.push(
              <rect
                key={`${b.key}-${p.name}`}
                x={x0}
                y={yCursor}
                width={barW}
                height={Math.max(segH, 0.02)}
                fill={p.color}
                rx={0.15}
                className="transition-opacity hover:opacity-90"
              />
            );
          }
          const tip = `${b.labelFull ?? b.label}: ${b.wins} câștig, ${b.losses} pierdere, ${b.neutral} egal (${b.total} total)`;
          return (
            <g key={b.key}>
              <title>{tip}</title>
              {segs.length ? (
                segs
              ) : (
                <rect
                  x={x0}
                  y={padT + innerH - totalH}
                  width={barW}
                  height={0.12}
                  fill="currentColor"
                  fillOpacity="0.12"
                />
              )}
            </g>
          );
        })}
      </svg>
      <div
        className="pointer-events-none flex justify-between gap-0.5 px-0.5 text-[8px] leading-none text-muted-foreground"
        style={{ marginTop: -6 }}
      >
        {buckets.map((b, i) => (
          <span
            key={`${b.key}-lx`}
            className="block min-w-0 flex-1 truncate text-center"
            title={b.labelFull ?? b.label}
          >
            {i % labelEvery === 0 || i === n - 1 ? b.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

export function TradeWinLossCharts() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/dashboard/trade-outcomes");
        const j = await r.json();
        if (!r.ok) {
          throw new Error(typeof j.error === "string" ? j.error : "Eroare");
        }
        if (!cancelled) setData(j);
      } catch (e) {
        if (!cancelled) {
          toast.error(e instanceof Error ? e.message : "Statistici tranzacții");
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        {[1, 2].map((k) => (
          <Card key={k} className="border-white/[0.08] bg-card/40 backdrop-blur-md">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">Se încarcă…</CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const daily = data?.daily?.buckets ?? [];
  const monthly = data?.monthly?.buckets ?? [];
  const dayLabelEvery = daily.length > 18 ? 5 : 2;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="overflow-hidden border-white/[0.08] bg-gradient-to-br from-card/85 via-card/50 to-card/25 shadow-lg shadow-black/20 backdrop-blur-xl">
        <CardHeader className="border-b border-white/[0.06] pb-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-emerald-400/95" strokeWidth={1.75} />
            <CardTitle className="font-display text-base">Ultimele 30 zile (UTC)</CardTitle>
          </div>
          <CardDescription className="text-xs leading-relaxed">
            Număr de tranzacții <span className="font-medium text-foreground">live</span> pe zi:{" "}
            <span className="text-emerald-400/90">câștig</span>,{" "}
            <span className="text-rose-400/90">pierdere</span>,{" "}
            <span className="text-muted-foreground">egal (PnL 0)</span> — stack pe fiecare coloană.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <StackedOutcomeBars buckets={daily} labelEvery={dayLabelEvery} />
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm" style={{ background: WIN }} />
              Câștig
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm" style={{ background: LOSS }} />
              Pierdere
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm" style={{ background: NEU }} />
              Egal
            </span>
          </div>
          <p className="mt-2 text-[10px] leading-snug text-muted-foreground">{data?.disclaimer}</p>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-white/[0.08] bg-gradient-to-br from-card/85 via-card/50 to-card/25 shadow-lg shadow-black/20 backdrop-blur-xl">
        <CardHeader className="border-b border-white/[0.06] pb-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-sky-400/95" strokeWidth={1.75} />
            <CardTitle className="font-display text-base">Ultimele 12 luni (UTC)</CardTitle>
          </div>
          <CardDescription className="text-xs leading-relaxed">
            Aceeași logică, agregată lunar. Treci cu mouse-ul peste coloane pentru detaliu (tooltip nativ).
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <StackedOutcomeBars buckets={monthly} labelEvery={1} />
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm" style={{ background: WIN }} />
              Câștig
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm" style={{ background: LOSS }} />
              Pierdere
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm" style={{ background: NEU }} />
              Egal
            </span>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">{data?.timezoneNote}</p>
        </CardContent>
      </Card>
    </div>
  );
}

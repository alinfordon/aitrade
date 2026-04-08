"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";

const CHART_H = 200;
const CHART_PAD = { t: 16, r: 12, b: 28, l: 44 };

function CumulativeAreaChart({ points, accent = "emerald" }) {
  const gradId = useId().replace(/:/g, "");
  if (!points?.length) {
    return (
      <div className="flex h-[200px] items-center justify-center text-xs text-muted-foreground">
        Fără date în perioadă
      </div>
    );
  }

  const values = points.map((p) => Number(p.cumulative));
  const minV = Math.min(0, ...values);
  const maxV = Math.max(0, ...values);
  const span = maxV - minV || 1;
  const w = 100;
  const h = 100;
  const padT = (CHART_PAD.t / CHART_H) * 100;
  const padB = (CHART_PAD.b / CHART_H) * 100;
  const innerH = 100 - padT - padB;

  const pts = points.map((p, i) => {
    const x = points.length <= 1 ? 50 : (i / (points.length - 1)) * (w - 8) + 4;
    const v = Number(p.cumulative);
    const yn = (v - minV) / span;
    const y = padT + innerH * (1 - yn);
    return { x, y, v };
  });

  let lineD = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  if (pts.length === 1) {
    const p = pts[0];
    lineD = `M ${p.x - 3} ${p.y} L ${p.x + 3} ${p.y}`;
  }
  const lastPt = pts[pts.length - 1];
  const firstPt = pts[0];
  const areaD = `${lineD} L ${lastPt.x} ${padT + innerH} L ${firstPt.x} ${padT + innerH} Z`;

  const stroke =
    accent === "rose"
      ? "rgb(244, 63, 94)"
      : accent === "sky"
        ? "rgb(56, 189, 248)"
        : "rgb(52, 211, 153)";
  const fillStop2 =
    accent === "rose"
      ? "rgba(244, 63, 94, 0.08)"
      : accent === "sky"
        ? "rgba(56, 189, 248, 0.08)"
        : "rgba(52, 211, 153, 0.12)";

  const last = values[values.length - 1];
  const first = values[0];
  const up = last >= first;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-[200px] w-full overflow-visible"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id={`a-${gradId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fillStop2} />
            <stop offset="100%" stopColor="transparent" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const yl = padT + innerH * t;
          return (
            <line
              key={t}
              x1="4"
              x2={w - 4}
              y1={yl}
              y2={yl}
              stroke="currentColor"
              strokeOpacity="0.06"
              strokeWidth="0.35"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        <path d={areaD} fill={`url(#a-${gradId})`} className="opacity-90" />
        <path
          d={lineD}
          fill="none"
          stroke={stroke}
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="1.4" fill={stroke} className="opacity-90" />
        ))}
      </svg>
      <div className="pointer-events-none absolute left-0 top-0 flex h-8 items-center gap-1.5 px-1 text-[10px] font-medium">
        {up ? (
          <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
        ) : (
          <TrendingDown className="h-3.5 w-3.5 text-rose-400" />
        )}
        <span className={last >= 0 ? "text-emerald-400" : "text-rose-400"}>
          {last >= 0 ? "+" : ""}
          {last.toFixed(2)} USDC
        </span>
        <span className="font-normal text-muted-foreground">închidere perioadă</span>
      </div>
    </div>
  );
}

export function UsdcEquityCharts() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/dashboard/equity-curve");
        const j = await r.json();
        if (!r.ok) {
          throw new Error(typeof j.error === "string" ? j.error : "Eroare");
        }
        if (!cancelled) setData(j);
      } catch (e) {
        if (!cancelled) {
          toast.error(e instanceof Error ? e.message : "Curbe PnL");
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

  const dayAccent = useMemo(() => {
    const v = data?.day?.finalCumulative ?? 0;
    return v < 0 ? "rose" : "emerald";
  }, [data]);

  const monthAccent = useMemo(() => {
    const v = data?.month?.finalCumulative ?? 0;
    return v < 0 ? "rose" : "sky";
  }, [data]);

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

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="overflow-hidden border-white/[0.08] bg-gradient-to-br from-card/85 via-card/50 to-card/25 shadow-lg shadow-black/20 backdrop-blur-xl">
        <CardHeader className="border-b border-white/[0.06] pb-3">
          <div className="flex items-center gap-2">
            <LineChart className="h-4 w-4 text-emerald-400" strokeWidth={1.75} />
            <CardTitle className="font-display text-base">Azi (UTC) — PnL cumulat</CardTitle>
          </div>
          <CardDescription className="text-xs leading-relaxed">
            Oră cu oră, tranzacții <span className="font-medium text-foreground">live</span> · același interval ca
            „PnL azi” din dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <CumulativeAreaChart points={data?.day?.points} accent={dayAccent} />
          <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
            {data?.disclaimer}
          </p>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-white/[0.08] bg-gradient-to-br from-card/85 via-card/50 to-card/25 shadow-lg shadow-black/20 backdrop-blur-xl">
        <CardHeader className="border-b border-white/[0.06] pb-3">
          <div className="flex items-center gap-2">
            <LineChart className="h-4 w-4 text-sky-400" strokeWidth={1.75} />
            <CardTitle className="font-display text-base">Luna curentă (UTC) — PnL cumulat</CardTitle>
          </div>
          <CardDescription className="text-xs leading-relaxed">
            Zi cu zi din luna în curs, același mod de calcul (doar real / non-paper).
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <CumulativeAreaChart points={data?.month?.points} accent={monthAccent} />
          <p className="mt-1 text-[10px] text-muted-foreground">{data?.timezoneNote}</p>
        </CardContent>
      </Card>
    </div>
  );
}

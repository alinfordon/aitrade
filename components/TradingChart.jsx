"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, CandlestickSeries } from "lightweight-charts";

async function waitForChartSeries(chartRef, maxFrames = 8) {
  for (let i = 0; i < maxFrames; i++) {
    if (chartRef.current?.series) return chartRef.current;
    await new Promise((r) => requestAnimationFrame(r));
  }
  return chartRef.current;
}

export function TradingChart({ symbol, timeframe, spotOnly = false }) {
  const ref = useRef(null);
  const chartRef = useRef(null);
  const [loadError, setLoadError] = useState(null);
  const [dataNotice, setDataNotice] = useState(null);

  useEffect(() => {
    if (!ref.current) return;

    const chart = createChart(ref.current, {
      layout: {
        background: { type: "solid", color: "#0c111d" },
        textColor: "#9ca3af",
      },
      grid: {
        vertLines: { color: "rgba(55, 65, 81, 0.35)" },
        horzLines: { color: "rgba(55, 65, 81, 0.35)" },
      },
      rightPriceScale: { borderColor: "#374151" },
      timeScale: { borderColor: "#374151", timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: "rgba(16, 185, 129, 0.35)" }, horzLine: { color: "rgba(16, 185, 129, 0.35)" } },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#f87171",
      borderVisible: false,
      wickUpColor: "#10b981",
      wickDownColor: "#f87171",
    });

    chartRef.current = { chart, series };

    const ro = new ResizeObserver(() => {
      if (!ref.current) return;
      chart.applyOptions({ width: ref.current.clientWidth, height: ref.current.clientHeight });
    });
    ro.observe(ref.current);
    chart.applyOptions({ width: ref.current.clientWidth, height: ref.current.clientHeight });

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setDataNotice(null);

    (async () => {
      const cur = await waitForChartSeries(chartRef);
      if (!cur?.series || cancelled) return;

      try {
        const u = new URLSearchParams({ symbol, timeframe, limit: "500" });
        const res = await fetch(`/api/market/ohlcv?${u}`);
        const j = await res.json();
        if (cancelled || !cur.series) return;

        if (!res.ok || j.error) {
          cur.series.setData([]);
          const msg =
            typeof j.error === "string"
              ? j.error
              : j.error?.message
                ? String(j.error.message)
                : j.error
                  ? String(j.error)
                  : `Eroare ${res.status}`;
          setLoadError(msg || "Nu s-au putut încărca datele.");
          setDataNotice(null);
          return;
        }
        if (!j.candles?.length) {
          cur.series.setData([]);
          setDataNotice(null);
          setLoadError(
            "Nu există lumânări pentru această pereche pe Binance (spot USDC sau perpetual liniar USDT-M)."
          );
          return;
        }

        const data = j.candles.map((c) => ({
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }));
        setLoadError(null);
        setDataNotice(
          j.dataSource === "linear_perp"
            ? "Date: contract perpetual USDT-M (Binance). Activul nu are pereche spot USDC listată — prețurile pot diferi față de spot."
            : null
        );
        cur.series.setData(data);
        cur.chart.timeScale().fitContent();
      } catch {
        if (!cancelled) {
          setLoadError("Eroare rețea la încărcarea graficului.");
          setDataNotice(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [symbol, timeframe, spotOnly]);

  return (
    <div className="relative h-[420px] w-full min-h-[320px]">
      {dataNotice && (
        <p className="pointer-events-none absolute left-2 right-2 top-2 z-10 rounded-md bg-amber-950/90 px-2 py-1.5 text-center text-[11px] leading-snug text-amber-100/95 ring-1 ring-amber-700/50">
          {dataNotice}
        </p>
      )}
      <div ref={ref} className="h-full w-full rounded-lg border border-border bg-[#0c111d]" />
      {loadError && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-[#0c111d]/85 px-4 text-center">
          <p className="max-w-md text-sm text-amber-200/95">{loadError}</p>
        </div>
      )}
    </div>
  );
}

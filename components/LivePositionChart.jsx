"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, CandlestickSeries } from "lightweight-charts";

async function waitSeries(chartRef, maxFrames = 8) {
  for (let i = 0; i < maxFrames; i++) {
    if (chartRef.current?.series) return chartRef.current;
    await new Promise((r) => requestAnimationFrame(r));
  }
  return chartRef.current;
}

/**
 * Grafic lumânări + linii intrare / stop loss / take profit (manual).
 */
export function LivePositionChart({
  symbol,
  timeframe = "15m",
  avgEntry = 0,
  stopLoss = null,
  takeProfit = null,
  spotOnly = true,
  showProtectionLines = true,
}) {
  const ref = useRef(null);
  const chartRef = useRef(null);
  const priceLinesRef = useRef([]);
  const [loadError, setLoadError] = useState(null);

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
      crosshair: {
        vertLine: { color: "rgba(16, 185, 129, 0.35)" },
        horzLine: { color: "rgba(16, 185, 129, 0.35)" },
      },
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
    (async () => {
      const cur = await waitSeries(chartRef);
      if (!cur?.series || cancelled) return;

      for (const pl of priceLinesRef.current) {
        try {
          cur.series.removePriceLine(pl);
        } catch {
          /* ignore */
        }
      }
      priceLinesRef.current = [];

      const ae = Number(avgEntry);
      if (Number.isFinite(ae) && ae > 0) {
        priceLinesRef.current.push(
          cur.series.createPriceLine({
            price: ae,
            color: "#38bdf8",
            lineWidth: 2,
            lineStyle: 2,
            axisLabelVisible: true,
            title: "Medie",
          })
        );
      }

      if (showProtectionLines) {
        const sl = stopLoss != null ? Number(stopLoss) : NaN;
        if (Number.isFinite(sl) && sl > 0) {
          priceLinesRef.current.push(
            cur.series.createPriceLine({
              price: sl,
              color: "#f87171",
              lineWidth: 2,
              axisLabelVisible: true,
              title: "Stop loss",
            })
          );
        }
        const tp = takeProfit != null ? Number(takeProfit) : NaN;
        if (Number.isFinite(tp) && tp > 0) {
          priceLinesRef.current.push(
            cur.series.createPriceLine({
              price: tp,
              color: "#a3e635",
              lineWidth: 2,
              axisLabelVisible: true,
              title: "Take profit",
            })
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol, avgEntry, stopLoss, takeProfit, showProtectionLines]);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);

    (async () => {
      const cur = await waitSeries(chartRef);
      if (!cur?.series || cancelled) return;

      try {
        const u = new URLSearchParams({ symbol, timeframe, limit: "500" });
        if (spotOnly) u.set("spotOnly", "1");
        const res = await fetch(`/api/market/ohlcv?${u}`);
        const j = await res.json();
        if (cancelled || !cur.series) return;

        if (!res.ok || j.error) {
          cur.series.setData([]);
          setLoadError(
            typeof j.error === "string" ? j.error : j.error ? String(j.error) : `Eroare ${res.status}`
          );
          return;
        }
        if (!j.candles?.length) {
          cur.series.setData([]);
          setLoadError("Nu există lumânări pentru această pereche.");
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
        cur.series.setData(data);
        cur.chart.timeScale().fitContent();
      } catch {
        if (!cancelled) setLoadError("Eroare rețea");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [symbol, timeframe, spotOnly]);

  return (
    <div className="relative h-[380px] w-full min-h-[280px]">
      <div ref={ref} className="h-full w-full rounded-lg border border-border bg-[#0c111d]" />
      {loadError && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-[#0c111d]/88 px-4 text-center">
          <p className="max-w-md text-sm text-amber-200/95">{loadError}</p>
        </div>
      )}
    </div>
  );
}

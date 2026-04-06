"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, CandlestickSeries, LineSeries, LineStyle } from "lightweight-charts";
import {
  mergeStrategyAndAiOverlaySpecs,
  candleRowsToClosesAndTimes,
  lineChunksForSpec,
} from "@/lib/chart-strategy-overlays";
import {
  binanceCombinedSpotLiveUrl,
  binanceCombinedUsdmLiveUrl,
  binanceSpotStreamSymbol,
  binanceUsdmStreamSymbolFromCcxtPair,
  parseBinanceCombinedMessage,
} from "@/lib/market/binance-public-ws";

/** Interval minim între actualizări ale ultimii bare din ticker (~20 fps). */
const TICKER_CANDLE_MS = 48;

async function waitForChartSeries(chartRef, maxFrames = 8) {
  for (let i = 0; i < maxFrames; i++) {
    if (chartRef.current?.series) return chartRef.current;
    await new Promise((r) => requestAnimationFrame(r));
  }
  return chartRef.current;
}

export function TradingChart({ symbol, timeframe, spotOnly = false, aiOverlaySpecs = null }) {
  const ref = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const wsRef = useRef(null);
  const reconnectRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const priceScaleRafRef = useRef(null);
  const lastTickerCandleMsRef = useRef(0);

  const [loadError, setLoadError] = useState(null);
  const [dataNotice, setDataNotice] = useState(null);
  /** După REST: sursa efectivă a lumânărilor — conectează WS spot sau USDT-M. */
  const [chartDataSource, setChartDataSource] = useState(null);
  const [candleRevision, setCandleRevision] = useState(0);
  const [wsError, setWsError] = useState(null);
  const strategyOverlaySeriesRef = useRef([]);

  useEffect(() => {
    if (!ref.current) return;

    const chart = createChart(ref.current, {
      layout: {
        background: { type: "solid", color: "#0c111d" },
        textColor: "#9ca3af",
      },
      localization: {
        priceFormatter: (price) =>
          price == null || !Number.isFinite(Number(price))
            ? ""
            : Number(price).toLocaleString(undefined, {
                minimumFractionDigits: 4,
                maximumFractionDigits: 4,
              }),
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
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      if (!ref.current) return;
      chart.applyOptions({ width: ref.current.clientWidth, height: ref.current.clientHeight });
    });
    ro.observe(ref.current);
    chart.applyOptions({ width: ref.current.clientWidth, height: ref.current.clientHeight });

    return () => {
      ro.disconnect();
      strategyOverlaySeriesRef.current = [];
      seriesRef.current = null;
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setDataNotice(null);
    setChartDataSource(null);

    (async () => {
      const cur = await waitForChartSeries(chartRef);
      if (!cur?.series || cancelled) return;

      try {
        const u = new URLSearchParams({ symbol, timeframe, limit: "500" });
        if (spotOnly) u.set("spotOnly", "1");
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
          setChartDataSource(null);
          return;
        }
        if (!j.candles?.length) {
          cur.series.setData([]);
          setDataNotice(null);
          setLoadError(
            "Nu există lumânări pentru această pereche pe Binance (spot USDC sau perpetual liniar USDT-M)."
          );
          setChartDataSource(null);
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
            ? j.spotUnavailable
              ? "Cerut spot USDC — perechea nu există pe spot. Afișăm perpetual USDT-M ca referință (prețuri pot diferi; WS live = USDT-M)."
              : "Date: contract perpetual USDT-M (Binance). Activul nu are pereche spot USDC listată — prețurile pot diferi față de spot. WS live = USDT-M."
            : null
        );
        cur.series.setData(data);
        cur.chart.timeScale().fitContent();
        setChartDataSource(j.dataSource === "linear_perp" ? "linear_perp" : "spot");
        setCandleRevision((n) => n + 1);
      } catch {
        if (!cancelled) {
          setLoadError("Eroare rețea la încărcarea graficului.");
          setDataNotice(null);
          setChartDataSource(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [symbol, timeframe, spotOnly]);

  /** WebSocket: kline + ticker (spot sau USDT-M, aliniat cu REST). */
  useEffect(() => {
    const ser = seriesRef.current;
    if (ser == null || loadError || !chartDataSource) return;

    let streamKey = "";
    let wsUrl = "";
    if (chartDataSource === "linear_perp") {
      streamKey = binanceUsdmStreamSymbolFromCcxtPair(symbol);
      if (!streamKey) return;
      wsUrl = binanceCombinedUsdmLiveUrl(streamKey, timeframe);
    } else {
      streamKey = binanceSpotStreamSymbol(symbol);
      if (!streamKey) return;
      wsUrl = binanceCombinedSpotLiveUrl(streamKey, timeframe);
    }

    let closed = false;
    const connect = () => {
      if (closed) return;
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          /* ignore */
        }
        wsRef.current = null;
      }

      setWsError(null);

      let ws;
      try {
        ws = new WebSocket(wsUrl);
      } catch (e) {
        setWsError(String(e?.message || e));
        return;
      }

      wsRef.current = ws;

      ws.onopen = () => {
        if (closed) return;
        reconnectRef.current = 0;
        setWsError(null);
      };

      ws.onmessage = (ev) => {
        if (closed) return;
        const candleSer = seriesRef.current;
        if (!candleSer) return;
        const msg = parseBinanceCombinedMessage(ev.data);
        if (!msg?.data) return;

        const nudgePriceScale = () => {
          if (priceScaleRafRef.current != null) return;
          priceScaleRafRef.current = requestAnimationFrame(() => {
            priceScaleRafRef.current = null;
            const sScale = seriesRef.current;
            if (!sScale) return;
            try {
              sScale.priceScale().applyOptions({ autoScale: true });
            } catch {
              /* ignore */
            }
          });
        };

        const d = msg.data;
        if (d.e === "kline" && d.k) {
          const k = d.k;
          const time = Math.floor(Number(k.t) / 1000);
          const bar = {
            time,
            open: Number(k.o),
            high: Number(k.h),
            low: Number(k.l),
            close: Number(k.c),
          };
          try {
            candleSer.update(bar);
            nudgePriceScale();
          } catch {
            try {
              const rows = candleSer.data();
              if (!rows?.length) return;
              const last = rows[rows.length - 1];
              const lt = Math.floor(Number(last.time));
              if (lt === time) {
                candleSer.update({ ...bar, time: lt });
                nudgePriceScale();
              } else if (time > lt) {
                candleSer.update(bar);
                nudgePriceScale();
              }
            } catch {
              /* incompatibil */
            }
          }
        } else if (d.e === "24hrTicker" && d.c != null) {
          const px = Number(d.c);
          if (!Number.isFinite(px) || px <= 0) return;

          const now = Date.now();
          if (now - lastTickerCandleMsRef.current < TICKER_CANDLE_MS) return;
          lastTickerCandleMsRef.current = now;

          try {
            const rows = candleSer.data();
            if (!rows?.length) return;
            const last = rows[rows.length - 1];
            const t = last.time;
            const o = Number(last.open);
            const h = Number(last.high);
            const l = Number(last.low);
            candleSer.update({
              time: t,
              open: o,
              high: Math.max(h, px),
              low: Math.min(l, px),
              close: px,
            });
            nudgePriceScale();
          } catch {
            /* ignore */
          }
        }
      };

      ws.onerror = () => {
        if (!closed) setWsError("Eroare socket");
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (closed) return;
        const n = reconnectRef.current + 1;
        reconnectRef.current = n;
        const delay = Math.min(30_000, 800 * 2 ** Math.min(n, 6));
        reconnectTimerRef.current = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closed = true;
      if (priceScaleRafRef.current != null) {
        cancelAnimationFrame(priceScaleRafRef.current);
        priceScaleRafRef.current = null;
      }
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          /* ignore */
        }
        wsRef.current = null;
      }
    };
  }, [symbol, timeframe, loadError, chartDataSource]);

  /** Indicatori din analiza AI pre-tranzacție (linii preț). */
  useEffect(() => {
    const cur = chartRef.current;
    if (!cur?.chart || !cur?.series) return;
    const { chart, series: candleSeries } = cur;

    const clearOverlays = () => {
      for (const s of strategyOverlaySeriesRef.current) {
        try {
          chart.removeSeries(s);
        } catch {
          /* ignore */
        }
      }
      strategyOverlaySeriesRef.current = [];
    };

    const specs = mergeStrategyAndAiOverlaySpecs([], aiOverlaySpecs);
    if (!specs.length) {
      clearOverlays();
      return;
    }

    let rows;
    try {
      rows = candleSeries.data();
    } catch {
      return;
    }
    if (!rows?.length) {
      clearOverlays();
      return;
    }

    clearOverlays();
    const { closes, times } = candleRowsToClosesAndTimes(rows);

    for (const spec of specs) {
      const chunks = lineChunksForSpec(spec, closes, times);
      for (const ch of chunks) {
        if (ch.data.length < 2) continue;
        try {
          const ls = chart.addSeries(LineSeries, {
            color: ch.color,
            lineWidth: 1,
            lineStyle: ch.lineStyle === 2 ? LineStyle.Dashed : LineStyle.Solid,
            lastValueVisible: true,
            priceLineVisible: false,
            title: ch.title,
          });
          ls.setData(ch.data);
          strategyOverlaySeriesRef.current.push(ls);
        } catch {
          /* ignore */
        }
      }
    }
  }, [aiOverlaySpecs, candleRevision, symbol, timeframe]);

  const footnoteParts = [];
  if (Array.isArray(aiOverlaySpecs) && aiOverlaySpecs.length > 0) {
    footnoteParts.push("Liniile: indicatori AI (EMA/SMA/Bollinger).");
  }
  if (chartDataSource && !loadError) {
    footnoteParts.push(
      chartDataSource === "linear_perp"
        ? "Actualizare live: WebSocket Binance USD-M (USDT)."
        : "Actualizare live: WebSocket Binance Spot."
    );
  }

  const wsBadge =
    !chartDataSource || loadError ? null : wsError != null ? (
      <span className="text-red-400">WS: {wsError}</span>
    ) : (
      <span className="text-emerald-400/90">
        Live · {chartDataSource === "linear_perp" ? "Binance USD-M" : "Binance Spot"}
      </span>
    );

  return (
    <div className="space-y-1">
      {wsBadge ? (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">{wsBadge}</div>
      ) : null}
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
      {footnoteParts.length > 0 ? (
        <p className="text-[11px] text-muted-foreground">{footnoteParts.join(" ")}</p>
      ) : null}
    </div>
  );
}

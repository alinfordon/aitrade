"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, CandlestickSeries, LineSeries, LineStyle } from "lightweight-charts";
import {
  rulesFromStrategyDefinition,
  buildStrategyOverlaySpecs,
  candleRowsToClosesAndTimes,
  lineChunksForSpec,
  mergeStrategyAndAiOverlaySpecs,
} from "@/lib/chart-strategy-overlays";
import {
  binanceCombinedSpotLiveUrl,
  binanceSpotStreamSymbol,
  parseBinanceCombinedMessage,
} from "@/lib/market/binance-public-ws";

const LINE_HIT_PX = 14;
const DRAG_COMMIT_PX = 2;
/** Toleranțe hit-test pentru liniile de trend (în pixeli). */
const TREND_ENDPOINT_HIT_PX = 10;
const TREND_SEGMENT_HIT_PX = 6;

/** Distanță point-segment în spațiu ecran (pixeli). */
function distToSegmentPx(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}
/** Interval minim între actualizări de lumânare din ticker (~20 fps). */
const TICKER_CANDLE_MS = 48;

/**
 * Grafic live Binance Spot: istoric REST, actualizare WebSocket (klines + ticker).
 * SL/TP: click cu mod activ, sau trage liniile existente.
 */
export function LiveBinanceChart({
  symbol,
  timeframe = "15m",
  avgEntry = 0,
  stopLoss = null,
  takeProfit = null,
  spotOnly = true,
  showProtectionLines = true,
  /** Manual: liniile SL/TP sunt editabile; bot: doar afișare după procente / strategie. */
  protectionReadOnly = false,
  /** Strategie bot: desenează EMA/SMA/Bollinger din reguli (dacă există în definition). */
  strategyDefinition = null,
  /** Manual + analiză AI: linii EMA/SMA/Bollinger din `chartOverlaySpecs` (server). */
  aiOverlaySpecs = null,
  /** Manual: indicatori aleși de user pentru orientare vizuală (EMA/SMA/BB). */
  userIndicatorSpecs = null,
  /** Linii de trend manuale: [{ id, p1:{time,price}, p2:{time,price}, color? }]. */
  trendLines = null,
  /** Mod de plasare SL / TP ("sl" | "tp") sau desenare ("trend"). */
  placementMode = null,
  drawingMode = null,
  onPlacementConsumed,
  onProtectCommit,
  onTrendPointPicked,
  /** Commit final după drag: { id, p1, p2 }. */
  onTrendLineUpdate,
  onTickerPrice,
  onWsStatus,
}) {
  const wrapRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const entryLineRef = useRef(null);
  const slLineRef = useRef(null);
  const tpLineRef = useRef(null);
  const wsRef = useRef(null);
  const reconnectRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const priceScaleRafRef = useRef(null);
  const lastTickerCandleMsRef = useRef(0);

  const placementModeRef = useRef(placementMode);
  const drawingModeRef = useRef(drawingMode);
  const onTrendPointPickedRef = useRef(onTrendPointPicked);
  const onTrendLineUpdateRef = useRef(onTrendLineUpdate);
  const trendLineSeriesRef = useRef(new Map());
  const trendLinesRef = useRef(Array.isArray(trendLines) ? trendLines : []);
  const draggingRef = useRef(null);
  const dragStartYRef = useRef(0);
  const dragLastPriceRef = useRef(null);
  const slPriceRef = useRef(stopLoss);
  const tpPriceRef = useRef(takeProfit);

  const clickHandlerRef = useRef(null);
  /** Evită dublarea commit la sfârșitul drag (subscribeClick). */
  const suppressClickUntilRef = useRef(0);
  const onProtectCommitRef = useRef(onProtectCommit);
  const onPlacementConsumedRef = useRef(onPlacementConsumed);
  const onTickerRef = useRef(onTickerPrice);
  const onWsStatusRef = useRef(onWsStatus);

  /**
   * Niveluri incluse în autoscale — actualizate doar în efectul liniilor, ca să coincidă mereu cu liniile create.
   * Altfel, la fiecare `update` de lumânare, scala se poate restrânge și marcajele par că „dispar”.
   */
  const protectionScaleRef = useRef([]);

  const [loadError, setLoadError] = useState(null);
  /** Forțează refacerea liniilor după drag (altfel efectul putea să nu mai ruleze). */
  const [lineLayoutTick, setLineLayoutTick] = useState(0);
  /** După încărcare REST a lumânărilor — recalculează overlay-urile strategiei. */
  const [candleRevision, setCandleRevision] = useState(0);
  const strategyOverlaySeriesRef = useRef([]);

  useEffect(() => {
    onProtectCommitRef.current = onProtectCommit;
  }, [onProtectCommit]);
  useEffect(() => {
    onPlacementConsumedRef.current = onPlacementConsumed;
  }, [onPlacementConsumed]);
  useEffect(() => {
    onTickerRef.current = onTickerPrice;
  }, [onTickerPrice]);
  useEffect(() => {
    onWsStatusRef.current = onWsStatus;
  }, [onWsStatus]);
  const [wsError, setWsError] = useState(null);

  useEffect(() => {
    placementModeRef.current = placementMode;
  }, [placementMode]);

  useEffect(() => {
    drawingModeRef.current = drawingMode;
  }, [drawingMode]);

  useEffect(() => {
    onTrendPointPickedRef.current = onTrendPointPicked;
  }, [onTrendPointPicked]);

  useEffect(() => {
    onTrendLineUpdateRef.current = onTrendLineUpdate;
  }, [onTrendLineUpdate]);

  useEffect(() => {
    trendLinesRef.current = Array.isArray(trendLines) ? trendLines : [];
  }, [trendLines]);

  useEffect(() => {
    slPriceRef.current = stopLoss;
  }, [stopLoss]);

  useEffect(() => {
    tpPriceRef.current = takeProfit;
  }, [takeProfit]);

  /** Inițializare chart */
  useEffect(() => {
    if (!wrapRef.current) return;

    const chart = createChart(wrapRef.current, {
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
      autoscaleInfoProvider: (original) => {
        const res = original();
        const extra = protectionScaleRef.current;
        if (!extra.length) return res;
        if (res === null) {
          const minP = Math.min(...extra);
          const maxP = Math.max(...extra);
          return { priceRange: { minValue: minP, maxValue: maxP } };
        }
        let minV = res.priceRange.minValue;
        let maxV = res.priceRange.maxValue;
        for (const p of extra) {
          minV = Math.min(minV, p);
          maxV = Math.max(maxV, p);
        }
        return { ...res, priceRange: { minValue: minV, maxValue: maxV } };
      },
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      if (!wrapRef.current) return;
      chart.applyOptions({ width: wrapRef.current.clientWidth, height: wrapRef.current.clientHeight });
    });
    ro.observe(wrapRef.current);
    chart.applyOptions({ width: wrapRef.current.clientWidth, height: wrapRef.current.clientHeight });

    return () => {
      ro.disconnect();
      strategyOverlaySeriesRef.current = [];
      trendLineSeriesRef.current = new Map();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      entryLineRef.current = null;
      slLineRef.current = null;
      tpLineRef.current = null;
    };
  }, []);

  /** Linii preț (intrare / SL / TP) */
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (draggingRef.current) return;

    const remove = (ref) => {
      if (ref.current) {
        try {
          series.removePriceLine(ref.current);
        } catch {
          /* ignore */
        }
        ref.current = null;
      }
    };
    remove(entryLineRef);
    remove(slLineRef);
    remove(tpLineRef);

    const scaleExtras = [];

    const ae = Number(avgEntry);
    if (Number.isFinite(ae) && ae > 0) {
      scaleExtras.push(ae);
      entryLineRef.current = series.createPriceLine({
        price: ae,
        color: "#38bdf8",
        lineWidth: 2,
        lineStyle: 2,
        lineVisible: true,
        axisLabelVisible: true,
        title: "Medie",
      });
    }

    if (showProtectionLines) {
      const sl = stopLoss != null ? Number(stopLoss) : NaN;
      if (Number.isFinite(sl) && sl > 0) {
        scaleExtras.push(sl);
        slLineRef.current = series.createPriceLine({
          price: sl,
          color: "#f87171",
          lineWidth: 2,
          lineVisible: true,
          axisLabelVisible: true,
          title: protectionReadOnly ? "Stop loss (bot %)" : "Stop loss",
        });
      }
      const tp = takeProfit != null ? Number(takeProfit) : NaN;
      if (Number.isFinite(tp) && tp > 0) {
        scaleExtras.push(tp);
        tpLineRef.current = series.createPriceLine({
          price: tp,
          color: "#a3e635",
          lineWidth: 2,
          lineVisible: true,
          axisLabelVisible: true,
          title: protectionReadOnly ? "Take profit (bot %)" : "Take profit",
        });
      }
    }

    protectionScaleRef.current = scaleExtras;

    try {
      series.priceScale().applyOptions({ autoScale: true });
    } catch {
      /* ignore */
    }
  }, [symbol, avgEntry, stopLoss, takeProfit, showProtectionLines, lineLayoutTick, protectionReadOnly]);

  /** REST: istoric lumânări */
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);

    (async () => {
      const chart = chartRef.current;
      const series = seriesRef.current;
      if (!chart || !series) return;

      try {
        const u = new URLSearchParams({ symbol, timeframe, limit: "500" });
        if (spotOnly) u.set("spotOnly", "1");
        const res = await fetch(`/api/market/ohlcv?${u}`);
        const j = await res.json();
        if (cancelled) return;

        if (!res.ok || j.error) {
          series.setData([]);
          setLoadError(
            typeof j.error === "string" ? j.error : j.error ? String(j.error) : `Eroare ${res.status}`
          );
          return;
        }
        if (!j.candles?.length) {
          series.setData([]);
          setLoadError("Nu există lumânări pentru această pereche.");
          return;
        }

        const data = j.candles.map((c) => ({
          time: Math.floor(Number(c.time)),
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close),
        }));
        setLoadError(null);
        series.setData(data);
        chart.timeScale().fitContent();
        try {
          series.priceScale().applyOptions({ autoScale: true });
        } catch {
          /* ignore */
        }
        setCandleRevision((n) => n + 1);
      } catch {
        if (!cancelled) setLoadError("Eroare rețea (istoric)");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [symbol, timeframe, spotOnly]);

  /** Linii indicator: strategie bot și/sau overlay-uri din analiza AI Live. */
  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = seriesRef.current;
    if (!chart || !candleSeries) return;

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

    const rules = strategyDefinition ? rulesFromStrategyDefinition(strategyDefinition) : [];
    const strategySpecs = buildStrategyOverlaySpecs(rules);
    const withAi = mergeStrategyAndAiOverlaySpecs(strategySpecs, aiOverlaySpecs);
    const specs = mergeStrategyAndAiOverlaySpecs(withAi, userIndicatorSpecs);
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
          /* serie incompatibilă */
        }
      }
    }
  }, [strategyDefinition, aiOverlaySpecs, userIndicatorSpecs, candleRevision, symbol, timeframe]);

  /** Linii de trend desenate manual (persistate în panou). */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const map = trendLineSeriesRef.current;

    const list = Array.isArray(trendLines) ? trendLines : [];
    const nextIds = new Set(list.map((t) => String(t.id)));

    for (const [id, s] of map.entries()) {
      if (!nextIds.has(id)) {
        try {
          chart.removeSeries(s);
        } catch {
          /* ignore */
        }
        map.delete(id);
      }
    }

    for (const t of list) {
      if (
        !t ||
        !t.p1 ||
        !t.p2 ||
        !Number.isFinite(Number(t.p1.time)) ||
        !Number.isFinite(Number(t.p2.time)) ||
        !Number.isFinite(Number(t.p1.price)) ||
        !Number.isFinite(Number(t.p2.price))
      ) {
        continue;
      }
      const id = String(t.id);
      const t1 = Math.floor(Number(t.p1.time));
      const t2 = Math.floor(Number(t.p2.time));
      const [a, b] =
        t1 <= t2
          ? [{ time: t1, value: Number(t.p1.price) }, { time: t2, value: Number(t.p2.price) }]
          : [{ time: t2, value: Number(t.p2.price) }, { time: t1, value: Number(t.p1.price) }];
      if (a.time === b.time) continue;

      const color = t.color || "#e0b3ff";
      let s = map.get(id);
      if (!s) {
        try {
          s = chart.addSeries(LineSeries, {
            color,
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            lastValueVisible: false,
            priceLineVisible: false,
            title: t.title || "Trend",
          });
          map.set(id, s);
        } catch {
          continue;
        }
      } else {
        try {
          s.applyOptions({ color, title: t.title || "Trend" });
        } catch {
          /* ignore */
        }
      }
      try {
        s.setData([a, b]);
      } catch {
        /* ignore */
      }
    }
  }, [trendLines]);

  /** WebSocket Binance: kline + ticker */
  useEffect(() => {
    if (seriesRef.current == null || loadError) return;

    const sym = binanceSpotStreamSymbol(symbol);
    if (!sym) return;

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

      onWsStatusRef.current?.("connecting");
      setWsError(null);

      const url = binanceCombinedSpotLiveUrl(sym, timeframe);
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        onWsStatusRef.current?.("error");
        setWsError(String(e?.message || e));
        return;
      }

      wsRef.current = ws;

      ws.onopen = () => {
        if (closed) return;
        reconnectRef.current = 0;
        onWsStatusRef.current?.("open");
      };

      ws.onmessage = (ev) => {
        if (closed) return;
        const ser = seriesRef.current;
        if (!ser) return;
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
            ser.update(bar);
            nudgePriceScale();
          } catch {
            try {
              const rows = ser.data();
              if (!rows?.length) return;
              const last = rows[rows.length - 1];
              const lt = Math.floor(Number(last.time));
              if (lt === time) {
                ser.update({ ...bar, time: lt });
                nudgePriceScale();
              } else if (time > lt) {
                ser.update(bar);
                nudgePriceScale();
              }
            } catch {
              /* kline incompatibil cu ultima bară REST */
            }
          }
        } else if (d.e === "24hrTicker" && d.c != null) {
          const px = Number(d.c);
          if (!Number.isFinite(px) || px <= 0) return;
          onTickerRef.current?.(px);

          const now = Date.now();
          if (now - lastTickerCandleMsRef.current < TICKER_CANDLE_MS) return;
          lastTickerCandleMsRef.current = now;

          try {
            const rows = ser.data();
            if (!rows?.length) return;
            const last = rows[rows.length - 1];
            const t = last.time;
            const o = Number(last.open);
            const h = Number(last.high);
            const l = Number(last.low);
            ser.update({
              time: t,
              open: o,
              high: Math.max(h, px),
              low: Math.min(l, px),
              close: px,
            });
            nudgePriceScale();
          } catch {
            /* încă nu e setDate sau serie goală */
          }
        }
      };

      ws.onerror = () => {
        if (!closed) {
          onWsStatusRef.current?.("error");
          setWsError("Eroare socket");
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (closed) return;
        onWsStatusRef.current?.("closed");
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
      onWsStatusRef.current?.("closed");
    };
  }, [symbol, timeframe, loadError]);

  /** Click pe grafic: plasează SL/TP când modul e activ sau alege puncte de trend */
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;

    const handler = (param) => {
      if (Date.now() < suppressClickUntilRef.current) return;
      if (!param.point) return;
      const price = series.coordinateToPrice(param.point.y);
      if (price == null || !Number.isFinite(Number(price))) return;

      /** Desenare linie de trend (prioritar). */
      if (drawingModeRef.current === "trend") {
        if (param.time == null) return;
        onTrendPointPickedRef.current?.({
          time: Math.floor(Number(param.time)),
          price: Number(price),
        });
        return;
      }

      /** Plasare SL / TP (doar manual). */
      if (!showProtectionLines || protectionReadOnly) return;
      const mode = placementModeRef.current;
      if (!mode) return;

      const payload =
        mode === "sl" ? { stopLoss: Number(price) } : { takeProfit: Number(price) };
      const p = onProtectCommitRef.current?.(payload);
      if (p != null && typeof p.then === "function") {
        p.then(() => onPlacementConsumedRef.current?.()).catch(() => {
          /* erori gestionate în panou */
        });
      } else {
        onPlacementConsumedRef.current?.();
      }
    };

    if (clickHandlerRef.current) {
      chart.unsubscribeClick(clickHandlerRef.current);
    }
    clickHandlerRef.current = handler;
    chart.subscribeClick(handler);

    return () => {
      if (clickHandlerRef.current) {
        chart.unsubscribeClick(clickHandlerRef.current);
        clickHandlerRef.current = null;
      }
    };
  }, [symbol, showProtectionLines, protectionReadOnly]);

  /** Trage liniile SL / TP și endpoints / segmentele liniilor de trend. */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const getSeries = () => seriesRef.current;

    const onPointerDown = (e) => {
      if (placementModeRef.current) return;
      if (drawingModeRef.current) return;
      const chart = chartRef.current;
      const s = getSeries();
      if (!chart || !s) return;

      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      /** Linii de trend: endpoint → întinde; segment → mută. */
      const ts = chart.timeScale();
      const lines = trendLinesRef.current || [];
      for (const t of lines) {
        if (
          !t ||
          !t.p1 ||
          !t.p2 ||
          !Number.isFinite(Number(t.p1.time)) ||
          !Number.isFinite(Number(t.p2.time)) ||
          !Number.isFinite(Number(t.p1.price)) ||
          !Number.isFinite(Number(t.p2.price))
        ) {
          continue;
        }
        let x1, x2, y1, y2;
        try {
          x1 = ts.timeToCoordinate(Number(t.p1.time));
          x2 = ts.timeToCoordinate(Number(t.p2.time));
          y1 = s.priceToCoordinate(Number(t.p1.price));
          y2 = s.priceToCoordinate(Number(t.p2.price));
        } catch {
          continue;
        }
        if (x1 == null || x2 == null || y1 == null || y2 == null) continue;

        if (Math.hypot(x - x1, y - y1) <= TREND_ENDPOINT_HIT_PX) {
          draggingRef.current = {
            kind: "trend-end",
            id: String(t.id),
            end: "p1",
            origP1: { time: Number(t.p1.time), price: Number(t.p1.price) },
            origP2: { time: Number(t.p2.time), price: Number(t.p2.price) },
          };
          dragStartYRef.current = y;
          el.setPointerCapture(e.pointerId);
          e.preventDefault();
          return;
        }
        if (Math.hypot(x - x2, y - y2) <= TREND_ENDPOINT_HIT_PX) {
          draggingRef.current = {
            kind: "trend-end",
            id: String(t.id),
            end: "p2",
            origP1: { time: Number(t.p1.time), price: Number(t.p1.price) },
            origP2: { time: Number(t.p2.time), price: Number(t.p2.price) },
          };
          dragStartYRef.current = y;
          el.setPointerCapture(e.pointerId);
          e.preventDefault();
          return;
        }
        if (distToSegmentPx(x, y, x1, y1, x2, y2) <= TREND_SEGMENT_HIT_PX) {
          const refTimeRaw = ts.coordinateToTime(x);
          const refTime = Number(refTimeRaw);
          const refPrice = Number(s.coordinateToPrice(y));
          if (Number.isFinite(refTime) && Number.isFinite(refPrice)) {
            draggingRef.current = {
              kind: "trend-move",
              id: String(t.id),
              refTime,
              refPrice,
              origP1: { time: Number(t.p1.time), price: Number(t.p1.price) },
              origP2: { time: Number(t.p2.time), price: Number(t.p2.price) },
            };
            dragStartYRef.current = y;
            el.setPointerCapture(e.pointerId);
            e.preventDefault();
            return;
          }
        }
      }

      /** SL / TP (doar manual, read-only = bot). */
      if (protectionReadOnly) return;

      const hitSl =
        slLineRef.current &&
        slPriceRef.current != null &&
        Number.isFinite(Number(slPriceRef.current));
      const hitTp =
        tpLineRef.current &&
        tpPriceRef.current != null &&
        Number.isFinite(Number(tpPriceRef.current));

      if (hitSl) {
        const cy = s.priceToCoordinate(Number(slPriceRef.current));
        if (cy != null && Math.abs(y - cy) <= LINE_HIT_PX) {
          draggingRef.current = "sl";
          dragStartYRef.current = y;
          dragLastPriceRef.current = Number(slPriceRef.current);
          el.setPointerCapture(e.pointerId);
          e.preventDefault();
          return;
        }
      }
      if (hitTp) {
        const cy = s.priceToCoordinate(Number(tpPriceRef.current));
        if (cy != null && Math.abs(y - cy) <= LINE_HIT_PX) {
          draggingRef.current = "tp";
          dragStartYRef.current = y;
          dragLastPriceRef.current = Number(tpPriceRef.current);
          el.setPointerCapture(e.pointerId);
          e.preventDefault();
        }
      }
    };

    const applyTrendDrag = (d, x, y) => {
      const chart = chartRef.current;
      const s = getSeries();
      if (!chart || !s) return;
      const ts = chart.timeScale();
      const newTimeRaw = ts.coordinateToTime(x);
      const newTime = Number(newTimeRaw);
      const newPrice = Number(s.coordinateToPrice(y));
      if (!Number.isFinite(newTime) || !Number.isFinite(newPrice)) return;

      let p1, p2;
      if (d.kind === "trend-end") {
        if (d.end === "p1") {
          p1 = { time: newTime, price: newPrice };
          p2 = d.origP2;
        } else {
          p1 = d.origP1;
          p2 = { time: newTime, price: newPrice };
        }
      } else {
        const dTime = newTime - d.refTime;
        const dPrice = newPrice - d.refPrice;
        p1 = { time: d.origP1.time + dTime, price: d.origP1.price + dPrice };
        p2 = { time: d.origP2.time + dTime, price: d.origP2.price + dPrice };
      }
      if (!p1 || !p2) return;
      const t1 = Math.floor(p1.time);
      const t2 = Math.floor(p2.time);
      if (!Number.isFinite(t1) || !Number.isFinite(t2) || t1 === t2) return;

      d.currentP1 = { time: t1, price: p1.price };
      d.currentP2 = { time: t2, price: p2.price };

      const series = trendLineSeriesRef.current.get(d.id);
      if (series) {
        const [a, b] =
          t1 <= t2
            ? [{ time: t1, value: p1.price }, { time: t2, value: p2.price }]
            : [{ time: t2, value: p2.price }, { time: t1, value: p1.price }];
        try {
          series.setData([a, b]);
        } catch {
          /* ignore */
        }
      }
    };

    const onPointerMove = (e) => {
      const d = draggingRef.current;
      if (!d) return;
      const s = getSeries();
      if (!s) return;

      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (typeof d === "object" && (d.kind === "trend-end" || d.kind === "trend-move")) {
        applyTrendDrag(d, x, y);
        return;
      }

      if (Math.abs(y - dragStartYRef.current) < DRAG_COMMIT_PX) return;

      const p = s.coordinateToPrice(y);
      if (p == null || !Number.isFinite(Number(p))) return;
      dragLastPriceRef.current = Number(p);

      if (d === "sl" && slLineRef.current) {
        slLineRef.current.applyOptions({ price: Number(p) });
      } else if (d === "tp" && tpLineRef.current) {
        tpLineRef.current.applyOptions({ price: Number(p) });
      }
    };

    const onPointerUp = (e) => {
      const d = draggingRef.current;
      draggingRef.current = null;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (!d) return;

      if (typeof d === "object" && (d.kind === "trend-end" || d.kind === "trend-move")) {
        suppressClickUntilRef.current = Date.now() + 350;
        const p1 = d.currentP1 || d.origP1;
        const p2 = d.currentP2 || d.origP2;
        if (
          p1 &&
          p2 &&
          Number.isFinite(Number(p1.time)) &&
          Number.isFinite(Number(p2.time)) &&
          Number(p1.time) !== Number(p2.time)
        ) {
          onTrendLineUpdateRef.current?.({
            id: d.id,
            p1: { time: Math.floor(Number(p1.time)), price: Number(p1.price) },
            p2: { time: Math.floor(Number(p2.time)), price: Number(p2.price) },
          });
        }
        return;
      }

      /* Refacere linii + autoscale după drag (efectul putea să sară în timpul draggingRef). */
      setLineLayoutTick((t) => t + 1);

      const rect = el.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const moved = Math.abs(y - dragStartYRef.current) >= DRAG_COMMIT_PX;
      if (!moved || dragLastPriceRef.current == null) return;

      suppressClickUntilRef.current = Date.now() + 450;
      if (d === "sl") {
        onProtectCommitRef.current?.({ stopLoss: dragLastPriceRef.current });
      } else if (d === "tp") {
        onProtectCommitRef.current?.({ takeProfit: dragLastPriceRef.current });
      }
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
    };
  }, [symbol, showProtectionLines, protectionReadOnly]);

  const wsBadge =
    wsError != null ? (
      <span className="text-red-400">WS: {wsError}</span>
    ) : (
      <span className="text-emerald-400/90">Live · Binance WebSocket</span>
    );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        {wsBadge}
        {drawingMode === "trend" ? (
          <span className="text-violet-200">Click pe două puncte pentru linia de trend</span>
        ) : placementMode ? (
          <span className="text-amber-200">
            Click pe grafic pentru {placementMode === "sl" ? "Stop loss" : "Take profit"}
          </span>
        ) : null}
      </div>
      <div ref={wrapRef} className="relative h-[380px] w-full min-h-[280px] cursor-crosshair rounded-lg border border-border bg-[#0c111d]">
        {loadError && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-[#0c111d]/88 px-4 text-center">
            <p className="max-w-md text-sm text-amber-200/95">{loadError}</p>
          </div>
        )}
      </div>
      {showProtectionLines && (
        <p className="text-[11px] text-muted-foreground">
          {protectionReadOnly
            ? "SL/TP la preț absolut din procentele setate la bot (față de intrare). Sub ele: liniile EMA/SMA/Bollinger din regulile strategiei (dacă sunt folosite). RSI/MACD nu sunt desenate pe graficul de preț."
            : Array.isArray(aiOverlaySpecs) && aiOverlaySpecs.length > 0
              ? "Trage liniile roșie (SL) sau verde deschis (TP). Pe fundal: EMA/SMA/Bollinger din ultima analiză AI (Generează analiză). REST pentru istoric, socket pentru lumânări și ticker."
              : "Trage liniile roșie (SL) sau verde deschis (TP). După „Generează analiză” în cardul AI, indicatorii aleși de model apar pe grafic. REST pentru istoric, socket pentru lumânări și preț ultim."}
        </p>
      )}
    </div>
  );
}

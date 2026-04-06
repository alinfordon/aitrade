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
  placementMode = null,
  onPlacementConsumed,
  onProtectCommit,
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
    const specs = mergeStrategyAndAiOverlaySpecs(strategySpecs, aiOverlaySpecs);
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
  }, [strategyDefinition, aiOverlaySpecs, candleRevision, symbol, timeframe]);

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

  /** Click pe grafic: plasează SL/TP când modul e activ */
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series || !showProtectionLines || protectionReadOnly) return;

    const handler = (param) => {
      if (Date.now() < suppressClickUntilRef.current) return;
      const mode = placementModeRef.current;
      if (!mode || !param.point) return;
      const price = series.coordinateToPrice(param.point.y);
      if (price == null || !Number.isFinite(Number(price))) return;

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

  /** Trage liniile SL / TP */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !showProtectionLines || protectionReadOnly) return;

    const getSeries = () => seriesRef.current;

    const onPointerDown = (e) => {
      if (placementModeRef.current) return;
      const s = getSeries();
      if (!s) return;

      const rect = el.getBoundingClientRect();
      const y = e.clientY - rect.top;

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

    const onPointerMove = (e) => {
      const kind = draggingRef.current;
      if (!kind) return;
      const s = getSeries();
      if (!s) return;

      const rect = el.getBoundingClientRect();
      const y = e.clientY - rect.top;
      if (Math.abs(y - dragStartYRef.current) < DRAG_COMMIT_PX) return;

      const p = s.coordinateToPrice(y);
      if (p == null || !Number.isFinite(Number(p))) return;
      dragLastPriceRef.current = Number(p);

      if (kind === "sl" && slLineRef.current) {
        slLineRef.current.applyOptions({ price: Number(p) });
      } else if (kind === "tp" && tpLineRef.current) {
        tpLineRef.current.applyOptions({ price: Number(p) });
      }
    };

    const onPointerUp = (e) => {
      const kind = draggingRef.current;
      draggingRef.current = null;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (!kind) return;

      /* Refacere linii + autoscale după drag (efectul putea să sară în timpul draggingRef). */
      setLineLayoutTick((t) => t + 1);

      const rect = el.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const moved =
        Math.abs(y - dragStartYRef.current) >= DRAG_COMMIT_PX;
      if (!moved || dragLastPriceRef.current == null) return;

      suppressClickUntilRef.current = Date.now() + 450;
      if (kind === "sl") {
        onProtectCommitRef.current?.({ stopLoss: dragLastPriceRef.current });
      } else if (kind === "tp") {
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
        {placementMode && (
          <span className="text-amber-200">
            Click pe grafic pentru {placementMode === "sl" ? "Stop loss" : "Take profit"}
          </span>
        )}
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

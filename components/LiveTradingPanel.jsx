"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { LiveBinanceChart } from "@/components/LiveBinanceChart";
import { useSpotWallet } from "@/components/SpotWalletProvider";
import { canUseLiveAiAnalysis } from "@/lib/plans";
import { summarizeStrategyDefinition } from "@/lib/strategy-human-summary";
import {
  ensureLivePositionsPolling,
  refreshLivePositionsFromServer,
  useLivePositions,
} from "@/lib/client/live-positions-store";

const TF_OPTIONS = ["15m", "1h", "4h"];

/** Indicatori pe care userul îi poate activa manual pentru orientare vizuală. */
const USER_INDICATOR_OPTIONS = [
  { id: "ema:20", kind: "ema", period: 20, label: "EMA 20" },
  { id: "ema:50", kind: "ema", period: 50, label: "EMA 50" },
  { id: "ema:200", kind: "ema", period: 200, label: "EMA 200" },
  { id: "sma:50", kind: "sma", period: 50, label: "SMA 50" },
  { id: "sma:200", kind: "sma", period: 200, label: "SMA 200" },
  { id: "bb:20:2", kind: "bb", period: 20, mult: 2, label: "Bollinger 20" },
];
const USER_INDICATOR_PALETTE = ["#a78bfa", "#fbbf24", "#22d3ee", "#f472b6", "#fb923c", "#4ade80"];

const STRATEGY_SOURCE_LABELS = {
  user: "Definită manual",
  optimized: "Optimizată (AI)",
  auto: "Generată AI Auto",
  marketplace: "Marketplace",
  pilot: "AI Pilot",
};

function fmtLastRun(iso) {
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

function fmtPnl(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const v = Number(n);
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(4)} USDC`;
}

/** Completează strategySummary din catalog /api/bots când lipsește din poziția Live. */
function enrichBotPositionRow(row, catalogBot) {
  if (!row || row.source !== "bot") return row;
  const hasSummary =
    row.strategySummary &&
    (row.strategySummary.entryLines?.length > 0 || row.strategySummary.exitLines?.length > 0);
  if (hasSummary) return row;
  const b = catalogBot || null;
  const strat = b?.strategyId && typeof b.strategyId === "object" ? b.strategyId : null;
  if (!strat) return row;
  return {
    ...row,
    strategyName: strat.name || row.strategyName,
    strategySource: strat.source ?? row.strategySource,
    strategySafeMode: Boolean(strat.safeMode),
    strategySummary: strat.definition
      ? summarizeStrategyDefinition(strat.definition)
      : row.strategySummary || { entryLines: [], exitLines: [] },
    botMode: b.mode ?? row.botMode,
    futuresEnabled: Boolean(b.futuresEnabled),
    lastRun: b.lastRun
      ? new Date(b.lastRun).toISOString()
      : row.lastRun ?? null,
    risk: b.risk || row.risk,
    stopLoss: row.stopLoss ?? b.risk?.stopLossPct ?? null,
    takeProfit: row.takeProfit ?? b.risk?.takeProfitPct ?? null,
  };
}

function normPair(p) {
  return String(p ?? "")
    .trim()
    .toUpperCase()
    .replace(/-/g, "/");
}

function fmtPrice(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

function fmtQty(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

function fmtDecimal4(n) {
  if (n == null || !Number.isFinite(Number(n))) return "";
  return Number(n).toFixed(4);
}

function hasSavedProtection(row) {
  if (!row || typeof row !== "object") return false;
  const sl = row.stopLoss != null && Number.isFinite(Number(row.stopLoss)) && Number(row.stopLoss) > 0;
  const tp =
    row.takeProfit != null && Number.isFinite(Number(row.takeProfit)) && Number(row.takeProfit) > 0;
  return sl || tp;
}

/** SL/TP pe grafic: reflectă câmpurile în timp real; invalid → încă valoarea salvată. */
function botHasOpenBookPosition(b) {
  if (!b) return false;
  if (b.mode === "paper") return Boolean(b.paperState?.open);
  return Boolean(b.positionState?.open);
}

function chartProtectionPrice(input, saved) {
  const raw = String(input ?? "").trim();
  const savedN =
    saved != null && Number.isFinite(Number(saved)) && Number(saved) > 0 ? Number(saved) : null;
  if (raw === "") return savedN;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  return savedN;
}

/** Niveluri absolute SL/TP pe grafic pentru bot (din % față de intrare). */
function botSlTpAbsoluteFromRow(row) {
  if (!row || row.source !== "bot") return { stopLoss: null, takeProfit: null };
  const entry = Number(row.avgEntry);
  if (!Number.isFinite(entry) || entry <= 0) return { stopLoss: null, takeProfit: null };
  const risk = row.risk && typeof row.risk === "object" ? row.risk : {};
  const slPct = Number(risk.stopLossPct ?? row.stopLoss);
  const tpPct = Number(risk.takeProfitPct ?? row.takeProfit);
  const side = String(row.side || "buy").toLowerCase();
  const longSide = side !== "sell";
  let stopLoss = null;
  let takeProfit = null;
  if (Number.isFinite(slPct) && slPct > 0) {
    stopLoss = longSide ? entry * (1 - slPct / 100) : entry * (1 + slPct / 100);
  }
  if (Number.isFinite(tpPct) && tpPct > 0) {
    takeProfit = longSide ? entry * (1 + tpPct / 100) : entry * (1 - tpPct / 100);
  }
  return { stopLoss, takeProfit };
}

export function LiveTradingPanel() {
  const { loadWallet, syncing: walletSyncing } = useSpotWallet();
  /**
   * Pozițiile live vin din store-ul global (polling ~45s + hydrate din localStorage).
   * UI-ul se sincronizează automat fără `Reîncarcă` când cronul/bot-urile modifică starea.
   */
  const { manual, bots } = useLivePositions();
  const [autoSelected, setAutoSelected] = useState(false);
  const [initializing, setInitializing] = useState(true);
  /** Toate boturile utilizatorului (inclusiv oprite), pentru „preluare manual”. */
  const [allBots, setAllBots] = useState([]);
  const [adoptingBotId, setAdoptingBotId] = useState(null);
  const [startingBotId, setStartingBotId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [kind, setKind] = useState(null);
  const [timeframe, setTimeframe] = useState("15m");
  const [slInput, setSlInput] = useState("");
  const [tpInput, setTpInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  /** Implicit activ: la SL/TP se execută market sell (manual sau închidere bot), nu doar afișare. Dezactivare opțională. */
  const [autoProtectExec, setAutoProtectExec] = useState(true);
  const [polledPrice, setPolledPrice] = useState(null);
  const alertedRef = useRef({ sl: false, tp: false });
  const botSlTpAlertedRef = useRef({ sl: false, tp: false });
  const autoClosingRef = useRef(false);
  const selectedRef = useRef(null);
  const kindRef = useRef(kind);
  const [placementMode, setPlacementMode] = useState(null);
  const [userIndicatorIds, setUserIndicatorIds] = useState([]);
  const [trendLines, setTrendLines] = useState([]);
  const [drawingTrend, setDrawingTrend] = useState(false);
  const [trendDraft, setTrendDraft] = useState(null);
  const [wsTickerPrice, setWsTickerPrice] = useState(null);
  const [wsStatus, setWsStatus] = useState(null);
  const [subscriptionPlan, setSubscriptionPlan] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [aiResult, setAiResult] = useState(null);
  const [botTrades, setBotTrades] = useState([]);
  const [manualPairTrades, setManualPairTrades] = useState([]);

  const canLiveAi = canUseLiveAiAnalysis(subscriptionPlan ?? "free");
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  useEffect(() => {
    kindRef.current = kind;
  }, [kind]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/auth/me");
        const j = await r.json();
        if (r.ok && j.user?.subscriptionPlan != null) {
          setSubscriptionPlan(String(j.user.subscriptionPlan));
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    setAiResult(null);
    setAiError(null);
  }, [selected?.pair, kind]);

  useEffect(() => {
    ensureLivePositionsPolling();
  }, []);

  const loadBotsCatalog = useCallback(async () => {
    const r = await fetch("/api/bots");
    const j = await r.json();
    if (r.ok) setAllBots(j.bots || []);
  }, []);

  /**
   * Reîncarcă de la server (deduplicat prin store) + catalogul de boți.
   * Sincronizarea `selected` cu datele noi se face prin efectul `manual/bots` de mai jos.
   */
  const refresh = useCallback(async () => {
    try {
      await Promise.all([refreshLivePositionsFromServer(), loadBotsCatalog()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Eroare reîncărcare");
    }
  }, [loadBotsCatalog]);

  const adoptCandidates = useMemo(() => {
    const manualPairs = new Set((manual || []).map((m) => normPair(m.pair)));
    return (allBots || []).filter(
      (b) =>
        manualPairs.has(normPair(b.pair)) && !botHasOpenBookPosition(b) && !b.futuresEnabled
    );
  }, [allBots, manual]);

  const adoptCandidatesForSelectedManual = useMemo(() => {
    if (kind !== "manual" || !selected?.pair) return [];
    const p = normPair(selected.pair);
    return adoptCandidates.filter((b) => normPair(b.pair) === p);
  }, [kind, selected?.pair, adoptCandidates]);

  const manualByOrigin = useMemo(() => {
    const user = [];
    const pilot = [];
    for (const m of manual || []) {
      if (m.origin === "pilot") pilot.push(m);
      else user.push(m);
    }
    return { user, pilot };
  }, [manual]);

  const botsByOrigin = useMemo(() => {
    const user = [];
    const pilot = [];
    for (const b of bots || []) {
      if (b.origin === "pilot") pilot.push(b);
      else user.push(b);
    }
    return { user, pilot };
  }, [bots]);

  const fullSelectedBot = useMemo(() => {
    if (kind !== "bot" || !selected?.botId) return null;
    return allBots.find((b) => String(b._id) === selected.botId) ?? null;
  }, [kind, selected?.botId, allBots]);

  const liveBotContext = useMemo(
    () => (kind === "bot" && selected ? enrichBotPositionRow(selected, fullSelectedBot) : null),
    [kind, selected, fullSelectedBot]
  );

  const botChartProtect = useMemo(
    () => botSlTpAbsoluteFromRow(kind === "bot" ? selected : null),
    [kind, selected]
  );

  const liveStrategyDefinition = useMemo(() => {
    if (kind !== "bot" || !fullSelectedBot?.strategyId || typeof fullSelectedBot.strategyId !== "object") {
      return null;
    }
    return fullSelectedBot.strategyId.definition ?? null;
  }, [kind, fullSelectedBot]);

  const manualPilotOverlaySpecs = useMemo(() => {
    if (kind !== "manual" || !selected?.aiPilotStrategy || typeof selected.aiPilotStrategy !== "object") {
      return null;
    }
    const specs = selected.aiPilotStrategy.chartOverlaySpecs;
    return Array.isArray(specs) && specs.length > 0 ? specs : null;
  }, [kind, selected]);

  const showAdoptInCard =
    kind === "bot" &&
    Boolean(selected?.botId) &&
    adoptCandidates.some((b) => String(b._id) === selected.botId);

  const showActivateOnly =
    kind === "bot" &&
    fullSelectedBot &&
    fullSelectedBot.status !== "active" &&
    !showAdoptInCard;

  useEffect(() => {
    if (kind !== "bot" || !selected?.botId) {
      setBotTrades([]);
      return;
    }
    const botId = selected.botId;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(
          `/api/trades?botId=${encodeURIComponent(botId)}&limit=35`
        );
        const j = await r.json();
        if (!r.ok || cancelled) return;
        setBotTrades(Array.isArray(j.trades) ? j.trades : []);
      } catch {
        if (!cancelled) setBotTrades([]);
      }
    };
    load();
    const id = setInterval(load, 14_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [kind, selected?.botId]);

  useEffect(() => {
    if (kind !== "manual" || !selected?.pair) {
      setManualPairTrades([]);
      return;
    }
    const pairQ = encodeURIComponent(normPair(selected.pair));
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(
          `/api/trades?pair=${pairQ}&tradeSource=manual&limit=40`
        );
        const j = await r.json();
        if (!r.ok || cancelled) return;
        setManualPairTrades(Array.isArray(j.trades) ? j.trades : []);
      } catch {
        if (!cancelled) setManualPairTrades([]);
      }
    };
    load();
    const id = setInterval(load, 14_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [kind, selected?.pair]);

  useEffect(() => {
    if (!selected) setKind(null);
  }, [selected]);

  /** Garantează un fetch inițial (în paralel cu polling-ul store-ului) + catalogul de boți. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await Promise.all([refreshLivePositionsFromServer(), loadBotsCatalog()]);
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Eroare");
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadBotsCatalog]);

  /** Auto-select o dată: pe baza URL (?pair / ?bot) sau prima poziție disponibilă. */
  useEffect(() => {
    if (autoSelected) return;
    if (initializing) return;
    let wantPair = null;
    let wantBot = null;
    if (typeof window !== "undefined") {
      try {
        const sp = new URLSearchParams(window.location.search);
        wantPair = sp.get("pair");
        wantBot = sp.get("bot") || sp.get("botId");
      } catch {
        /* ignore */
      }
    }
    const wantNorm = wantPair ? normPair(wantPair) : "";
    const manualMatch = wantNorm ? manual.find((m) => normPair(m.pair) === wantNorm) : null;
    const botMatch = wantBot ? bots.find((b) => String(b.botId) === String(wantBot)) : null;
    if (botMatch) {
      setSelected(botMatch);
      setKind("bot");
    } else if (manualMatch) {
      setSelected(manualMatch);
      setKind("manual");
    } else if (manual[0]) {
      setSelected(manual[0]);
      setKind("manual");
    } else if (bots[0]) {
      setSelected(bots[0]);
      setKind("bot");
    }
    setAutoSelected(true);
  }, [autoSelected, initializing, manual, bots]);

  /** Ține `selected` sincronizat cu cele mai noi date din store (ex. cron închide poziția). */
  useEffect(() => {
    if (!autoSelected) return;
    setSelected((prev) => {
      if (!prev) return prev;
      /** Preview-urile sintetice (adopt candidate) nu au rând în store — nu le atingem. */
      if (prev.synthetic) return prev;
      if (prev.botId) {
        return bots.find((x) => x.botId === prev.botId) ?? null;
      }
      return manual.find((x) => x.pair === prev.pair) ?? null;
    });
  }, [manual, bots, autoSelected]);

  async function adoptManualForBot(botId) {
    setAdoptingBotId(botId);
    try {
      const r = await fetch(`/api/bots/${botId}/adopt-manual`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) {
        toast.error(typeof j.error === "string" ? j.error : "Eroare");
        return;
      }
      toast.success(
        "Poziția manuală e la bot; botul e activ. Închiderea urmează SL/TP și semnalele strategiei (cron)."
      );
      /** Consumă preview-ul sintetic → rândul real vine din store la sincronizare. */
      setSelected((prev) => (prev && prev.botId === botId ? { ...prev, synthetic: false } : prev));
      await refresh();
      void loadWallet({ silent: true });
    } finally {
      setAdoptingBotId(null);
    }
  }

  async function startBot(botId) {
    setStartingBotId(botId);
    try {
      const r = await fetch(`/api/bots/${botId}/start`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) {
        toast.error(typeof j.error === "string" ? j.error : "Eroare");
        return;
      }
      toast.success("Bot activ. Motorul de strategie rulează la cron.");
      await refresh();
      void loadWallet({ silent: true });
    } finally {
      setStartingBotId(null);
    }
  }

  function selectAdoptBotForCard(b) {
    const m = manual.find((x) => x.pair === b.pair);
    if (!m) return;
    const strat = b.strategyId && typeof b.strategyId === "object" ? b.strategyId : null;
    const strategySummary = strat?.definition
      ? summarizeStrategyDefinition(strat.definition)
      : { entryLines: [], exitLines: [] };
    setKind("bot");
    setSelected({
      botId: String(b._id),
      pair: b.pair,
      qty: m.qty,
      avgEntry: m.avgEntry,
      markPrice: m.markPrice,
      stopLoss: b.risk?.stopLossPct ?? null,
      takeProfit: b.risk?.takeProfitPct ?? null,
      source: "bot",
      botStatus: b.status,
      strategyName: strat?.name ?? "—",
      strategySource: strat?.source ?? null,
      strategySafeMode: Boolean(strat?.safeMode),
      strategySummary,
      botMode: b.mode,
      futuresEnabled: Boolean(b.futuresEnabled),
      lastRun: b.lastRun ? new Date(b.lastRun).toISOString() : null,
      risk: b.risk || {},
      side: "buy",
      /** Preview client-side: botul nu are încă poziție deschisă în `bots`. Nu sincroniza cu store-ul. */
      synthetic: true,
    });
  }

  useEffect(() => {
    setWsTickerPrice(null);
    setTrendLines([]);
    setTrendDraft(null);
    setDrawingTrend(false);
  }, [selected?.pair]);

  useEffect(() => {
    setTrendDraft(null);
  }, [timeframe, kind]);

  const userIndicatorSpecs = useMemo(() => {
    return userIndicatorIds
      .map((id, i) => {
        const def = USER_INDICATOR_OPTIONS.find((o) => o.id === id);
        if (!def) return null;
        const color = USER_INDICATOR_PALETTE[i % USER_INDICATOR_PALETTE.length];
        if (def.kind === "ema") {
          return { key: id, kind: "ema", period: def.period, color, title: `EMA ${def.period}` };
        }
        if (def.kind === "sma") {
          return { key: id, kind: "sma", period: def.period, color, title: `SMA ${def.period}` };
        }
        if (def.kind === "bb") {
          return {
            key: id,
            kind: "bb",
            period: def.period,
            mult: def.mult ?? 2,
            color,
            title: `Bollinger ${def.period}`,
          };
        }
        return null;
      })
      .filter(Boolean);
  }, [userIndicatorIds]);

  const toggleUserIndicator = useCallback((id) => {
    setUserIndicatorIds((arr) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]));
  }, []);

  const toggleDrawingTrend = useCallback(() => {
    setDrawingTrend((v) => {
      if (v) setTrendDraft(null);
      return !v;
    });
    setPlacementMode(null);
  }, []);

  const handleTrendPointPicked = useCallback(
    (pt) => {
      if (!pt || !Number.isFinite(Number(pt.time)) || !Number.isFinite(Number(pt.price))) return;
      setTrendDraft((draft) => {
        if (!draft) {
          toast.message("Primul punct fixat. Click pentru al doilea punct.");
          return pt;
        }
        const a = Number(draft.time) <= Number(pt.time) ? draft : pt;
        const b = Number(draft.time) <= Number(pt.time) ? pt : draft;
        if (Number(a.time) === Number(b.time)) {
          toast.error("Alege un al doilea punct cu timp diferit.");
          return draft;
        }
        const line = {
          id: `trend-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          p1: { time: Number(a.time), price: Number(a.price) },
          p2: { time: Number(b.time), price: Number(b.price) },
          color: "#e0b3ff",
          title: "Trend",
        };
        setTrendLines((arr) => [...arr, line]);
        setDrawingTrend(false);
        toast.success("Linie de trend adăugată");
        return null;
      });
    },
    []
  );

  const removeLastTrendLine = useCallback(() => {
    setTrendLines((arr) => arr.slice(0, -1));
  }, []);

  const handleTrendLineUpdate = useCallback((updated) => {
    if (!updated || !updated.id) return;
    setTrendLines((arr) =>
      arr.map((ln) =>
        String(ln.id) === String(updated.id)
          ? {
              ...ln,
              p1: {
                time: Math.floor(Number(updated.p1.time)),
                price: Number(updated.p1.price),
              },
              p2: {
                time: Math.floor(Number(updated.p2.time)),
                price: Number(updated.p2.price),
              },
            }
          : ln
      )
    );
  }, []);

  const clearTrendLines = useCallback(() => {
    setTrendLines([]);
    setTrendDraft(null);
    setDrawingTrend(false);
  }, []);

  useEffect(() => {
    alertedRef.current = { sl: false, tp: false };
    botSlTpAlertedRef.current = { sl: false, tp: false };
  }, [selected?.pair, selected?.botId, kind]);

  useEffect(() => {
    if (!selected || kind !== "manual") return;
    setSlInput(selected.stopLoss != null ? fmtDecimal4(selected.stopLoss) : "");
    setTpInput(selected.takeProfit != null ? fmtDecimal4(selected.takeProfit) : "");
    setPlacementMode(null);
  }, [selected, kind]);

  /**
   * Fallback preț REST când WebSocket-ul nu furnizează ticker (necesar pentru execuție SL/TP).
   * Sari peste fetch dacă WS a livrat un preț în ultimele ~6s (evită concurența WS + REST).
   * Deps: doar perechea + flag-ul futures — nu restartăm intervalul la fiecare refresh de poziție.
   */
  const wsLastTickerMsRef = useRef(0);
  useEffect(() => {
    if (wsTickerPrice != null && Number.isFinite(wsTickerPrice)) {
      wsLastTickerMsRef.current = Date.now();
    }
  }, [wsTickerPrice]);
  useEffect(() => {
    const pair = selected?.pair;
    if (!pair) {
      setPolledPrice(null);
      return;
    }
    const futures = selected?.futuresEnabled === true;
    let cancelled = false;
    const tick = async () => {
      if (Date.now() - wsLastTickerMsRef.current < 6000) return;
      try {
        const q = new URLSearchParams({ symbol: pair });
        if (futures) q.set("futures", "1");
        const r = await fetch(`/api/market/last-price?${q}`);
        const j = await r.json();
        if (!cancelled && r.ok && typeof j.price === "number" && Number.isFinite(j.price)) {
          setPolledPrice(j.price);
        }
      } catch {
        if (!cancelled) setPolledPrice(null);
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [selected?.pair, selected?.futuresEnabled]);

  /**
   * Manual: preț WS sau polling REST; la SL/TP (câmpuri + salvate) → market sell în modul poziției.
   */
  useEffect(() => {
    if (!autoProtectExec || kind !== "manual") return;
    if (!selectedRef.current?.pair) return;
    const sel = selectedRef.current;
    const px =
      (wsTickerPrice != null && Number.isFinite(wsTickerPrice) ? wsTickerPrice : null) ??
      (polledPrice != null && Number.isFinite(polledPrice) ? polledPrice : null) ??
      (sel.markPrice != null && Number.isFinite(sel.markPrice) ? sel.markPrice : null);
    if (px == null || !Number.isFinite(px)) return;

    const sl = chartProtectionPrice(slInput, sel.stopLoss);
    const tp = chartProtectionPrice(tpInput, sel.takeProfit);
    if (sl == null && tp == null) return;

    const triggerAutoClose = async (reason) => {
      if (autoClosingRef.current) return;
      const cur = selectedRef.current;
      if (!cur?.pair || kindRef.current !== "manual") return;

      autoClosingRef.current = true;
      alertedRef.current = { sl: true, tp: true };
      const mode = cur.paper === true ? "paper" : "real";
      const pair = cur.pair;

      try {
        const r = await fetch("/api/live/close", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pair, mode }),
        });
        const j = await r.json();
        if (!r.ok) {
          toast.error(typeof j.error === "string" ? j.error : "Închidere automată SL/TP eșuată");
          alertedRef.current = { sl: false, tp: false };
          return;
        }
        if (reason === "sl") {
          toast.warning(`Stop loss executat — poziție închisă (~${fmtPrice(px)}).`, { duration: 10_000 });
        } else {
          toast.success(`Take profit executat — poziție închisă (~${fmtPrice(px)}).`, { duration: 10_000 });
        }
        if (selectedRef.current?.pair === pair) {
          setSelected(null);
          setKind(null);
        }
        await refresh();
        void loadWallet({ silent: true });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Eroare rețea la închidere");
        alertedRef.current = { sl: false, tp: false };
      } finally {
        autoClosingRef.current = false;
      }
    };

    if (sl != null && px <= sl && !alertedRef.current.sl) {
      alertedRef.current.sl = true;
      void triggerAutoClose("sl");
      return;
    }
    if (tp != null && px >= tp && !alertedRef.current.tp) {
      alertedRef.current.tp = true;
      void triggerAutoClose("tp");
    }
  }, [wsTickerPrice, polledPrice, slInput, tpInput, autoProtectExec, kind, refresh, loadWallet]);

  /**
   * Bot: SL/TP % (ca la cron) pe poziție long; la țintă → stop cu închidere market.
   */
  useEffect(() => {
    if (!autoProtectExec || kind !== "bot") return;
    const sel = selectedRef.current;
    if (!sel?.botId || sel.source !== "bot") return;
    const st = sel.botStatus;
    if (st !== "active" && st !== "paused") return;

    const entry = Number(sel.avgEntry);
    if (!Number.isFinite(entry) || entry <= 0) return;

    const risk = sel.risk && typeof sel.risk === "object" ? sel.risk : {};
    const slPct = Number(risk.stopLossPct ?? sel.stopLoss);
    const tpPct = Number(risk.takeProfitPct ?? sel.takeProfit);
    const side = String(sel.side || "buy").toLowerCase();
    const longSide = side !== "sell";
    let slPrice = null;
    let tpPrice = null;
    if (Number.isFinite(slPct) && slPct > 0) {
      slPrice = longSide ? entry * (1 - slPct / 100) : entry * (1 + slPct / 100);
    }
    if (Number.isFinite(tpPct) && tpPct > 0) {
      tpPrice = longSide ? entry * (1 + tpPct / 100) : entry * (1 - tpPct / 100);
    }
    if (slPrice == null && tpPrice == null) return;

    const px =
      (wsTickerPrice != null && Number.isFinite(wsTickerPrice) ? wsTickerPrice : null) ??
      (polledPrice != null && Number.isFinite(polledPrice) ? polledPrice : null) ??
      (sel.markPrice != null && Number.isFinite(sel.markPrice) ? sel.markPrice : null);
    if (px == null || !Number.isFinite(px)) return;

    const hitSl =
      slPrice != null && (longSide ? px <= slPrice : px >= slPrice);
    const hitTp =
      tpPrice != null && (longSide ? px >= tpPrice : px <= tpPrice);

    const triggerBotClose = async (reason) => {
      if (autoClosingRef.current) return;
      const cur = selectedRef.current;
      if (!cur?.botId || kindRef.current !== "bot") return;
      autoClosingRef.current = true;
      botSlTpAlertedRef.current = { sl: true, tp: true };
      const botId = cur.botId;
      try {
        const r = await fetch(`/api/bots/${botId}/stop`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ disposition: "close_market" }),
        });
        const j = await r.json();
        if (!r.ok) {
          toast.error(typeof j.error === "string" ? j.error : "Închidere automată bot (SL/TP) eșuată");
          botSlTpAlertedRef.current = { sl: false, tp: false };
          return;
        }
        if (reason === "sl") {
          toast.warning(`Stop loss bot — poziție închisă la market (~${fmtPrice(px)}).`, { duration: 10_000 });
        } else {
          toast.success(`Take profit bot — poziție închisă la market (~${fmtPrice(px)}).`, { duration: 10_000 });
        }
        if (selectedRef.current?.botId === botId) {
          setSelected(null);
          setKind(null);
        }
        await refresh();
        void loadWallet({ silent: true });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Eroare rețea la închidere bot");
        botSlTpAlertedRef.current = { sl: false, tp: false };
      } finally {
        autoClosingRef.current = false;
      }
    };

    if (hitSl && !botSlTpAlertedRef.current.sl) {
      botSlTpAlertedRef.current.sl = true;
      void triggerBotClose("sl");
      return;
    }
    if (hitTp && !botSlTpAlertedRef.current.tp) {
      botSlTpAlertedRef.current.tp = true;
      void triggerBotClose("tp");
    }
  }, [
    wsTickerPrice,
    polledPrice,
    autoProtectExec,
    kind,
    selected?.botId,
    selected?.avgEntry,
    selected?.stopLoss,
    selected?.takeProfit,
    selected?.side,
    selected?.botStatus,
    selected?.source,
    selected?.markPrice,
    selected?.risk?.stopLossPct,
    selected?.risk?.takeProfitPct,
    refresh,
    loadWallet,
  ]);

  const commitProtectFromChart = useCallback(
    async (patch) => {
      const sel = selectedRef.current;
      if (!sel?.pair || kindRef.current !== "manual") return;
      const body = { pair: sel.pair };
      if (patch.stopLoss !== undefined) {
        const n = Number(patch.stopLoss);
        if (!Number.isFinite(n) || n <= 0) {
          toast.error("Stop loss invalid");
          throw new Error("invalid");
        }
        body.stopLoss = n;
      }
      if (patch.takeProfit !== undefined) {
        const n = Number(patch.takeProfit);
        if (!Number.isFinite(n) || n <= 0) {
          toast.error("Take profit invalid");
          throw new Error("invalid");
        }
        body.takeProfit = n;
      }
      if (Object.keys(body).length <= 1) return;

      setSaving(true);
      try {
        const r = await fetch("/api/live/protect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = await r.json();
        if (!r.ok) {
          toast.error(typeof j.error === "string" ? j.error : "Eroare");
          try {
            await refresh();
          } catch {
            /* ignore */
          }
          throw new Error(typeof j.error === "string" ? j.error : "protect");
        }
        if (patch.stopLoss !== undefined) setSlInput(fmtDecimal4(patch.stopLoss));
        if (patch.takeProfit !== undefined) setTpInput(fmtDecimal4(patch.takeProfit));
        toast.success("Țintă actualizată");
        alertedRef.current = { sl: false, tp: false };
        await refresh();
      } finally {
        setSaving(false);
      }
    },
    [refresh]
  );

  async function runLiveAiProtect(applyToDb) {
    if (!selected?.pair || kind !== "manual") return;
    setAiLoading(true);
    setAiError(null);
    try {
      const r = await fetch("/api/live/ai-protect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pair: selected.pair, apply: Boolean(applyToDb) }),
      });
      const j = await r.json();
      if (!r.ok) {
        setAiError(typeof j.error === "string" ? j.error : "Eroare analiză AI");
        return;
      }
      setAiResult(j);
      if (applyToDb && j.stopLoss != null && j.takeProfit != null) {
        setSlInput(fmtDecimal4(j.stopLoss));
        setTpInput(fmtDecimal4(j.takeProfit));
        toast.success("Ținte AI salvate în Live");
        alertedRef.current = { sl: false, tp: false };
        await refresh();
      } else if (!applyToDb) {
        toast.message("Analiză gata — poți aplica țintele manual sau salva din card.");
      }
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Eroare");
    } finally {
      setAiLoading(false);
    }
  }

  async function persistAiSuggestionsFromCard() {
    if (!selected || kind !== "manual" || !aiResult?.stopLoss || !aiResult?.takeProfit) return;
    setSaving(true);
    try {
      const r = await fetch("/api/live/protect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pair: selected.pair,
          stopLoss: Number(aiResult.stopLoss),
          takeProfit: Number(aiResult.takeProfit),
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error(typeof j.error === "string" ? j.error : "Eroare");
        return;
      }
      setSlInput(fmtDecimal4(aiResult.stopLoss));
      setTpInput(fmtDecimal4(aiResult.takeProfit));
      toast.success("Ținte AI salvate");
      alertedRef.current = { sl: false, tp: false };
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  function applyAiSuggestionsToInputs() {
    if (!aiResult?.stopLoss || !aiResult?.takeProfit) return;
    setSlInput(fmtDecimal4(aiResult.stopLoss));
    setTpInput(fmtDecimal4(aiResult.takeProfit));
    toast.message("Valorile sunt în câmpurile SL/TP — verifică și apasă Salvează ținte.");
  }

  async function saveProtections() {
    if (!selected || kind !== "manual") return;
    setSaving(true);
    try {
      const slRaw = slInput.trim();
      const tpRaw = tpInput.trim();
      const body = { pair: selected.pair };
      if (slRaw === "") body.stopLoss = null;
      else {
        const n = Number(slRaw);
        if (!Number.isFinite(n) || n <= 0) {
          toast.error("Stop loss invalid");
          return;
        }
        body.stopLoss = n;
      }
      if (tpRaw === "") body.takeProfit = null;
      else {
        const n = Number(tpRaw);
        if (!Number.isFinite(n) || n <= 0) {
          toast.error("Take profit invalid");
          return;
        }
        body.takeProfit = n;
      }

      const r = await fetch("/api/live/protect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error(typeof j.error === "string" ? j.error : "Eroare");
        return;
      }
      toast.success("Ținte salvate");
      alertedRef.current = { sl: false, tp: false };
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function clearProtections() {
    if (!selected || kind !== "manual") return;
    setSaving(true);
    try {
      const r = await fetch("/api/live/protect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pair: selected.pair, clear: true }),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error(typeof j.error === "string" ? j.error : "Eroare");
        return;
      }
      setSlInput("");
      setTpInput("");
      toast.message("Ținte eliminate");
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function closePosition() {
    if (!selected || kind !== "manual") return;
    /** Modul de închidere urmează exact modul pozi­ției (paper/real) — fără toggle manual. */
    const mode = selected.paper === true ? "paper" : "real";
    setClosing(true);
    try {
      const r = await fetch("/api/live/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pair: selected.pair, mode }),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error(typeof j.error === "string" ? j.error : "Eroare");
        return;
      }
      toast.success("Poziție închisă (market sell)");
      setSelected(null);
      setKind(null);
      await refresh();
      void loadWallet({ silent: true });
    } finally {
      setClosing(false);
    }
  }

  async function discardDustPosition() {
    if (!selected || kind !== "manual") return;
    const pair = selected.pair;
    const baseAsset = String(pair).split("/")[0] || "BASE";
    const qtyStr = Number(selected.qty).toLocaleString(undefined, { maximumFractionDigits: 8 });
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        `Elimin din cartea aplicației poziția ${pair} (${qtyStr} ${baseAsset})?\n\n` +
          "Folosește DOAR pentru „praf” care nu respectă LOT_SIZE / MIN_NOTIONAL pe Binance. " +
          "Acțiunea nu plasează niciun ordin: poziția dispare doar din app, iar orice sold rămas " +
          "pe Binance trebuie vândut / convertit manual acolo."
      );
      if (!ok) return;
    }
    setDiscarding(true);
    try {
      let r = await fetch("/api/live/discard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pair }),
      });
      let j = await r.json();
      if (!r.ok) {
        const canForce =
          typeof window !== "undefined" &&
          /NU e praf|nu am putut verifica|F[aă]r[aă] chei API/i.test(String(j.error || "")) &&
          window.confirm(
            (typeof j.error === "string" ? j.error + "\n\n" : "") +
              "Vrei să forțezi eliminarea din carte oricum? Binance nu va fi contactat."
          );
        if (!canForce) {
          toast.error(typeof j.error === "string" ? j.error : "Eroare eliminare poziție");
          return;
        }
        r = await fetch("/api/live/discard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pair, force: true }),
        });
        j = await r.json();
        if (!r.ok) {
          toast.error(typeof j.error === "string" ? j.error : "Eroare eliminare poziție");
          return;
        }
      }
      toast.success(`Poziție eliminată din carte (${pair}).`);
      setSelected(null);
      setKind(null);
      await refresh();
      void loadWallet({ silent: true });
    } finally {
      setDiscarding(false);
    }
  }

  const markForPnl =
    selected &&
    (wsTickerPrice != null && Number.isFinite(wsTickerPrice)
      ? wsTickerPrice
      : polledPrice != null && Number.isFinite(polledPrice)
        ? polledPrice
        : selected.markPrice);
  const unrealized =
    selected && markForPnl != null && selected.avgEntry
      ? (markForPnl - selected.avgEntry) * selected.qty
      : null;

  /** Cost estimativ în USDC (poziție long spot): cantitate bază × preț mediu intrare. */
  const investedUsdcAtCost =
    selected &&
    Number.isFinite(Number(selected.qty)) &&
    Number.isFinite(Number(selected.avgEntry)) &&
    Number(selected.qty) > 0 &&
    Number(selected.avgEntry) > 0
      ? Number(selected.qty) * Number(selected.avgEntry)
      : null;

  if (!autoSelected) {
    return <p className="text-sm text-muted-foreground">Se încarcă pozițiile…</p>;
  }

  const hasAny = (manual?.length ?? 0) + (bots?.length ?? 0) > 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)_minmax(0,280px)]">
      <div className="space-y-4 min-w-0">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Manual (carte)</CardTitle>
            <CardDescription>
            Toate pozițiile deschise din carte, grupate: manual tău vs orchestrate de AI Pilot (după ultimul buy
            manual din jurnal).
          </CardDescription>
          </CardHeader>
          <CardContent className="max-h-[min(70vh,520px)] space-y-3 overflow-y-auto pr-1">
            {!manual.length ? (
              <p className="text-xs text-muted-foreground">Nicio poziție deschisă.</p>
            ) : (
              <>
                {manualByOrigin.user.length > 0 ? (
                  <div className="space-y-1.5">
                    <p className="sticky top-0 z-[1] bg-card/95 px-0.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur-sm">
                      Tu · manual
                    </p>
                    {manualByOrigin.user.map((row) => (
                      <button
                        key={row.pair}
                        type="button"
                        onClick={() => {
                          setSelected(row);
                          setKind("manual");
                        }}
                        className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                          selected?.pair === row.pair && kind === "manual"
                            ? "border-primary bg-primary/10"
                            : "border-border hover:bg-muted/50"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">{row.pair}</span>
                          <div className="flex flex-wrap gap-1">
                            {row.paper ? (
                              <Badge variant="outline" className="text-[9px]">
                                paper
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[9px]">
                                live
                              </Badge>
                            )}
                            {hasSavedProtection(row) ? (
                              <Badge variant="outline" className="border-emerald-500/40 text-[9px] text-emerald-200">
                                TP/SL monitorizat
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[9px] text-muted-foreground">
                                fără TP/SL
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">
                          qty {fmtQty(row.qty)} · medie {fmtPrice(row.avgEntry)}
                          {row.markPrice != null ? ` · piață ${fmtPrice(row.markPrice)}` : ""}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}
                {manualByOrigin.pilot.length > 0 ? (
                  <div className="space-y-1.5">
                    <p className="sticky top-0 z-[1] bg-card/95 px-0.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200/90 backdrop-blur-sm">
                      AI Pilot
                    </p>
                    {manualByOrigin.pilot.map((row) => (
                      <button
                        key={row.pair}
                        type="button"
                        onClick={() => {
                          setSelected(row);
                          setKind("manual");
                        }}
                        className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                          selected?.pair === row.pair && kind === "manual"
                            ? "border-primary bg-primary/10"
                            : "border-amber-500/25 hover:bg-amber-500/[0.06]"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">{row.pair}</span>
                          <div className="flex flex-wrap gap-1">
                            <Badge variant="outline" className="border-amber-500/40 text-[9px] text-amber-100">
                              Pilot
                            </Badge>
                            {row.paper ? (
                              <Badge variant="outline" className="text-[9px]">
                                paper
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[9px]">
                                live
                              </Badge>
                            )}
                            {hasSavedProtection(row) ? (
                              <Badge variant="outline" className="border-emerald-500/40 text-[9px] text-emerald-200">
                                TP/SL monitorizat
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[9px] text-muted-foreground">
                                fără TP/SL
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">
                          qty {fmtQty(row.qty)} · medie {fmtPrice(row.avgEntry)}
                          {row.markPrice != null ? ` · piață ${fmtPrice(row.markPrice)}` : ""}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Bots (deschis)</CardTitle>
            <CardDescription>
              Toți boții cu poziție deschisă, grupați: strategii tale vs strategii create de AI Pilot
              (`source: pilot`).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="max-h-[min(55vh,420px)] space-y-3 overflow-y-auto pr-1">
              {!bots.length ? (
                <p className="text-xs text-muted-foreground">Niciun bot cu poziție deschisă.</p>
              ) : (
                <>
                  {botsByOrigin.user.length > 0 ? (
                    <div className="space-y-1.5">
                      <p className="sticky top-0 z-[1] bg-card/95 px-0.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur-sm">
                        Tu · boți
                      </p>
                      {botsByOrigin.user.map((row) => (
                        <button
                          key={row.botId}
                          type="button"
                          onClick={() => {
                            setSelected(row);
                            setKind("bot");
                          }}
                          className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                            selected?.botId === row.botId && kind === "bot"
                              ? "border-primary bg-primary/10"
                              : "border-border hover:bg-muted/50"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-medium">{row.pair}</span>
                            <div className="flex flex-wrap items-center gap-1">
                              <Badge variant="outline" className="text-[10px]">
                                {row.botStatus}
                              </Badge>
                              {row.botMode === "paper" ? (
                                <Badge variant="outline" className="text-[9px]">
                                  paper
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="text-[9px]">
                                  live
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground">{row.strategyName}</div>
                          <div className="font-mono text-xs text-muted-foreground">
                            qty {fmtQty(row.qty)} · intrare {fmtPrice(row.avgEntry)}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {botsByOrigin.pilot.length > 0 ? (
                    <div className="space-y-1.5">
                      <p className="sticky top-0 z-[1] bg-card/95 px-0.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200/90 backdrop-blur-sm">
                        AI Pilot · boți
                      </p>
                      {botsByOrigin.pilot.map((row) => (
                        <button
                          key={row.botId}
                          type="button"
                          onClick={() => {
                            setSelected(row);
                            setKind("bot");
                          }}
                          className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                            selected?.botId === row.botId && kind === "bot"
                              ? "border-primary bg-primary/10"
                              : "border-amber-500/25 hover:bg-amber-500/[0.06]"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-medium">{row.pair}</span>
                            <div className="flex flex-wrap items-center gap-1">
                              <Badge variant="outline" className="border-amber-500/40 text-[9px] text-amber-100">
                                Pilot
                              </Badge>
                              <Badge variant="outline" className="text-[10px]">
                                {row.botStatus}
                              </Badge>
                              {row.botMode === "paper" ? (
                                <Badge variant="outline" className="text-[9px]">
                                  paper
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="text-[9px]">
                                  live
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground">{row.strategyName}</div>
                          <div className="font-mono text-xs text-muted-foreground">
                            qty {fmtQty(row.qty)} · intrare {fmtPrice(row.avgEntry)}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </div>

            {manual.length > 0 && adoptCandidates.length === 0 && (
              <div className="space-y-1 border-t border-border pt-3">
                <p className="text-xs font-medium text-amber-200/90">Preluare la bot</p>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Nu există încă un bot spot (fără poziție) pe perechea din Manual. Creează în{" "}
                  <Link href="/bots" className="font-medium text-primary underline underline-offset-2">
                    Bots
                  </Link>{" "}
                  un bot cu <span className="font-mono">aceeași pereche</span> și{" "}
                  <span className="font-medium">același mod</span> paper sau real, apoi apasă Reîncarcă.
                </p>
              </div>
            )}

            {adoptCandidates.length > 0 && (
              <div className="space-y-2 border-t border-border pt-3">
                <p className="text-xs font-medium text-muted-foreground">Preluare poziție manuală</p>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Același mod paper/real ca la tranzacția manuală. Țintele Live (SL/TP fixe) pentru pereche se
                  șterg; botul folosește procentele din strategie.
                </p>
                {adoptCandidates.map((b) => (
                  <div
                    key={String(b._id)}
                    role="button"
                    tabIndex={0}
                    onClick={() => selectAdoptBotForCard(b)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        selectAdoptBotForCard(b);
                      }
                    }}
                    title="Deschide graficul și acțiunile în cardul din dreapta"
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-2 py-2 outline-none ring-offset-background transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="min-w-0 text-left">
                      <div className="text-sm font-medium">{b.pair}</div>
                      <div className="truncate text-[10px] text-muted-foreground">
                        {b.strategyId?.name ?? "Strategie"} · {b.mode}
                        {b.status !== "active" ? ` · ${b.status}` : ""}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="shrink-0"
                      disabled={adoptingBotId === String(b._id)}
                      onClick={(e) => {
                        e.stopPropagation();
                        adoptManualForBot(String(b._id));
                      }}
                    >
                      {adoptingBotId === String(b._id) ? "…" : "Preia & activează"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => refresh()}>
          Reîncarcă
        </Button>
        {walletSyncing ? (
          <p className="text-center text-[11px] text-muted-foreground">Wallet syncing…</p>
        ) : null}
      </div>

      <div className="space-y-4 min-w-0">
        {!hasAny && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Nu ai poziții deschise. Folosește Trading pentru a cumpăra, sau pornește un bot.
            </CardContent>
          </Card>
        )}

        {selected && (
          <>
            <Card>
              <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {selected.pair}
                    <Badge variant="secondary">{kind === "manual" ? "Manual" : "Bot"}</Badge>
                  </CardTitle>
                  <CardDescription>
                    {kind === "bot"
                      ? `Strategie „${liveBotContext?.strategyName ?? "—"}”: motorul rulează la cron pe lumânări 15m pentru intrare și ieșire, cu filtru de trend din 1d. Pe grafic: intrare, SL/TP la preț din procentele botului și linii pentru indicatorii din reguli (EMA/SMA/Bollinger unde există). Timeframe-ul graficului poate diferi de 15m.`
                      : "Istoric REST Binance · lumânări și ultimul preț prin WebSocket. SL/TP pe grafic sau din câmpuri. După „Analiză AI — SL / TP”, indicatorii aleși de model (EMA/SMA/Bollinger) apar pe grafic."}
                  </CardDescription>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className="flex flex-wrap justify-end gap-1">
                    {TF_OPTIONS.map((tf) => (
                      <Button
                        key={tf}
                        type="button"
                        size="sm"
                        variant={timeframe === tf ? "default" : "outline"}
                        onClick={() => setTimeframe(tf)}
                      >
                        {tf}
                      </Button>
                    ))}
                  </div>
                  {wsStatus && (
                    <span className="text-[10px] text-muted-foreground">
                      Socket:{" "}
                      {wsStatus === "open"
                        ? "conectat"
                        : wsStatus === "connecting"
                          ? "conectare…"
                          : wsStatus === "closed"
                            ? "închis"
                            : wsStatus === "error"
                              ? "eroare"
                              : wsStatus}
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {kind === "manual" && selected?.pair && (
                  <div className="space-y-2 rounded-lg border border-primary/35 bg-primary/[0.07] px-3 py-3">
                    <p className="text-xs font-semibold text-foreground">Delegă la motorul de strategie (bot)</p>
                    {adoptCandidatesForSelectedManual.length > 0 ? (
                      <>
                        <p className="text-[11px] leading-snug text-muted-foreground">
                          Poziția din carte trece la bot; SL/TP fixe Live pentru pereche se șterg. Botul aplică
                          procentele din strategie la cron.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {adoptCandidatesForSelectedManual.map((b) => (
                            <Button
                              key={String(b._id)}
                              type="button"
                              size="sm"
                              disabled={adoptingBotId === String(b._id)}
                              onClick={() => adoptManualForBot(String(b._id))}
                            >
                              {adoptingBotId === String(b._id)
                                ? "…"
                                : `Preia & activează · ${b.strategyId?.name ?? "Bot"}`}
                            </Button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="text-[11px] leading-snug text-muted-foreground">
                        Nu ai un bot spot pe <span className="font-mono">{selected.pair}</span> fără poziție
                        deschisă. Mergi la{" "}
                        <Link
                          href="/bots"
                          className="font-medium text-primary underline underline-offset-2"
                        >
                          Bots
                        </Link>
                        , creează unul cu aceeași pereche și mod (paper/real), apoi{" "}
                        <button
                          type="button"
                          className="font-medium text-primary underline underline-offset-2"
                          onClick={() => refresh()}
                        >
                          Reîncarcă
                        </button>
                        .
                      </p>
                    )}
                  </div>
                )}
                {kind === "bot" && (showActivateOnly || showAdoptInCard) && (
                  <div className="space-y-2 rounded-lg border border-border bg-muted/25 px-3 py-2">
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      {showAdoptInCard
                        ? "Mută poziția din carte la acest bot și îl pornește — apoi cronul aplică SL/TP % și semnalele strategiei."
                        : "Bot oprit sau întrerupt: îl activezi ca motorul de strategie să ruleze la cron (fără poziție în acest moment)."}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {showActivateOnly && (
                        <Button
                          type="button"
                          size="sm"
                          disabled={startingBotId === selected.botId}
                          onClick={() => startBot(selected.botId)}
                        >
                          {startingBotId === selected.botId ? "…" : "Activează bot"}
                        </Button>
                      )}
                      {showAdoptInCard && (
                        <Button
                          type="button"
                          size="sm"
                          variant={showActivateOnly ? "secondary" : "default"}
                          disabled={adoptingBotId === selected.botId}
                          onClick={() => adoptManualForBot(selected.botId)}
                        >
                          {adoptingBotId === selected.botId ? "…" : "Preia manual & activează"}
                        </Button>
                      )}
                    </div>
                  </div>
                )}
                {kind === "manual" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={placementMode === "sl" ? "default" : "outline"}
                      className={placementMode === "sl" ? "bg-red-600 hover:bg-red-700" : ""}
                      onClick={() => {
                        setPlacementMode((m) => (m === "sl" ? null : "sl"));
                        setDrawingTrend(false);
                        setTrendDraft(null);
                      }}
                    >
                      Plasează SL pe grafic
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={placementMode === "tp" ? "default" : "outline"}
                      className={placementMode === "tp" ? "bg-lime-600 hover:bg-lime-700" : ""}
                      onClick={() => {
                        setPlacementMode((m) => (m === "tp" ? null : "tp"));
                        setDrawingTrend(false);
                        setTrendDraft(null);
                      }}
                    >
                      Plasează TP pe grafic
                    </Button>
                    <span className="hidden h-6 w-px bg-border sm:inline-block" aria-hidden />
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={closing}
                      onClick={() => closePosition()}
                      title={`Market sell pentru toată cantitatea (${selected.paper === true ? "paper" : "real"})`}
                      className="font-semibold"
                    >
                      {closing
                        ? "Se închide…"
                        : `Închide poziția · ${fmtQty(selected.qty)} ${selected.pair.split("/")[0]}`}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={discarding}
                      onClick={() => void discardDustPosition()}
                      title={
                        "Elimină poziția din cartea aplicației (pentru „praf” sub LOT_SIZE / " +
                        "MIN_NOTIONAL pe Binance). Nu plasează niciun ordin."
                      }
                      className="border-rose-500/40 text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
                    >
                      {discarding ? "Se elimină…" : "Elimină praf"}
                    </Button>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">Indicatori:</span>
                    {USER_INDICATOR_OPTIONS.map((opt) => {
                      const active = userIndicatorIds.includes(opt.id);
                      return (
                        <Button
                          key={opt.id}
                          type="button"
                          size="sm"
                          variant={active ? "default" : "outline"}
                          className="h-7 px-2 text-[11px]"
                          onClick={() => toggleUserIndicator(opt.id)}
                        >
                          {opt.label}
                        </Button>
                      );
                    })}
                  </div>
                  <span className="hidden h-6 w-px bg-border sm:inline-block" aria-hidden />
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant={drawingTrend ? "default" : "outline"}
                      className={`h-7 px-2 text-[11px] ${drawingTrend ? "bg-violet-600 hover:bg-violet-700" : ""}`}
                      onClick={toggleDrawingTrend}
                    >
                      {drawingTrend
                        ? trendDraft
                          ? "Al 2-lea click…"
                          : "Click primul punct…"
                        : "Desenează linie"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      disabled={trendLines.length === 0}
                      onClick={removeLastTrendLine}
                      title="Șterge ultima linie de trend"
                    >
                      Undo
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      disabled={trendLines.length === 0 && !drawingTrend}
                      onClick={clearTrendLines}
                    >
                      Șterge linii ({trendLines.length})
                    </Button>
                  </div>
                  <span className="basis-full text-[10px] leading-snug text-muted-foreground">
                    Indicatorii și liniile sunt doar informative — nu influențează execuția automată SL/TP sau botul.
                    Trage de un capăt ca să lungești linia, sau de mijloc ca să o muți.
                  </span>
                </div>
                <LiveBinanceChart
                  key={`${selected.pair}-${kind}-${timeframe}-${kind === "bot" ? selected.botId : ""}`}
                  symbol={selected.pair}
                  timeframe={timeframe}
                  avgEntry={selected.avgEntry}
                  stopLoss={
                    kind === "manual"
                      ? chartProtectionPrice(slInput, selected.stopLoss)
                      : botChartProtect.stopLoss
                  }
                  takeProfit={
                    kind === "manual"
                      ? chartProtectionPrice(tpInput, selected.takeProfit)
                      : botChartProtect.takeProfit
                  }
                  spotOnly={!(kind === "bot" && selected.futuresEnabled)}
                  showProtectionLines={kind === "manual" || kind === "bot"}
                  protectionReadOnly={kind === "bot"}
                  strategyDefinition={liveStrategyDefinition}
                  aiOverlaySpecs={
                    kind === "manual" && Array.isArray(aiResult?.chartOverlaySpecs) && aiResult.chartOverlaySpecs.length
                      ? aiResult.chartOverlaySpecs
                      : manualPilotOverlaySpecs
                  }
                  userIndicatorSpecs={userIndicatorSpecs}
                  trendLines={trendLines}
                  placementMode={kind === "manual" ? placementMode : null}
                  drawingMode={drawingTrend ? "trend" : null}
                  onPlacementConsumed={() => setPlacementMode(null)}
                  onProtectCommit={kind === "manual" ? commitProtectFromChart : undefined}
                  onTrendPointPicked={handleTrendPointPicked}
                  onTrendLineUpdate={handleTrendLineUpdate}
                  onTickerPrice={(p) => setWsTickerPrice(p)}
                  onWsStatus={setWsStatus}
                />
              </CardContent>
            </Card>

            {kind === "manual" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Analiză AI — SL / TP</CardTitle>
                  <CardDescription>
                    Modelul AI ales în Setări evaluează contextul pieței (OHLC) și poziția ta long spot; propune stop loss și take
                    profit absolut și indică 1–4 indicatori (EMA/SMA/Bollinger) afișați pe grafic, aliniați cu
                    analiza. Educațional — nu este sfat financiar. Necesită plan Pro sau Elite.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {!canLiveAi ? (
                    <p className="text-xs text-muted-foreground">
                      Activează planul Pro sau Elite din{" "}
                      <Link href="/settings" className="font-medium text-primary underline underline-offset-2">
                        Settings
                      </Link>{" "}
                      pentru a folosi analiza AI.
                    </p>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={aiLoading || saving}
                          onClick={() => runLiveAiProtect(false)}
                        >
                          {aiLoading ? "…" : "Generează analiză"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={aiLoading || saving}
                          onClick={() => runLiveAiProtect(true)}
                        >
                          {aiLoading ? "…" : "Generează și salvează ținte"}
                        </Button>
                      </div>
                      {aiError ? (
                        <p className="text-xs text-destructive">{aiError}</p>
                      ) : null}
                      {aiResult ? (
                        <div className="space-y-3 rounded-md border border-border/80 bg-muted/15 p-3 text-xs leading-relaxed">
                          {aiResult.notaExecutive ? (
                            <p className="font-medium text-foreground">{aiResult.notaExecutive}</p>
                          ) : null}
                          {aiResult.analizaTehnica ? (
                            <div>
                              <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                                Analiză tehnică
                              </p>
                              <p className="whitespace-pre-wrap text-muted-foreground">{aiResult.analizaTehnica}</p>
                            </div>
                          ) : null}
                          {aiResult.analizaFinanciara ? (
                            <div>
                              <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                                Analiză financiară / risc
                              </p>
                              <p className="whitespace-pre-wrap text-muted-foreground">{aiResult.analizaFinanciara}</p>
                            </div>
                          ) : null}
                          {Array.isArray(aiResult.avertismente) && aiResult.avertismente.length > 0 ? (
                            <ul className="list-inside list-disc text-amber-200/90">
                              {aiResult.avertismente.map((a, i) => (
                                <li key={i}>{a}</li>
                              ))}
                            </ul>
                          ) : null}
                          {Array.isArray(aiResult.chartOverlaySpecs) && aiResult.chartOverlaySpecs.length > 0 ? (
                            <div>
                              <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                                Indicatori pe grafic
                              </p>
                              <p className="text-muted-foreground">
                                {aiResult.chartOverlaySpecs.map((s) => s.title).join(" · ")}
                              </p>
                            </div>
                          ) : null}
                          <div className="flex flex-wrap gap-3 font-mono text-[11px] text-foreground">
                            <span>
                              SL sugerat:{" "}
                              {aiResult.stopLoss != null ? fmtPrice(aiResult.stopLoss) : "—"}
                            </span>
                            <span>
                              TP sugerat:{" "}
                              {aiResult.takeProfit != null ? fmtPrice(aiResult.takeProfit) : "—"}
                            </span>
                            {aiResult.applied ? (
                              <Badge variant="outline" className="text-[10px]">
                                Salvat
                              </Badge>
                            ) : null}
                          </div>
                          {!aiResult.applied ? (
                            <div className="flex flex-wrap gap-2 pt-1">
                              <Button type="button" size="sm" variant="outline" onClick={applyAiSuggestionsToInputs}>
                                Aplică în câmpuri
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => persistAiSuggestionsFromCard()}
                                disabled={saving}
                              >
                                {saving ? "…" : "Salvează ținte sugerate"}
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      <div className="space-y-4 min-w-0 lg:sticky lg:top-4 lg:self-start">
        {hasAny && !selected ? (
          <Card>
            <CardContent className="py-6 text-center text-xs text-muted-foreground">
              Selectează o poziție din stânga pentru sumar și acțiuni.
            </CardContent>
          </Card>
        ) : null}

        {selected && (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Sumar poziție</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex flex-col gap-2 font-mono text-xs">
                  <span>
                    <span className="text-muted-foreground">Cantitate:</span> {fmtQty(selected.qty)}
                  </span>
                  <span>
                    <span className="text-muted-foreground">Intrare medie:</span> {fmtPrice(selected.avgEntry)}
                  </span>
                  <span>
                    <span className="text-muted-foreground">USDC investit (la cost):</span>{" "}
                    {investedUsdcAtCost != null ? (
                      <span className="tabular-nums text-foreground">
                        {investedUsdcAtCost.toLocaleString("ro-RO", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{" "}
                        USDC
                      </span>
                    ) : (
                      "—"
                    )}
                  </span>
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    Cantitate × intrare medie (fără comisioane).
                  </p>
                  <span>
                    <span className="text-muted-foreground">Preț piață:</span>{" "}
                    {fmtPrice(wsTickerPrice != null && Number.isFinite(wsTickerPrice) ? wsTickerPrice : selected.markPrice)}
                    {wsTickerPrice != null && Number.isFinite(wsTickerPrice) ? (
                      <span className="ml-1 text-[10px] text-emerald-600/90">live</span>
                    ) : null}
                  </span>
                </div>
                {unrealized != null && Number.isFinite(unrealized) && (
                  <p className={unrealized >= 0 ? "text-emerald-600" : "text-red-600"}>
                    P&amp;L estimat (nemarcat): {unrealized >= 0 ? "+" : ""}
                    {unrealized.toFixed(4)} USDC
                  </p>
                )}
                {kind === "bot" ? (
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    SL/TP pentru bot sunt procente în strategie; editezi din pagina Bots.
                  </p>
                ) : null}
                {kind === "manual" &&
                selected?.aiPilotStrategy &&
                typeof selected.aiPilotStrategy === "object" ? (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-2.5 py-2 text-[11px] leading-snug">
                    <p className="font-medium text-amber-100">Strategie AI Pilot (buy)</p>
                    {selected.aiPilotStrategy.notaExecutive ? (
                      <p className="mt-1 text-muted-foreground">{selected.aiPilotStrategy.notaExecutive}</p>
                    ) : null}
                    {Array.isArray(selected.aiPilotStrategy.chartOverlaySpecs) &&
                    selected.aiPilotStrategy.chartOverlaySpecs.length > 0 ? (
                      <p className="mt-1 text-muted-foreground">
                        Indicatori:{" "}
                        {selected.aiPilotStrategy.chartOverlaySpecs.map((s) => s.title).join(" · ")}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {kind === "manual" && selected?.pair ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Tranzacții manuale (pereche)</CardTitle>
                  <CardDescription className="text-xs">
                    Pilot AI și ordine manuale pe {normPair(selected.pair)}; legate de bot dacă există bot pe
                    aceeași pereche (reîmprospătare ~14s)
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {manualPairTrades.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      Nici o înregistrare manuală pentru această pereche sau se încarcă.
                    </p>
                  ) : (
                    <ul className="max-h-64 space-y-2 overflow-y-auto pr-1 text-[11px]">
                      {manualPairTrades.map((t) => {
                        const pnlStr = fmtPnl(t.pnl);
                        const stLabel = TRADE_STATUS_RO[t.status] || t.status;
                        const pilotTag =
                          t.meta && typeof t.meta === "object" && t.meta.aiPilotControl;
                        return (
                          <li
                            key={t._id}
                            className="rounded-md border border-white/10 bg-black/15 px-2 py-1.5 font-mono leading-snug"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-1">
                              <span className="text-muted-foreground">{fmtLastRun(t.createdAt)}</span>
                              <span className="flex flex-wrap gap-1">
                                {pilotTag ? (
                                  <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-200">
                                    Pilot
                                  </Badge>
                                ) : null}
                                <Badge
                                  variant="outline"
                                  className={
                                    t.side === "buy"
                                      ? "border-emerald-500/35 text-[10px] text-emerald-200/95"
                                      : "border-rose-500/35 text-[10px] text-rose-200/95"
                                  }
                                >
                                  {t.side === "buy" ? "Cumpărare" : "Vânzare"}
                                </Badge>
                                <Badge variant="secondary" className="text-[10px] font-normal">
                                  {t.isPaper ? "Paper" : "Real"}
                                </Badge>
                                <Badge variant="outline" className="text-[10px] font-normal capitalize">
                                  {stLabel}
                                </Badge>
                              </span>
                            </div>
                            <div className="mt-1 text-foreground/95">
                              {fmtQty(t.quantity)} @ {fmtPrice(t.price)}
                              {t.botId ? (
                                <span className="ml-1 text-[10px] text-muted-foreground">
                                  · bot {String(t.botId).slice(-6)}
                                </span>
                              ) : null}
                              {pnlStr ? (
                                <span
                                  className={
                                    Number(t.pnl) >= 0 ? " text-emerald-600" : " text-red-600"
                                  }
                                >
                                  {" "}
                                  · PnL {pnlStr}
                                </span>
                              ) : null}
                            </div>
                            {t.errorMessage ? (
                              <p className="mt-1 text-[10px] text-red-400/95">{t.errorMessage}</p>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </CardContent>
              </Card>
            ) : null}

            {kind === "bot" && selected?.botId ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Tranzacții bot</CardTitle>
                  <CardDescription className="text-xs">
                    Ultimele ordine înregistrate de motor (reîmprospătare ~14s)
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {botTrades.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      Încă nu există înregistrări pentru acest bot sau se încarcă istoricul.
                    </p>
                  ) : (
                    <ul className="max-h-64 space-y-2 overflow-y-auto pr-1 text-[11px]">
                      {botTrades.map((t) => {
                        const pnlStr = fmtPnl(t.pnl);
                        const stLabel = TRADE_STATUS_RO[t.status] || t.status;
                        const pilotTag =
                          t.meta && typeof t.meta === "object" && t.meta.aiPilotControl;
                        return (
                          <li
                            key={t._id}
                            className="rounded-md border border-white/10 bg-black/15 px-2 py-1.5 font-mono leading-snug"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-1">
                              <span className="text-muted-foreground">{fmtLastRun(t.createdAt)}</span>
                              <span className="flex flex-wrap gap-1">
                                {pilotTag ? (
                                  <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-200">
                                    Pilot
                                  </Badge>
                                ) : null}
                                <Badge
                                  variant="outline"
                                  className={
                                    t.side === "buy"
                                      ? "border-emerald-500/35 text-[10px] text-emerald-200/95"
                                      : "border-rose-500/35 text-[10px] text-rose-200/95"
                                  }
                                >
                                  {t.side === "buy" ? "Cumpărare" : "Vânzare"}
                                </Badge>
                                <Badge variant="secondary" className="text-[10px] font-normal">
                                  {t.isPaper ? "Paper" : "Real"}
                                </Badge>
                                <Badge variant="outline" className="text-[10px] font-normal capitalize">
                                  {stLabel}
                                </Badge>
                              </span>
                            </div>
                            <div className="mt-1 text-foreground/95">
                              {fmtQty(t.quantity)} @ {fmtPrice(t.price)}
                              {pnlStr ? (
                                <span
                                  className={
                                    Number(t.pnl) >= 0 ? " text-emerald-600" : " text-red-600"
                                  }
                                >
                                  {" "}
                                  · PnL {pnlStr}
                                </span>
                              ) : null}
                            </div>
                            {t.errorMessage ? (
                              <p className="mt-1 text-[10px] text-red-400/95">{t.errorMessage}</p>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </CardContent>
              </Card>
            ) : null}

            {kind === "bot" && liveBotContext ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Ce face botul</CardTitle>
                  <CardDescription className="text-xs">
                    Strategie „{liveBotContext.strategyName ?? "—"}” · motor 15m (intrare/ieșire) la cron
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-xs">
                  <div className="flex flex-wrap gap-1.5">
                    {liveBotContext.strategySource ? (
                      <Badge variant="secondary" className="text-[10px] font-normal">
                        {STRATEGY_SOURCE_LABELS[liveBotContext.strategySource] ||
                          liveBotContext.strategySource}
                      </Badge>
                    ) : null}
                    {liveBotContext.strategySafeMode ? (
                      <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-200/90">
                        Safe mode
                      </Badge>
                    ) : null}
                    <Badge variant="outline" className="text-[10px] font-normal capitalize">
                      {liveBotContext.botMode === "real" ? "Binance real" : "Paper"}
                    </Badge>
                    {liveBotContext.futuresEnabled ? (
                      <Badge variant="outline" className="text-[10px]">
                        Futures
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        Spot
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    La cron: ~200 lumânări <span className="font-mono">15m</span> (intrare/ieșire), cu filtru trend din{" "}
                    <span className="font-mono">1d</span>.{" "}
                    <strong className="text-foreground">Intrare</strong> când{" "}
                    <span className="text-foreground">toate</span> regulile de intrare sunt îndeplinite;{" "}
                    <strong className="text-foreground">ieșire</strong> la{" "}
                    <span className="text-foreground">măcar o</span> regulă de ieșire (plus SL/TP % din Bots).
                  </p>
                  <div className="space-y-3">
                    <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Reguli intrare (AND)
                      </p>
                      {(liveBotContext.strategySummary?.entryLines?.length ?? 0) > 0 ? (
                        <ul className="list-inside list-disc space-y-1 text-[11px] text-foreground/95">
                          {liveBotContext.strategySummary.entryLines.map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[11px] text-muted-foreground">
                          Nu s-au putut afișa regulile. Editează în{" "}
                          <Link href="/strategies" className="font-medium text-primary underline underline-offset-2">
                            Strategii
                          </Link>
                          .
                        </p>
                      )}
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Reguli ieșire (OR)
                      </p>
                      {(liveBotContext.strategySummary?.exitLines?.length ?? 0) > 0 ? (
                        <ul className="list-inside list-disc space-y-1 text-[11px] text-foreground/95">
                          {liveBotContext.strategySummary.exitLines.map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[11px] text-muted-foreground">
                          Fără reguli de ieșire în strategie (doar SL/TP % dacă sunt setate).
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 border-t border-white/10 pt-2 font-mono text-[10px] text-muted-foreground">
                    <span>
                      SL%: <span className="text-foreground">{liveBotContext.risk?.stopLossPct ?? "—"}</span> · TP%:{" "}
                      <span className="text-foreground">{liveBotContext.risk?.takeProfitPct ?? "—"}</span>
                    </span>
                    <span>
                      Max. pierdere/zi %:{" "}
                      <span className="text-foreground">{liveBotContext.risk?.maxDailyLossPct ?? "—"}</span> · Mărime poz. %:{" "}
                      <span className="text-foreground">{liveBotContext.risk?.positionSizePct ?? "—"}</span>
                    </span>
                    <span>
                      Ultimul cron:{" "}
                      <span className="text-foreground">{fmtLastRun(liveBotContext.lastRun)}</span>
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground/90">
                    Status: <span className="capitalize text-foreground">{liveBotContext.botStatus}</span>.{" "}
                    <Link href="/bots" className="font-medium text-primary underline underline-offset-2">
                      Bots
                    </Link>
                  </p>
                  <div className="rounded-md border border-border/80 px-3 py-2">
                    <Label className="flex cursor-pointer items-start gap-2 text-[11px] leading-snug">
                      <input
                        type="checkbox"
                        className="mt-1 rounded border-input"
                        checked={autoProtectExec}
                        onChange={(e) => {
                          setAutoProtectExec(e.target.checked);
                          alertedRef.current = { sl: false, tp: false };
                          botSlTpAlertedRef.current = { sl: false, tp: false };
                        }}
                      />
                      Pe Live, la SL%/TP% (ca la cron) se închide poziția la market și botul se oprește — nu doar
                      afișare. Folosește același comutator ca la manual.
                    </Label>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {kind === "manual" && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Stop loss &amp; Take profit</CardTitle>
                  <CardDescription className="text-xs">
                    Prețuri absolute (aceeași cotă ca perechea). Goale = elimină ținta.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="live-sl">Stop loss</Label>
                      <Input
                        id="live-sl"
                        value={slInput}
                        onChange={(e) => setSlInput(e.target.value)}
                        placeholder="ex. 95000"
                        inputMode="decimal"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="live-tp">Take profit</Label>
                      <Input
                        id="live-tp"
                        value={tpInput}
                        onChange={(e) => setTpInput(e.target.value)}
                        placeholder="ex. 102000"
                        inputMode="decimal"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    <Button type="button" size="sm" onClick={() => saveProtections()} disabled={saving}>
                      {saving ? "…" : "Salvează ținte"}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => clearProtections()} disabled={saving}>
                      Șterge ținte
                    </Button>
                  </div>
                  {selected?.oco?.orderListId ? (
                    <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                      <div className="flex items-center gap-2 font-medium">
                        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                        OCO activ pe Binance
                      </div>
                      <div className="mt-1 opacity-80">
                        SL {Number(selected.oco.stopPrice).toFixed(6)} · TP{" "}
                        {Number(selected.oco.limitPrice).toFixed(6)} · qty{" "}
                        {Number(selected.oco.placedQty).toFixed(6)} ·{" "}
                        <span className="font-mono">#{selected.oco.orderListId}</span>
                      </div>
                      <div className="mt-1 opacity-70">
                        Binance execută SL/TP sub-secundă. La un „Închide poziția” sau închidere AI, OCO e anulat automat înainte de market sell.
                      </div>
                    </div>
                  ) : selected?.ocoLastError?.message ? (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                      <div className="font-medium">OCO pe Binance: eșec la plasare</div>
                      <div className="mt-1 break-words opacity-80">{selected.ocoLastError.message}</div>
                      <div className="mt-1 opacity-70">
                        Protecția rămâne doar pe partea app-ului (cron la 1 min). Verifică dacă perechea are MIN_NOTIONAL satisfăcut sau dacă soldul e blocat într-un alt ordin.
                      </div>
                    </div>
                  ) : null}
                  <div className="rounded-md border border-border/80 px-3 py-2">
                    <Label className="flex cursor-pointer items-start gap-2 text-xs leading-snug">
                      <input
                        type="checkbox"
                        className="mt-1 rounded border-input"
                        checked={autoProtectExec}
                        onChange={(e) => {
                          setAutoProtectExec(e.target.checked);
                          alertedRef.current = { sl: false, tp: false };
                          botSlTpAlertedRef.current = { sl: false, tp: false };
                        }}
                      />
                      Execuție automată SL/TP (implicit activ): la țintă se face market sell în modul poziției.
                      Preț din WebSocket sau reîmprospătare ~3s. Dezactivează dacă vrei doar afișare.
                    </Label>
                  </div>
                </CardContent>
              </Card>
            )}

          </>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { DEFAULT_SPOT_PAIR } from "@/lib/market-defaults";
import { PageHeader } from "@/components/shell/PageHeader";
import { BotsTradesColumn } from "@/components/BotsTradesColumn";
import { useSpotWallet } from "@/components/SpotWalletProvider";
import { cn } from "@/lib/utils";
import { Pencil, Trash2, Trash } from "lucide-react";
import "@/app/(shell)/bots/bots-dashboard.css";

const BOTS_PAGE_CACHE_KEY = "aitrade:botsPage:v1";
const BOTS_PAGE_CACHE_TTL_MS = 60_000;
const INDICATOR_OPTIONS = ["RSI", "EMA_CROSS", "MACD", "BOLLINGER", "SMA", "PRICE"];
const OPERATOR_OPTIONS_BY_INDICATOR = {
  RSI: ["<", ">", "<=", ">=", "between"],
  EMA_CROSS: ["cross_up", "cross_down", "bullish_state", "bearish_state"],
  MACD: ["cross_up", "cross_down", "hist_above", "hist_below"],
  BOLLINGER: ["touch_lower", "touch_upper", "inside_band", "outside_band"],
  SMA: ["<", ">", "<=", ">=", "cross_up", "cross_down"],
  PRICE: ["<", ">", "<=", ">=", "cross_up", "cross_down"],
};

function botOpenPositionInfo(b) {
  if (b.mode === "paper" && b.paperState?.open) {
    const qty = Number(b.paperState.baseBalance ?? 0);
    const avg = Number(b.paperState.avgEntry ?? 0);
    if (qty > 1e-12 && avg > 0) {
      return { has: true, qty, avg, paper: true };
    }
  }
  if (b.mode !== "paper" && b.positionState?.open) {
    const qty = Number(b.positionState.quantity ?? 0);
    const avg = Number(b.positionState.entryPrice ?? 0);
    if (qty > 1e-12 && avg > 0) {
      return { has: true, qty, avg, paper: false };
    }
  }
  return { has: false, qty: 0, avg: 0, paper: true };
}

function strategySelectValue(bot) {
  if (!bot?.strategyId) return "";
  if (typeof bot.strategyId === "object" && bot.strategyId?._id != null) {
    return String(bot.strategyId._id);
  }
  return String(bot.strategyId);
}

function strategyDefinitionTextById(strategies, strategyId) {
  if (!strategyId) return '{\n  "entry": [],\n  "exit": []\n}';
  const row = strategies.find((s) => String(s._id) === String(strategyId));
  if (!row?.definition || typeof row.definition !== "object") {
    return '{\n  "entry": [],\n  "exit": []\n}';
  }
  try {
    return JSON.stringify(row.definition, null, 2);
  } catch {
    return '{\n  "entry": [],\n  "exit": []\n}';
  }
}

function normalizeRuleValue(indicator, value) {
  if (value == null || value === "") return "";
  if (indicator === "EMA_CROSS" || indicator === "MACD" || indicator === "BOLLINGER") {
    return String(value);
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
}

function parseDefinitionForEditor(rawText) {
  try {
    const parsed = JSON.parse(String(rawText || ""));
    const entry = Array.isArray(parsed?.entry) ? parsed.entry : [];
    const exit = Array.isArray(parsed?.exit) ? parsed.exit : [];
    return { ok: true, entry, exit };
  } catch {
    return { ok: false, entry: [], exit: [] };
  }
}

function operatorOptionsForIndicator(indicator) {
  const key = String(indicator || "").toUpperCase();
  return OPERATOR_OPTIONS_BY_INDICATOR[key] || ["<", ">", "cross_up", "cross_down"];
}

function indicatorFieldVisibility(indicator) {
  const key = String(indicator || "").toUpperCase();
  if (key === "EMA_CROSS") return { period: false, fast: true, slow: true };
  if (key === "RSI" || key === "SMA" || key === "BOLLINGER") {
    return { period: true, fast: false, slow: false };
  }
  return { period: false, fast: false, slow: false };
}

export default function BotsPage() {
  const { loadWallet } = useSpotWallet();
  const [bots, setBots] = useState([]);
  const [strategies, setStrategies] = useState([]);
  const [pair, setPair] = useState(DEFAULT_SPOT_PAIR);
  const [strategyId, setStrategyId] = useState("");
  const [mode, setMode] = useState("paper");

  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editForm, setEditForm] = useState(null);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [stopTarget, setStopTarget] = useState(null);
  const [stopLoading, setStopLoading] = useState(false);
  const [deleteAllInactiveLoading, setDeleteAllInactiveLoading] = useState(false);

  const readBotsPageCache = useCallback(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(BOTS_PAGE_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (Date.now() - Number(parsed.updatedAt || 0) > BOTS_PAGE_CACHE_TTL_MS) return null;
      return {
        bots: Array.isArray(parsed.bots) ? parsed.bots : [],
        strategies: Array.isArray(parsed.strategies) ? parsed.strategies : [],
      };
    } catch {
      return null;
    }
  }, []);

  const writeBotsPageCache = useCallback((nextBots, nextStrategies) => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(
        BOTS_PAGE_CACHE_KEY,
        JSON.stringify({
          updatedAt: Date.now(),
          bots: Array.isArray(nextBots) ? nextBots : [],
          strategies: Array.isArray(nextStrategies) ? nextStrategies : [],
        })
      );
    } catch {
      // ignore quota/private mode
    }
  }, []);

  const notifyBotsDataChanged = useCallback(() => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("bots:data-changed"));
    }
  }, []);

  const refresh = useCallback(async ({ force = false } = {}) => {
    if (!force) {
      const cached = readBotsPageCache();
      if (cached) {
        setBots(cached.bots);
        setStrategies(cached.strategies);
        setStrategyId((cur) => cur || (cached.strategies?.[0] ? String(cached.strategies[0]._id) : ""));
      }
    }
    const [b, s] = await Promise.all([
      fetch("/api/bots").then((r) => r.json()),
      fetch("/api/strategies").then((r) => r.json()),
    ]);
    const nextBots = b.bots || [];
    const nextStrategies = s.strategies || [];
    setBots(nextBots);
    setStrategies(nextStrategies);
    setStrategyId((cur) => cur || (nextStrategies?.[0] ? String(nextStrategies[0]._id) : ""));
    writeBotsPageCache(nextBots, nextStrategies);
  }, [readBotsPageCache, writeBotsPageCache]);

  useEffect(() => {
    refresh({ force: false }).catch(() => toast.error("Încărcare eșuată"));
  }, [refresh]);

  function openEdit(bot) {
    if (bot.status === "active") {
      toast.info("Oprește botul înainte de editare.");
      return;
    }
    const sid = strategySelectValue(bot);
    const definitionText = strategyDefinitionTextById(strategies, sid);
    setEditForm({
      id: String(bot._id),
      strategyId: sid,
      pair: bot.pair || DEFAULT_SPOT_PAIR,
      mode: bot.mode || "paper",
      status: bot.status || "stopped",
      stopLossPct: Number(bot.risk?.stopLossPct ?? 2),
      takeProfitPct: Number(bot.risk?.takeProfitPct ?? 3),
      maxDailyLossPct: Number(bot.risk?.maxDailyLossPct ?? 5),
      positionSizePct: Number(bot.risk?.positionSizePct ?? 10),
      initialStrategyId: sid,
      strategyDefinitionText: definitionText,
      initialStrategyDefinitionText: definitionText,
      definitionEditorError: "",
    });
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!editForm) return;
    setEditSaving(true);
    try {
      const body = {
        pair: editForm.pair.trim(),
        mode: editForm.mode,
        risk: {
          stopLossPct: Number(editForm.stopLossPct),
          takeProfitPct: Number(editForm.takeProfitPct),
          maxDailyLossPct: Number(editForm.maxDailyLossPct),
          positionSizePct: Number(editForm.positionSizePct),
        },
      };
      const strategyIdForSave = String(editForm.strategyId || "").trim();
      const rawDefinition = String(editForm.strategyDefinitionText || "").trim();
      if (strategyIdForSave && rawDefinition) {
        let parsedDefinition;
        try {
          parsedDefinition = JSON.parse(rawDefinition);
        } catch {
          toast.error("Indicatori strategie: JSON invalid");
          return;
        }
        if (
          rawDefinition !== String(editForm.initialStrategyDefinitionText || "") ||
          strategyIdForSave !== String(editForm.initialStrategyId || "")
        ) {
          const rStrategy = await fetch(`/api/strategies/${strategyIdForSave}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ definition: parsedDefinition }),
          });
          const jStrategy = await rStrategy.json().catch(() => ({}));
          if (!rStrategy.ok) {
            toast.error(
              typeof jStrategy.error === "string"
                ? jStrategy.error
                : "Actualizare indicatori strategie eșuată"
            );
            return;
          }
        }
      }
      if (editForm.strategyId !== editForm.initialStrategyId) {
        body.strategyId = editForm.strategyId;
      }
      const r = await fetch(`/api/bots/${editForm.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error(typeof j.error === "string" ? j.error : "Actualizare eșuată");
        return;
      }
      toast.success("Bot actualizat");
      setEditOpen(false);
      setEditForm(null);
      await refresh({ force: true });
      notifyBotsDataChanged();
    } catch {
      toast.error("Eroare rețea");
    } finally {
      setEditSaving(false);
    }
  }

  async function deleteAllInactiveBots() {
    const n = bots.filter((b) => b.status !== "active").length;
    if (n === 0) {
      toast.info("Nu există boți opriți sau în pauză de șters.");
      return;
    }
    if (
      !window.confirm(
        `Ștergi definitiv ${n} bot(uri) care nu sunt activi (oprit / pauză)? Boții cu status „active” nu sunt modificați.`
      )
    ) {
      return;
    }
    setDeleteAllInactiveLoading(true);
    try {
      const r = await fetch("/api/bots/delete-inactive", { method: "POST" });
      const j = await r.json();
      if (!r.ok) {
        toast.error(typeof j.error === "string" ? j.error : "Ștergere eșuată");
        return;
      }
      const deleted = typeof j.deletedCount === "number" ? j.deletedCount : 0;
      toast.success(`Șterși ${deleted} bot(uri).`);
      await refresh({ force: true });
      notifyBotsDataChanged();
      void loadWallet({ silent: true });
    } catch {
      toast.error("Eroare rețea");
    } finally {
      setDeleteAllInactiveLoading(false);
    }
  }

  async function confirmDeleteBot() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const r = await fetch(`/api/bots/${deleteTarget._id}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) {
        toast.error(typeof j.error === "string" ? j.error : "Ștergere eșuată");
        return;
      }
      toast.success("Bot șters");
      setDeleteTarget(null);
      await refresh({ force: true });
      notifyBotsDataChanged();
    } catch {
      toast.error("Eroare rețea");
    } finally {
      setDeleteLoading(false);
    }
  }

  async function createBot(e) {
    e.preventDefault();
    const r = await fetch("/api/bots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strategyId, pair, mode }),
    });
    const j = await r.json();
    if (!r.ok) {
      toast.error(typeof j.error === "string" ? j.error : "Creare eșuată");
      return;
    }
    toast.success("Bot creat");
    await refresh({ force: true });
    notifyBotsDataChanged();
  }

  async function startBot(id) {
    const r = await fetch(`/api/bots/${id}/start`, { method: "POST" });
    const j = await r.json();
    if (!r.ok) {
      toast.error(typeof j.error === "string" ? j.error : "Start eșuat");
      return;
    }
    toast.success("Pornit");
    void loadWallet({ silent: true });
    await refresh({ force: true });
    notifyBotsDataChanged();
  }

  async function stopBotRequest(id, disposition) {
    const r = await fetch(`/api/bots/${id}/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(disposition ? { disposition } : {}),
    });
    const j = await r.json();
    if (!r.ok) {
      toast.error(typeof j.error === "string" ? j.error : "Stop eșuat");
      return false;
    }
    if (j.action === "closed_market") toast.success("Bot oprit — poziție închisă (sell).");
    else if (j.action === "released_to_manual") toast.success("Bot oprit — poziția apare la Live ca manuală.");
    else toast.success("Bot oprit");
    void loadWallet({ silent: true });
    return true;
  }

  async function onClickStop(b) {
    const pos = botOpenPositionInfo(b);
    if (!pos.has) {
      if (await stopBotRequest(b._id, undefined)) await refresh();
      return;
    }
    setStopTarget(b);
  }

  async function confirmStopChoice(disposition) {
    if (!stopTarget) return;
    setStopLoading(true);
    try {
        if (await stopBotRequest(stopTarget._id, disposition)) {
        setStopTarget(null);
          await refresh({ force: true });
        notifyBotsDataChanged();
      }
    } finally {
      setStopLoading(false);
    }
  }

  const stopPosDetail = stopTarget ? botOpenPositionInfo(stopTarget) : null;

  return (
    <div className="bots-dashboard space-y-8">
      <header className="bots-hero">
        <div className="bots-hero-inner">
          <PageHeader
            title="Bots"
            description="La Stop, dacă ai poziție deschisă, poți închide prin sell (paper simulat / real pe Binance) sau muta poziția în Live ca tranzacție manuală (doar spot). În dreapta: istoric tranzacții asociate boților."
          />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,400px)] xl:gap-8 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-8">
      <Card className="bots-card-shell">
        <CardHeader>
          <CardTitle>Bot nou</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={createBot}>
            <div className="space-y-2">
              <Label>Strategie</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={strategyId}
                onChange={(e) => setStrategyId(e.target.value)}
              >
                {strategies.length === 0 ? (
                  <option value="">— Nicio strategie —</option>
                ) : null}
                {strategies.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Pereche</Label>
              <Input value={pair} onChange={(e) => setPair(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Mod</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
              >
                <option value="paper">Paper</option>
                <option value="real">Real (necesită chei API)</option>
              </select>
            </div>
            <div className="flex items-end">
              <Button type="submit" className="w-full md:w-auto" disabled={!strategyId}>
                Creează bot
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {bots.length > 0
            ? `${bots.filter((b) => b.status === "active").length} activi · ${bots.filter((b) => b.status !== "active").length} opriți / pauză`
            : "Niciun bot încă."}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={
            deleteAllInactiveLoading || bots.filter((b) => b.status !== "active").length === 0
          }
          className="shrink-0 border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300"
          onClick={() => void deleteAllInactiveBots()}
        >
          <Trash className="mr-2 h-3.5 w-3.5" />
          {deleteAllInactiveLoading ? "Se șterge…" : "Șterge toți boții opriți"}
        </Button>
      </div>

      <div className="space-y-3">
        {bots.map((b) => {
          const running = b.status === "active";
          return (
          <Card key={b._id} className="bots-card-shell">
            <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{b.pair}</span>
                  <Badge>{b.status}</Badge>
                  <Badge variant="outline">{b.mode}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Strategie: {typeof b.strategyId === "object" && b.strategyId?.name
                    ? b.strategyId.name
                    : b.strategyId}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  disabled={running}
                  title={running ? "Oprește botul ca să poți edita." : "Editează botul"}
                  className={cn(running && "opacity-50")}
                  onClick={() => openEdit(b)}
                >
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  Editează
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  disabled={running}
                  title={running ? "Oprește botul ca să poți șterge." : "Șterge botul"}
                  className={cn(
                    "border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300",
                    running && "opacity-50"
                  )}
                  onClick={() => setDeleteTarget(b)}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Șterge
                </Button>
                {b.status !== "active" ? (
                  <Button size="sm" type="button" onClick={() => startBot(b._id)}>
                    Start
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" type="button" onClick={() => onClickStop(b)}>
                    Stop
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
        })}
      </div>

        </div>
        <aside className="min-w-0">
          <BotsTradesColumn className="bots-card-shell" />
        </aside>
      </div>

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          if (!editSaving) {
            setEditOpen(open);
            if (!open) setEditForm(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto border-white/12 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editează bot</DialogTitle>
            <DialogDescription>
              Pereche, mod, risc (SL/TP %). Strategia se schimbă doar dacă botul e oprit.
            </DialogDescription>
          </DialogHeader>
          {editForm ? (
            <div className="grid gap-3 py-1">
              <div className="space-y-1.5">
                <Label className="text-xs">Strategie</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={editForm.strategyId}
                  onChange={(e) =>
                    setEditForm((f) =>
                      f
                        ? {
                            ...f,
                            strategyId: e.target.value,
                            strategyDefinitionText: strategyDefinitionTextById(strategies, e.target.value),
                          }
                        : f
                    )
                  }
                >
                  {strategies.map((s) => (
                    <option key={s._id} value={String(s._id)}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Indicatori strategie (JSON)</Label>
                {(() => {
                  const parsed = parseDefinitionForEditor(editForm.strategyDefinitionText);
                  const updateRules = (side, nextRules) => {
                    if (!parsed.ok) return;
                    const next = {
                      entry: side === "entry" ? nextRules : parsed.entry,
                      exit: side === "exit" ? nextRules : parsed.exit,
                    };
                    setEditForm((f) =>
                      f
                        ? {
                            ...f,
                            strategyDefinitionText: JSON.stringify(next, null, 2),
                            definitionEditorError: "",
                          }
                        : f
                    );
                  };
                  const updateRuleField = (side, idx, field, val) => {
                    const list = side === "entry" ? [...parsed.entry] : [...parsed.exit];
                    const cur = { ...(list[idx] || {}) };
                    if (field === "indicator") {
                      const nextIndicator = String(val || "").toUpperCase();
                      cur[field] = nextIndicator;
                      const allowedOperators = operatorOptionsForIndicator(nextIndicator);
                      if (!allowedOperators.includes(String(cur.operator || ""))) {
                        cur.operator = allowedOperators[0];
                      }
                      cur.value = normalizeRuleValue(nextIndicator, cur.value);
                      const visible = indicatorFieldVisibility(nextIndicator);
                      if (!visible.period) delete cur.period;
                      if (!visible.fast) delete cur.fast;
                      if (!visible.slow) delete cur.slow;
                      if (visible.period && cur.period == null) cur.period = 14;
                      if (visible.fast && cur.fast == null) cur.fast = 9;
                      if (visible.slow && cur.slow == null) cur.slow = 21;
                    } else if (field === "value") {
                      cur[field] = normalizeRuleValue(cur.indicator, val);
                    } else if (["period", "fast", "slow"].includes(field)) {
                      const n = Number(val);
                      cur[field] = Number.isFinite(n) ? n : val;
                    } else {
                      cur[field] = val;
                    }
                    list[idx] = cur;
                    updateRules(side, list);
                  };
                  const addRule = (side) => {
                    const list = side === "entry" ? [...parsed.entry] : [...parsed.exit];
                    list.push({ indicator: "RSI", operator: "<", value: 30, period: 14 });
                    updateRules(side, list);
                  };
                  const removeRule = (side, idx) => {
                    const list = side === "entry" ? [...parsed.entry] : [...parsed.exit];
                    list.splice(idx, 1);
                    updateRules(side, list);
                  };

                  if (!parsed.ok) {
                    return (
                      <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                        JSON invalid: corectează definiția pentru a folosi editorul vizual.
                      </p>
                    );
                  }

                  const RuleSection = ({ title, side, rules }) => (
                    <div className="space-y-2 rounded-md border border-border/70 bg-background/40 p-2">
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {title}
                        </p>
                        <Button type="button" size="sm" variant="outline" onClick={() => addRule(side)}>
                          + regulă
                        </Button>
                      </div>
                      {rules.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground">Nicio regulă.</p>
                      ) : (
                        <div className="space-y-2">
                          {rules.map((rule, idx) => (
                            <div key={`${side}-${idx}`} className="grid gap-2 rounded border border-border/60 p-2">
                              {(() => {
                                const visible = indicatorFieldVisibility(rule.indicator);
                                return (
                                  <>
                              <div className="grid gap-2 sm:grid-cols-2">
                                <select
                                  value={String(rule.indicator ?? "RSI").toUpperCase()}
                                  onChange={(e) => updateRuleField(side, idx, "indicator", e.target.value)}
                                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                                >
                                  {INDICATOR_OPTIONS.map((opt) => (
                                    <option key={opt} value={opt}>
                                      {opt}
                                    </option>
                                  ))}
                                </select>
                                <select
                                  value={String(rule.operator ?? "")}
                                  onChange={(e) => updateRuleField(side, idx, "operator", e.target.value)}
                                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                                >
                                  {operatorOptionsForIndicator(rule.indicator).map((opt) => (
                                    <option key={opt} value={opt}>
                                      {opt}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="grid gap-2 sm:grid-cols-4">
                                <Input
                                  value={rule.value ?? ""}
                                  onChange={(e) => updateRuleField(side, idx, "value", e.target.value)}
                                  placeholder="value"
                                  className="h-8 text-xs"
                                />
                                {visible.period ? (
                                  <Input
                                    value={rule.period ?? ""}
                                    onChange={(e) => updateRuleField(side, idx, "period", e.target.value)}
                                    placeholder="period"
                                    className="h-8 text-xs"
                                  />
                                ) : null}
                                {visible.fast ? (
                                  <Input
                                    value={rule.fast ?? ""}
                                    onChange={(e) => updateRuleField(side, idx, "fast", e.target.value)}
                                    placeholder="fast"
                                    className="h-8 text-xs"
                                  />
                                ) : null}
                                {visible.slow ? (
                                  <Input
                                    value={rule.slow ?? ""}
                                    onChange={(e) => updateRuleField(side, idx, "slow", e.target.value)}
                                    placeholder="slow"
                                    className="h-8 text-xs"
                                  />
                                ) : null}
                              </div>
                              <div className="flex justify-end">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                                  onClick={() => removeRule(side, idx)}
                                >
                                  Șterge
                                </Button>
                              </div>
                                  </>
                                );
                              })()}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );

                  return (
                    <div className="space-y-2">
                      <RuleSection title="Entry rules" side="entry" rules={parsed.entry} />
                      <RuleSection title="Exit rules" side="exit" rules={parsed.exit} />
                    </div>
                  );
                })()}
                <textarea
                  className="min-h-[180px] w-full rounded-md border border-input bg-background p-3 font-mono text-xs"
                  value={editForm.strategyDefinitionText || ""}
                  onChange={(e) =>
                    setEditForm((f) => (f ? { ...f, strategyDefinitionText: e.target.value } : f))
                  }
                />
                <p className="text-[11px] text-muted-foreground">
                  Poți ajusta regulile de indicatori direct aici; se salvează împreună cu botul.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Pereche</Label>
                <Input
                  value={editForm.pair}
                  onChange={(e) => setEditForm((f) => (f ? { ...f, pair: e.target.value } : f))}
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Mod</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={editForm.mode}
                  onChange={(e) => setEditForm((f) => (f ? { ...f, mode: e.target.value } : f))}
                >
                  <option value="paper">Paper</option>
                  <option value="real">Real</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Stop loss %</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={editForm.stopLossPct}
                    onChange={(e) =>
                      setEditForm((f) => (f ? { ...f, stopLossPct: Number(e.target.value) } : f))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Take profit %</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={editForm.takeProfitPct}
                    onChange={(e) =>
                      setEditForm((f) => (f ? { ...f, takeProfitPct: Number(e.target.value) } : f))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Max pierdere/zi %</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={editForm.maxDailyLossPct}
                    onChange={(e) =>
                      setEditForm((f) => (f ? { ...f, maxDailyLossPct: Number(e.target.value) } : f))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Mărime poz. %</Label>
                  <Input
                    type="number"
                    step="0.5"
                    min="0.5"
                    value={editForm.positionSizePct}
                    onChange={(e) =>
                      setEditForm((f) => (f ? { ...f, positionSizePct: Number(e.target.value) } : f))
                    }
                  />
                </div>
              </div>
            </div>
          ) : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" disabled={editSaving} onClick={() => setEditOpen(false)}>
              Anulează
            </Button>
            <Button type="button" disabled={editSaving || !editForm} onClick={saveEdit}>
              {editSaving ? "Se salvează…" : "Salvează"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!deleteLoading && !open) setDeleteTarget(null);
        }}
      >
        <DialogContent
          className="border-white/12 sm:max-w-md"
          onPointerDownOutside={(e) => deleteLoading && e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Ștergi botul?</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              Botul{" "}
              <span className="font-mono font-medium text-foreground">
                {deleteTarget?.pair || "—"}
              </span>{" "}
              va fi eliminat definitiv. Acțiunea nu poate fi anulată.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" disabled={deleteLoading} onClick={() => setDeleteTarget(null)}>
              Anulează
            </Button>
            <Button
              type="button"
              className="bg-red-600 text-white hover:bg-red-500"
              disabled={deleteLoading}
              onClick={confirmDeleteBot}
            >
              {deleteLoading ? "Se șterge…" : "Șterge definitiv"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={stopTarget != null}
        onOpenChange={(open) => {
          if (!stopLoading && !open) setStopTarget(null);
        }}
      >
        <DialogContent
          className="border-white/12 sm:max-w-lg"
          onPointerDownOutside={(e) => stopLoading && e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Oprești botul?</DialogTitle>
            <DialogDescription className="space-y-2 text-sm leading-relaxed">
              {stopTarget ? (
                <>
                  <span className="block">
                    Pereche{" "}
                    <span className="font-mono font-medium text-foreground">{stopTarget.pair}</span>
                    {stopPosDetail?.has ? (
                      <>
                        {" "}
                        — poziție deschisă ~{" "}
                        <span className="font-mono text-foreground">{stopPosDetail.qty.toFixed(6)}</span> @ mediu{" "}
                        <span className="font-mono text-foreground">{stopPosDetail.avg.toFixed(4)}</span> (
                        {stopTarget.mode === "paper" ? "paper" : "real"})
                      </>
                    ) : null}
                  </span>
                  <span className="block text-muted-foreground">
                    Alege dacă închizi tranzacția (vânzare) sau păstrezi activele și gestionezi manual în Live.
                  </span>
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-1">
            <Button
              type="button"
              className="h-auto flex-col items-start gap-1 py-3 text-left"
              variant="secondary"
              disabled={stopLoading}
              onClick={() => confirmStopChoice("close_market")}
            >
              <span className="font-medium">Închide poziția (sell market)</span>
              <span className="text-xs font-normal text-muted-foreground">
                {stopTarget?.mode === "paper"
                  ? "Simulare: vinzi la prețul pieței actuale și actualizezi jurnalul paper."
                  : "Trimite ordin de vânzare pe Binance pentru întreaga cantitate."}
              </span>
            </Button>
            <Button
              type="button"
              className="h-auto flex-col items-start gap-1 border-violet-500/35 py-3 text-left"
              variant="outline"
              disabled={stopLoading || Boolean(stopTarget?.futuresEnabled)}
              title={
                stopTarget?.futuresEnabled
                  ? "Eliberarea la manual e doar pentru boturi spot."
                  : "Mută în manualSpotBook — vezi poziția la Live Trading."
              }
              onClick={() => confirmStopChoice("manual")}
            >
              <span className="font-medium">Trec la tranzacții manuale (Live)</span>
              <span className="text-xs font-normal text-muted-foreground">
                {stopTarget?.futuresEnabled
                  ? "Indisponibil pentru futures — folosește închiderea prin sell sau exchange-ul."
                  : "Botul se oprește; păstrezi cantitatea și prețul mediu în cont — nu se trimite sell automat."}
              </span>
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={stopLoading} onClick={() => setStopTarget(null)}>
              Anulează
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

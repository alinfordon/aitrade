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
import { Pencil, Trash2 } from "lucide-react";

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

  const refresh = useCallback(async () => {
    const [b, s] = await Promise.all([
      fetch("/api/bots").then((r) => r.json()),
      fetch("/api/strategies").then((r) => r.json()),
    ]);
    setBots(b.bots || []);
    setStrategies(s.strategies || []);
    setStrategyId((cur) => cur || (s.strategies?.[0] ? String(s.strategies[0]._id) : ""));
  }, []);

  useEffect(() => {
    refresh().catch(() => toast.error("Încărcare eșuată"));
  }, [refresh]);

  function openEdit(bot) {
    if (bot.status === "active") {
      toast.info("Oprește botul înainte de editare.");
      return;
    }
    const sid = strategySelectValue(bot);
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
      await refresh();
    } catch {
      toast.error("Eroare rețea");
    } finally {
      setEditSaving(false);
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
      await refresh();
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
    refresh();
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
    refresh();
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
        await refresh();
      }
    } finally {
      setStopLoading(false);
    }
  }

  const stopPosDetail = stopTarget ? botOpenPositionInfo(stopTarget) : null;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Bots"
        description="La Stop, dacă ai poziție deschisă, poți închide prin sell (paper simulat / real pe Binance) sau muta poziția în Live ca tranzacție manuală (doar spot). În dreapta: istoric tranzacții asociate boților."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,400px)] xl:gap-8 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-8">
      <Card>
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

      <div className="space-y-3">
        {bots.map((b) => {
          const running = b.status === "active";
          return (
          <Card key={b._id}>
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
          <BotsTradesColumn />
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
                  onChange={(e) => setEditForm((f) => (f ? { ...f, strategyId: e.target.value } : f))}
                >
                  {strategies.map((s) => (
                    <option key={s._id} value={String(s._id)}>
                      {s.name}
                    </option>
                  ))}
                </select>
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

"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { AiPilotRunSummary } from "@/components/AiPilotRunSummary";
import { cn } from "@/lib/utils";

export function AiPilotPanel({ className } = {}) {
  const [pilotCanUse, setPilotCanUse] = useState(false);
  const [pilotLoading, setPilotLoading] = useState(true);
  const [pilotSaving, setPilotSaving] = useState(false);
  const [pilotBots, setPilotBots] = useState([]);
  const [pilotEnabled, setPilotEnabled] = useState(false);
  const [pilotInterval, setPilotInterval] = useState(15);
  const [pilotMaxUsdc, setPilotMaxUsdc] = useState(150);
  const [pilotOrderMode, setPilotOrderMode] = useState("paper");
  const [pilotManual, setPilotManual] = useState(false);
  const [pilotMomentumGuardEnabled, setPilotMomentumGuardEnabled] = useState(true);
  const [pilotMomentumGuardStrictness, setPilotMomentumGuardStrictness] = useState("balanced");
  const [pilotMomentumGuardCustomEnabled, setPilotMomentumGuardCustomEnabled] = useState(false);
  const [pilotMomentumGuardMinLastChangePct, setPilotMomentumGuardMinLastChangePct] = useState(0.05);
  const [pilotMomentumGuardMinAccelerationPct, setPilotMomentumGuardMinAccelerationPct] = useState(-0.05);
  const [pilotMomentumGuardMaxDrawdownFromHighPct, setPilotMomentumGuardMaxDrawdownFromHighPct] = useState(2.5);
  const [pilotCreateBot, setPilotCreateBot] = useState(false);
  const [pilotMaxTradesRun, setPilotMaxTradesRun] = useState(3);
  const [pilotMaxManualOpen, setPilotMaxManualOpen] = useState(3);
  const [pilotMaxPilotBots, setPilotMaxPilotBots] = useState(5);
  const [pilotManualLiveAi, setPilotManualLiveAi] = useState(false);
  const [pilotManualLiveInterval, setPilotManualLiveInterval] = useState(5);
  const [pilotSelected, setPilotSelected] = useState(() => new Set());
  const [pilotLastSummary, setPilotLastSummary] = useState("");
  const [pilotLastError, setPilotLastError] = useState("");
  const [pilotLastRun, setPilotLastRun] = useState(null);

  const loadPilot = useCallback(async () => {
    setPilotLoading(true);
    try {
      const r = await fetch("/api/user/ai-pilot");
      const j = await r.json();
      if (!r.ok) {
        throw new Error(typeof j.error === "string" ? j.error : "Pilot: eroare");
      }
      setPilotCanUse(Boolean(j.canUse));
      const s = j.settings || {};
      setPilotEnabled(Boolean(s.enabled));
      setPilotInterval(Number(s.intervalMinutes) || 15);
      setPilotMaxUsdc(Number(s.maxUsdcPerTrade) || 150);
      setPilotOrderMode(s.pilotOrderMode === "real" ? "real" : "paper");
      setPilotManual(Boolean(s.manualTradingEnabled));
      setPilotMomentumGuardEnabled(s.momentumGuardEnabled !== false);
      setPilotMomentumGuardStrictness(
        ["permissive", "balanced", "strict"].includes(String(s.momentumGuardStrictness))
          ? String(s.momentumGuardStrictness)
          : "balanced"
      );
      setPilotMomentumGuardCustomEnabled(Boolean(s.momentumGuardCustomEnabled));
      setPilotMomentumGuardMinLastChangePct(
        Number.isFinite(Number(s.momentumGuardMinLastChangePct)) ? Number(s.momentumGuardMinLastChangePct) : 0.05
      );
      setPilotMomentumGuardMinAccelerationPct(
        Number.isFinite(Number(s.momentumGuardMinAccelerationPct)) ? Number(s.momentumGuardMinAccelerationPct) : -0.05
      );
      setPilotMomentumGuardMaxDrawdownFromHighPct(
        Number.isFinite(Number(s.momentumGuardMaxDrawdownFromHighPct))
          ? Number(s.momentumGuardMaxDrawdownFromHighPct)
          : 2.5
      );
      setPilotCreateBot(Boolean(s.createBotFromAnalysis));
      setPilotMaxTradesRun(Math.min(20, Math.max(1, Number(s.maxTradesPerRun) || 3)));
      setPilotMaxManualOpen(Math.min(20, Math.max(1, Number(s.maxOpenManualPositions) || 3)));
      setPilotMaxPilotBots(Math.min(20, Math.max(1, Number(s.maxPilotBots) || 5)));
      setPilotManualLiveAi(Boolean(s.manualLiveAiEnabled));
      setPilotManualLiveInterval(Math.min(30, Math.max(2, Number(s.manualLiveIntervalMinutes) || 5)));
      setPilotLastSummary(String(s.lastSummary || ""));
      setPilotLastError(String(s.lastError || ""));
      setPilotLastRun(s.lastRunAt || null);
      setPilotSelected(new Set((s.botIds || []).map(String)));
      setPilotBots(Array.isArray(j.bots) ? j.bots : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Pilot AI");
    } finally {
      setPilotLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPilot();
  }, [loadPilot]);

  function togglePilotBot(id) {
    setPilotSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function savePilot(e) {
    e.preventDefault();
    setPilotSaving(true);
    try {
      const botIdOk = new Set(pilotBots.map((b) => String(b.id)));
      const botIdsPayload = [...new Set(Array.from(pilotSelected).map(String))].filter((id) =>
        botIdOk.has(id)
      );
      const r = await fetch("/api/user/ai-pilot", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: pilotEnabled,
          intervalMinutes: pilotInterval,
          maxUsdcPerTrade: pilotMaxUsdc,
          pilotOrderMode,
          manualTradingEnabled: pilotManual,
          momentumGuardEnabled: pilotMomentumGuardEnabled,
          momentumGuardStrictness: pilotMomentumGuardStrictness,
          momentumGuardCustomEnabled: pilotMomentumGuardCustomEnabled,
          momentumGuardMinLastChangePct: pilotMomentumGuardMinLastChangePct,
          momentumGuardMinAccelerationPct: pilotMomentumGuardMinAccelerationPct,
          momentumGuardMaxDrawdownFromHighPct: pilotMomentumGuardMaxDrawdownFromHighPct,
          createBotFromAnalysis: pilotCreateBot,
          maxTradesPerRun: pilotMaxTradesRun,
          maxOpenManualPositions: pilotMaxManualOpen,
          maxPilotBots: pilotMaxPilotBots,
          manualLiveAiEnabled: pilotManualLiveAi,
          manualLiveIntervalMinutes: pilotManualLiveInterval,
          botIds: botIdsPayload,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error(typeof j.error === "string" ? j.error : "Salvare eșuată");
        return;
      }
      if (j.prunedStaleBotIds) {
        toast.info("Unele boți selectați nu mai existau — lista pilot a fost curățată.");
      }
      toast.success("Setări AI Pilot salvate");
      await loadPilot();
    } finally {
      setPilotSaving(false);
    }
  }

  return (
    <Card id="ai-pilot" className={cn(className)}>
      <CardHeader>
        <CardTitle>AI Pilot (cron)</CardTitle>
        <CardDescription>
          La intervalul setat, job-ul analizează piața USDC: gestionează boții selectați, poate deschide/închide
          poziții în{" "}
          <strong className="font-medium text-foreground">manual spot</strong> (cartea Live), poate crea{" "}
          <strong className="font-medium text-foreground">strategie + bot nou</strong> din analiză. Limitezi
          acțiunile pe rundă (cumpărări/vânzări manuale + creare bot) și perechile manuale maxime deschise.           Cron principal:{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">/api/cron/ai-pilot</code>
          {" · "}
          cron Live manual (vânzări):{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">/api/cron/ai-pilot-manual-live</code> +{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">CRON_SECRET</code>. Nu este sfat financiar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {pilotLoading ? (
          <p className="text-sm text-muted-foreground">Se încarcă…</p>
        ) : !pilotCanUse ? (
          <p className="text-sm text-muted-foreground">AI Pilot este disponibil pe planurile Pro și Elite.</p>
        ) : (
          <form className="max-w-lg space-y-4" onSubmit={savePilot}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={pilotEnabled}
                onChange={(e) => setPilotEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Pilot activ (necesită cron extern sau Vercel Cron)
            </label>
            <div className="space-y-2">
              <Label>Mod ordine pilot (manual + bot nou)</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={pilotOrderMode}
                onChange={(e) => setPilotOrderMode(e.target.value)}
              >
                <option value="paper">Paper</option>
                <option value="real">Real (necesită chei API)</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={pilotManual}
                onChange={(e) => setPilotManual(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Tranzacții manuale (cartea spot / Live) orchestrate de pilot
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={pilotMomentumGuardEnabled}
                onChange={(e) => setPilotMomentumGuardEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Guard anti-intrări târzii pe 15m (re-entry după vârf / decelerare)
            </label>
            <div className="space-y-2">
              <Label>Strictness guard</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
                value={pilotMomentumGuardStrictness}
                disabled={!pilotMomentumGuardEnabled}
                onChange={(e) => setPilotMomentumGuardStrictness(e.target.value)}
              >
                <option value="permissive">Permisiv</option>
                <option value="balanced">Echilibrat</option>
                <option value="strict">Strict</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={pilotMomentumGuardCustomEnabled}
                disabled={!pilotMomentumGuardEnabled}
                onChange={(e) => setPilotMomentumGuardCustomEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-input disabled:opacity-50"
              />
              Custom thresholds (praguri numeric)
            </label>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Min urcare</Label>
                <Input
                  type="number"
                  step={0.01}
                  min={0}
                  max={1}
                  disabled={!pilotMomentumGuardEnabled || !pilotMomentumGuardCustomEnabled}
                  value={pilotMomentumGuardMinLastChangePct}
                  onChange={(e) => setPilotMomentumGuardMinLastChangePct(Number(e.target.value))}
                />
                <p className="text-[11px] text-muted-foreground">în % (ex. 0.05)</p>
              </div>
              <div className="space-y-2">
                <Label>Decelerare tolerată</Label>
                <Input
                  type="number"
                  step={0.01}
                  min={-1}
                  max={0}
                  disabled={!pilotMomentumGuardEnabled || !pilotMomentumGuardCustomEnabled}
                  value={pilotMomentumGuardMinAccelerationPct}
                  onChange={(e) => setPilotMomentumGuardMinAccelerationPct(Number(e.target.value))}
                />
                <p className="text-[11px] text-muted-foreground">în % (negativ)</p>
              </div>
              <div className="space-y-2">
                <Label>Max drawdown</Label>
                <Input
                  type="number"
                  step={0.1}
                  min={0.1}
                  max={20}
                  disabled={!pilotMomentumGuardEnabled || !pilotMomentumGuardCustomEnabled}
                  value={pilotMomentumGuardMaxDrawdownFromHighPct}
                  onChange={(e) => setPilotMomentumGuardMaxDrawdownFromHighPct(Number(e.target.value))}
                />
                <p className="text-[11px] text-muted-foreground">în % sub vârf</p>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={pilotManualLiveAi}
                onChange={(e) => setPilotManualLiveAi(e.target.checked)}
                disabled={!pilotManual || pilotOrderMode !== "real"}
                className="h-4 w-4 rounded border-input disabled:opacity-50"
              />
              Verificare AI separată pentru poziții manuale Live (doar vânzări, la interval mai scurt)
            </label>
            <div className="space-y-2">
              <Label>Interval verificare Live manual (minute)</Label>
              <Input
                type="number"
                min={2}
                max={30}
                disabled={!pilotManualLiveAi || pilotOrderMode !== "real"}
                value={pilotManualLiveInterval}
                onChange={(e) => setPilotManualLiveInterval(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                Necesită mod ordine Real, tranzacții manuale activate și cron{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-[11px]">ai-pilot-manual-live</code>. Nu
                consumă din plafonul „max acțiuni / rundă” al pilotului principal.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={pilotCreateBot}
                onChange={(e) => setPilotCreateBot(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Creare strategie + bot nou din analiză (pereche fără bot existent)
            </label>
            <div className="space-y-2">
              <Label>Max boți creați de pilot</Label>
              <Input
                type="number"
                min={1}
                max={20}
                value={pilotMaxPilotBots}
                onChange={(e) => setPilotMaxPilotBots(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                La depășire, înainte de un bot nou se elimină automat (doar fără poziție deschisă pe bot)
                cei considerați mai puțin relevanți: pereche în afara topului din rundă, apoi bot oprit/pauză,
                apoi mai vechi. Boții cu poziție activă nu sunt șterși; plafonul total de boți al planului
                rămâne separat.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Max acțiuni / rundă</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={pilotMaxTradesRun}
                  onChange={(e) => setPilotMaxTradesRun(Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Buy/sell manual + 1× bot nou numără într-o rundă. Boții deja în listă: activare/pauză/închidere nu
                  consumă din acest plafon.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Max perechi manuale deschise</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={pilotMaxManualOpen}
                  onChange={(e) => setPilotMaxManualOpen(Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Pentru o pereche nouă (fără poziție), pilotul nu cumpără peste acest număr de poziții distincte.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Interval minim între runde (minute)</Label>
              <Input
                type="number"
                min={5}
                max={120}
                value={pilotInterval}
                onChange={(e) => setPilotInterval(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label>Max USDC per ordin buy</Label>
              <Input
                type="number"
                min={2}
                step={1}
                value={pilotMaxUsdc}
                onChange={(e) => setPilotMaxUsdc(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                Plafon pentru buy manual pilot și pentru boții selectați în pilot (motorul de strategie).
              </p>
            </div>
            <div className="space-y-2">
              <Label>Boți în pilot (opțional dacă ai manual sau creare bot)</Label>
              <ul className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-border p-3 text-sm">
                {pilotBots.length === 0 ? (
                  <li className="text-muted-foreground">Niciun bot — creează din pagina Bots.</li>
                ) : (
                  pilotBots.map((b) => (
                    <li key={b.id}>
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={pilotSelected.has(b.id)}
                          onChange={() => togglePilotBot(b.id)}
                          className="h-4 w-4 rounded border-input"
                        />
                        <span>
                          {b.pair} · {b.mode} · {b.status}
                        </span>
                      </label>
                    </li>
                  ))
                )}
              </ul>
            </div>
            <Button type="submit" disabled={pilotSaving}>
              {pilotSaving ? "Se salvează…" : "Salvează pilot"}
            </Button>
          </form>
        )}
        {!pilotLoading && pilotCanUse && (
          <AiPilotRunSummary
            pilotLastRun={pilotLastRun}
            pilotLastSummary={pilotLastSummary}
            pilotLastError={pilotLastError}
            className="max-w-lg space-y-2 rounded-md border border-border/60 bg-muted/30 p-3 text-xs"
          />
        )}
      </CardContent>
    </Card>
  );
}

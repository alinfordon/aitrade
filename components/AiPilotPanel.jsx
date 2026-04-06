"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function AiPilotPanel() {
  const [pilotCanUse, setPilotCanUse] = useState(false);
  const [pilotLoading, setPilotLoading] = useState(true);
  const [pilotSaving, setPilotSaving] = useState(false);
  const [pilotBots, setPilotBots] = useState([]);
  const [pilotEnabled, setPilotEnabled] = useState(false);
  const [pilotInterval, setPilotInterval] = useState(15);
  const [pilotMaxUsdc, setPilotMaxUsdc] = useState(150);
  const [pilotOrderMode, setPilotOrderMode] = useState("paper");
  const [pilotManual, setPilotManual] = useState(false);
  const [pilotCreateBot, setPilotCreateBot] = useState(false);
  const [pilotMaxTradesRun, setPilotMaxTradesRun] = useState(3);
  const [pilotMaxManualOpen, setPilotMaxManualOpen] = useState(3);
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
      setPilotCreateBot(Boolean(s.createBotFromAnalysis));
      setPilotMaxTradesRun(Math.min(20, Math.max(1, Number(s.maxTradesPerRun) || 3)));
      setPilotMaxManualOpen(Math.min(20, Math.max(1, Number(s.maxOpenManualPositions) || 3)));
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
      const r = await fetch("/api/user/ai-pilot", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: pilotEnabled,
          intervalMinutes: pilotInterval,
          maxUsdcPerTrade: pilotMaxUsdc,
          pilotOrderMode,
          manualTradingEnabled: pilotManual,
          createBotFromAnalysis: pilotCreateBot,
          maxTradesPerRun: pilotMaxTradesRun,
          maxOpenManualPositions: pilotMaxManualOpen,
          botIds: Array.from(pilotSelected),
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error(typeof j.error === "string" ? j.error : "Salvare eșuată");
        return;
      }
      toast.success("Setări AI Pilot salvate");
      await loadPilot();
    } finally {
      setPilotSaving(false);
    }
  }

  return (
    <Card id="ai-pilot">
      <CardHeader>
        <CardTitle>AI Pilot (cron)</CardTitle>
        <CardDescription>
          La intervalul setat, job-ul analizează piața USDC: gestionează boții selectați, poate deschide/închide
          poziții în{" "}
          <strong className="font-medium text-foreground">manual spot</strong> (cartea Live), poate crea{" "}
          <strong className="font-medium text-foreground">strategie + bot nou</strong> din analiză. Limitezi
          acțiunile pe rundă (cumpărări/vânzări manuale + creare bot) și perechile manuale maxime deschise. Cron:{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">/api/cron/ai-pilot</code> +{" "}
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
                checked={pilotCreateBot}
                onChange={(e) => setPilotCreateBot(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Creare strategie + bot nou din analiză (pereche fără bot existent)
            </label>
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
                min={10}
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
        {!pilotLoading && pilotCanUse && (pilotLastRun || pilotLastSummary || pilotLastError) && (
          <div className="max-w-lg space-y-2 rounded-md border border-border/60 bg-muted/30 p-3 text-xs">
            {pilotLastRun && (
              <p>
                <span className="font-medium">Ultima rundă:</span>{" "}
                {new Date(pilotLastRun).toLocaleString("ro-RO")}
              </p>
            )}
            {pilotLastSummary && (
              <p>
                <span className="font-medium">Rezumat:</span> {pilotLastSummary}
              </p>
            )}
            {pilotLastError && (
              <p className="text-destructive">
                <span className="font-medium">Eroare:</span> {pilotLastError}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

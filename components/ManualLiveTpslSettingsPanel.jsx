"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ManualLiveTpslSummary } from "@/components/ManualLiveTpslSummary";

export function ManualLiveTpslSettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [intervalMinutes, setIntervalMinutes] = useState(1);
  const [summary, setSummary] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/user/manual-live-tpsl");
      const j = await r.json();
      if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : "Setari TP/SL");
      const s = j.settings || {};
      setEnabled(Boolean(s.enabled));
      setIntervalMinutes(Math.min(30, Math.max(1, Number(s.intervalMinutes) || 1)));
      setSummary(s);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Setari TP/SL");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await fetch("/api/user/manual-live-tpsl", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, intervalMinutes }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : "Salvare esuata");
      toast.success("Setari Live manual TP/SL salvate");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Salvare esuata");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Live manual TP/SL (fara AI)</CardTitle>
        <CardDescription>
          Modul separat de AI Pilot: cronul verifica la interval fix pozitiile live manuale si executa doar TP/SL
          salvat pe pereche.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Se incarca…</p>
        ) : (
          <>
            <form className="max-w-lg space-y-4" onSubmit={save}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-input"
                />
                Modul TP/SL activ (independent de AI Pilot)
              </label>
              <div className="space-y-2">
                <Label>Interval cron (minute)</Label>
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                />
              </div>
              <Button type="submit" disabled={saving}>
                {saving ? "Se salveaza…" : "Salveaza setari TP/SL"}
              </Button>
            </form>
            {summary ? (
              <ManualLiveTpslSummary
                lastRunAt={summary.lastRunAt}
                lastSummary={summary.lastSummary}
                lastError={summary.lastError}
                lastStats={summary.lastStats}
                lastStatus={summary.lastStatus}
                lastEvents={summary.lastEvents}
                className="max-w-lg rounded-md border border-border/60 bg-muted/30 p-3"
              />
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}


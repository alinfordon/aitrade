"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { DEFAULT_SPOT_PAIR } from "@/lib/market-defaults";
import { PageHeader } from "@/components/shell/PageHeader";
import { cn } from "@/lib/utils";
import { Loader2, Sparkles, Trash2, Wand2 } from "lucide-react";

/** Nu e ObjectId — păstrează ciorna la refresh fără să reselecteze primul salvat */
const DRAFT_SEL = "__draft__";

const defaultDef = `{
  "entry": [
    { "indicator": "RSI", "operator": "<", "value": 30, "period": 14 },
    { "indicator": "EMA_CROSS", "value": "BULLISH", "fast": 9, "slow": 21 }
  ],
  "exit": [
    { "indicator": "RSI", "operator": ">", "value": 70, "period": 14 }
  ]
}`;

/** Idei gata formulate pentru promptul către Gemini — utilizatorul poate edita textul după. */
const AI_GOAL_PRESETS = [
  { id: "", label: "— Alege o idee principală (opțional) —", prompt: "" },
  {
    id: "rsi_ema_trend",
    label: "RSI oversold + confirmare trend (EMA)",
    prompt:
      "Intrare long când RSI sub 35 (oversold) și apare semnal bullish de traversare EMA (fast peste slow). Ieșire când RSI depășește 68–70 sau la semnal bearish EMA. Vreau reguli clare pentru intrare AND și ieșire OR.",
  },
  {
    id: "macd_reset",
    label: "MACD: intrare la trecere în sus, ieșire hist negativ",
    prompt:
      "Cumpăr când histograma MACD trece din negativ în pozitiv sau la crossover linie peste semnal în sus. Vinz când histograma devine negativă puternic sau la cross în jos. Păstrează reguli simple, fără prea mulți indicatori odată.",
  },
  {
    id: "bollinger_mean",
    label: "Bollinger: cumpăr la banda inferioară, vin la banda superioară",
    prompt:
      "Strategie mean-reversion: intrare când prețul atinge sau trece sub banda inferioară Bollinger (period 20). Ieșire când prețul atinge banda superioară sau RSI devine foarte supracumpărat. Folosește BB cu touch_lower și touch_upper unde e cazul.",
  },
  {
    id: "slow_swing",
    label: "Swing conservator (RSI + SMA filtru)",
    prompt:
      "Vreau ceva mai lent și conservator: intrare doar dacă RSI sub 32 și prețul e deasupra SMA 50 (filtru de trend). Ieșire la RSI peste 65 sau dacă prețul trece sub SMA 50.",
  },
  {
    id: "scalp_style",
    label: "Mai reactiv (RSI + MACD, stil scurt)",
    prompt:
      "Îmi place un stil ceva mai agresiv pe semnale scurte: intrare la RSI sub 40 și MACD cross_up. Ieșire rapidă la RSI peste 60 sau MACD cross_down. NU garanta profit, vreau structură logică pentru bot educațional.",
  },
  {
    id: "simple_rsi",
    label: "Clasic simplu: cumpăr RSI jos, vând RSI sus",
    prompt:
      "Cel mai simplu posibil: intrare când RSI sub 30, ieșire când RSI peste 70. Eventual o singură regulă suplimentară de filtru cu EMA dacă ajută calitatea semnalului.",
  },
];

export default function StrategiesPage() {
  const [strategies, setStrategies] = useState([]);
  const [examples, setExamples] = useState([]);
  const [name, setName] = useState("Strategie nouă");
  const [jsonText, setJsonText] = useState(defaultDef);
  const [pair, setPair] = useState(DEFAULT_SPOT_PAIR);
  const [selectedId, setSelectedId] = useState(null);

  const [aiGoal, setAiGoal] = useState("");
  const [aiIdeaPreset, setAiIdeaPreset] = useState("");
  const [aiRisk, setAiRisk] = useState("balanced");
  const [aiLoading, setAiLoading] = useState(false);
  const [deletePilotLoading, setDeletePilotLoading] = useState(false);

  const refresh = useCallback(async (opts = {}) => {
    const s = await fetch("/api/strategies").then((r) => r.json());
    setStrategies(s.strategies || []);
    setExamples(s.examples || []);
    if (opts.forceSelectId) {
      setSelectedId(String(opts.forceSelectId));
      return;
    }
    setSelectedId((cur) => {
      if (cur === DRAFT_SEL) return DRAFT_SEL;
      if (cur === "") return "";
      if (cur == null) {
        return s.strategies?.[0] ? String(s.strategies[0]._id) : DRAFT_SEL;
      }
      if (s.strategies?.some((x) => String(x._id) === cur)) return cur;
      return s.strategies?.[0] ? String(s.strategies[0]._id) : DRAFT_SEL;
    });
  }, []);

  useEffect(() => {
    refresh().catch(() => toast.error("Încărcare eșuată"));
  }, [refresh]);

  useEffect(() => {
    if (selectedId == null || selectedId === DRAFT_SEL) return;
    const cur = strategies.find((x) => String(x._id) === selectedId);
    if (cur) {
      setName(cur.name);
      setJsonText(JSON.stringify(cur.definition, null, 2));
    }
  }, [selectedId, strategies]);

  function startNewDraft() {
    setSelectedId(DRAFT_SEL);
    setName("Strategie nouă");
    setJsonText(defaultDef);
  }

  const isEditingSaved = Boolean(selectedId && strategies.some((s) => String(s._id) === selectedId));

  async function saveStrategy(e) {
    e.preventDefault();
    let def;
    try {
      def = JSON.parse(jsonText);
    } catch {
      toast.error("JSON invalid");
      return;
    }
    if (isEditingSaved) {
      const r = await fetch(`/api/strategies/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, definition: def }),
      });
      if (!r.ok) toast.error("Salvare eșuată");
      else toast.success("Salvat");
      await refresh();
    } else {
      const r = await fetch("/api/strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, definition: def }),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error(typeof j.error === "string" ? j.error : "Creare eșuată");
        return;
      }
      toast.success("Strategie creată — poți crea un bot din pagina Bots.");
      const nid = j.strategy?._id != null ? String(j.strategy._id) : null;
      await refresh(nid ? { forceSelectId: nid } : {});
    }
  }

  async function runOptimize() {
    let def;
    try {
      def = JSON.parse(jsonText);
    } catch {
      toast.error("JSON invalid");
      return;
    }
    const r = await fetch("/api/ai/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        definition: def,
        symbol: pair.trim() || DEFAULT_SPOT_PAIR,
        save: false,
        count: 80,
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      toast.error(j.error || "Optimizare eșuată");
      return;
    }
    setJsonText(JSON.stringify(j.best.definition, null, 2));
    toast.success(
      `Scor ${j.best.score.toFixed(4)} | profit backtest ${(j.best.backtest.totalProfit * 100).toFixed(2)}%`
    );
  }

  async function runGenerateAuto(safeMode) {
    try {
      const r = await fetch("/api/strategies/generate-auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pair: pair.trim() || DEFAULT_SPOT_PAIR, safeMode }),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error(j.error || "Generare eșuată");
        return;
      }
      setName(j.name);
      setJsonText(JSON.stringify(j.definition, null, 2));
      setSelectedId(DRAFT_SEL);
      toast.success(safeMode ? "Șablon Safe Mode în ciornă — salvează când ești gata." : "Șablon AI Auto în ciornă — salvează când ești gata.");
    } catch {
      toast.error("Eroare rețea");
    }
  }

  async function runAutoPersisted() {
    if (!isEditingSaved) return;
    const r = await fetch(`/api/strategies/${selectedId}/auto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pair: pair.trim() || DEFAULT_SPOT_PAIR, safeMode: false }),
    });
    const j = await r.json();
    if (!r.ok) {
      toast.error(j.error || "AI Auto eșuat");
      return;
    }
    setName(j.strategy.name);
    setJsonText(JSON.stringify(j.strategy.definition, null, 2));
    await refresh({ forceSelectId: String(selectedId) });
    toast.success("Strategie actualizată în baza de date (AI Auto).");
  }

  async function runSafePersisted() {
    if (!isEditingSaved) return;
    const r = await fetch(`/api/strategies/${selectedId}/auto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pair: pair.trim() || DEFAULT_SPOT_PAIR, safeMode: true }),
    });
    const j = await r.json();
    if (!r.ok) {
      toast.error(j.error || "Safe Mode eșuat");
      return;
    }
    setName(j.strategy.name);
    setJsonText(JSON.stringify(j.strategy.definition, null, 2));
    await refresh({ forceSelectId: String(selectedId) });
    toast.success("Strategie actualizată în baza de date (Safe Mode).");
  }

  async function runAuto() {
    if (isEditingSaved) await runAutoPersisted();
    else await runGenerateAuto(false);
  }

  async function runSafeAuto() {
    if (isEditingSaved) await runSafePersisted();
    else await runGenerateAuto(true);
  }

  const pilotCount = strategies.filter((s) => s.source === "pilot").length;

  async function deleteStrategyRow(strategy, e) {
    e.stopPropagation();
    if (
      !window.confirm(
        `Ștergi definitiv strategia „${strategy.name}”? Nu poate fi folosită de niciun bot.`
      )
    ) {
      return;
    }
    try {
      const r = await fetch(`/api/strategies/${strategy._id}`, { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(typeof j.error === "string" ? j.error : "Ștergere eșuată");
        return;
      }
      toast.success("Strategie ștearsă.");
      if (String(selectedId) === String(strategy._id)) {
        setSelectedId(DRAFT_SEL);
      }
      await refresh();
    } catch {
      toast.error("Eroare rețea");
    }
  }

  async function deleteAllPilotStrategies() {
    if (pilotCount === 0) {
      toast.info("Nu ai strategii salvate de la pilot.");
      return;
    }
    if (
      !window.confirm(
        `Ștergi toate cele ${pilotCount} strategii cu sursa „pilot”? Cele folosite de boți rămân până oprești sau ștergi botii.`
      )
    ) {
      return;
    }
    setDeletePilotLoading(true);
    try {
      const r = await fetch("/api/strategies/pilot", { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(typeof j.error === "string" ? j.error : "Ștergere eșuată");
        return;
      }
      const deleted = typeof j.deletedCount === "number" ? j.deletedCount : 0;
      const skipped = typeof j.skippedInUse === "number" ? j.skippedInUse : 0;
      if (deleted === 0 && skipped > 0) {
        toast.warning(j.message || "Nicio strategie ștearsă — toate sunt legate de boti.");
      } else {
        toast.success(
          skipped > 0
            ? `Șterse ${deleted} strategii pilot; ${skipped} sărite (folosite de boti).`
            : `Șterse ${deleted} strategii pilot.`
        );
      }
      await refresh();
    } catch {
      toast.error("Eroare rețea");
    } finally {
      setDeletePilotLoading(false);
    }
  }

  async function runAiFromPrompt() {
    const goal = aiGoal.trim();
    if (goal.length < 8) {
      toast.error("Scrie cu limba naturală ce vrei (min. 8 caractere), ex: „cumpăr când RSI e oversold și trendul e bullish”.");
      return;
    }
    setAiLoading(true);
    try {
      const r = await fetch("/api/ai/strategy-from-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal,
          pair: pair.trim() || DEFAULT_SPOT_PAIR,
          riskStyle: aiRisk,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error(typeof j.error === "string" ? j.error : "Generare AI eșuată");
        return;
      }
      setName(j.name);
      setJsonText(JSON.stringify(j.definition, null, 2));
      setSelectedId(DRAFT_SEL);
      toast.success("Strategie generată din descriere — verifică JSON-ul și salvează.");
    } catch {
      toast.error("Eroare rețea");
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Strategii"
        description="Pentru începători: asistentul cu limbaj natural sau AI Auto generează un JSON gata de folosit; salvezi strategia, apoi creezi botul din pagina Bots."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1 border-white/10 bg-card/50">
          <CardHeader>
            <CardTitle className="text-base">Salvate</CardTitle>
            <CardDescription className="text-xs">Selectează o strategie sau începe o ciornă nouă</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button type="button" variant="outline" className="w-full border-primary/30" onClick={startNewDraft}>
              + Ciornă nouă
            </Button>
            {pilotCount > 0 && (
              <Button
                type="button"
                variant="outline"
                className="flex w-full items-center justify-center gap-2 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={deletePilotLoading}
                onClick={() => void deleteAllPilotStrategies()}
              >
                {deletePilotLoading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : null}
                <span className="text-center leading-tight">
                  Șterge toate strategiile pilot ({pilotCount})
                </span>
              </Button>
            )}
            {strategies.map((s) => (
              <div key={s._id} className="flex gap-1">
                <button
                  type="button"
                  className={cn(
                    "min-w-0 flex-1 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                    selectedId === String(s._id)
                      ? "border-primary/50 bg-primary/10 text-foreground"
                      : "border-border hover:bg-muted"
                  )}
                  onClick={() => setSelectedId(String(s._id))}
                >
                  <span className="block truncate">
                    {s.name}{" "}
                    <span className="text-xs text-muted-foreground">({s.source})</span>
                  </span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                  title={`Șterge „${s.name}”`}
                  onClick={(e) => void deleteStrategyRow(s, e)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <div className="pt-4">
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Exemple</p>
              {examples.map((ex) => (
                <button
                  key={ex.name}
                  type="button"
                  className="mb-1 block w-full rounded-md border border-dashed border-border px-2 py-1 text-left text-xs hover:bg-muted"
                  onClick={() => {
                    setSelectedId(DRAFT_SEL);
                    setName(ex.name);
                    setJsonText(JSON.stringify(ex.definition, null, 2));
                  }}
                >
                  {ex.name}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <Card className="border-violet-500/20 bg-gradient-to-br from-violet-950/25 via-card/40 to-card/30">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-violet-300" />
                Asistent AI (fără experiență)
              </CardTitle>
              <CardDescription className="text-xs leading-relaxed">
                Descrie în română ce vrei să facă botul. Necesită <code className="rounded bg-black/30 px-1">GEMINI_API_KEY</code>{" "}
                pe server. Primești un JSON valid (RSI, EMA, MACD, Bolly) pe care îl poți ajusta sau salva direct.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Idei principale (șabloane)</Label>
                <select
                  value={aiIdeaPreset}
                  onChange={(e) => {
                    const id = e.target.value;
                    setAiIdeaPreset(id);
                    const row = AI_GOAL_PRESETS.find((p) => p.id === id);
                    if (row?.prompt) setAiGoal(row.prompt);
                  }}
                  className="flex h-10 w-full rounded-md border border-input bg-background/90 px-3 text-sm text-foreground"
                >
                  {AI_GOAL_PRESETS.map((p) => (
                    <option key={p.id || "empty"} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground">
                  Alegerea umple caseta de mai jos; o poți modifica liber înainte de generare.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Ce vrei să facă strategia?</Label>
                <textarea
                  className="min-h-[120px] w-full rounded-md border border-input bg-background/80 p-3 text-sm"
                  placeholder='Ex: „Intrare când RSI e sub 35 și prețul e peste EMA 50; ieșire la RSI peste 70 sau MACD traversează în jos.” Sau alege un șablon de mai sus.'
                  value={aiGoal}
                  onChange={(e) => {
                    setAiGoal(e.target.value);
                    setAiIdeaPreset("");
                  }}
                />
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="space-y-1.5 sm:flex-1">
                  <Label className="text-xs">Cum vrei riscul ideii (prompt)</Label>
                  <select
                    value={aiRisk}
                    onChange={(e) => setAiRisk(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="conservative">Conservator</option>
                    <option value="balanced">Echilibrat</option>
                    <option value="aggressive">Dinamic</option>
                  </select>
                </div>
                <Button
                  type="button"
                  className="shrink-0 gap-2 bg-violet-600 hover:bg-violet-500"
                  disabled={aiLoading}
                  onClick={runAiFromPrompt}
                >
                  {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                  Generează din text
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-card/50">
            <CardHeader>
              <CardTitle className="text-base">Constructor</CardTitle>
              <CardDescription className="text-xs">
                {selectedId === DRAFT_SEL || !isEditingSaved
                  ? "Ești în ciornă — „Salvează strategie” creează o înregistrare nouă."
                  : "Editezi o strategie salvată. AI Auto / Safe pot suprascrie în DB."}{" "}
                <Link href="/bots" className="font-medium text-primary underline underline-offset-2">
                  Creează bot
                </Link>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={saveStrategy}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Nume strategie</Label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Pereche (bot / optimizare)</Label>
                    <Input
                      value={pair}
                      onChange={(e) => setPair(e.target.value)}
                      placeholder={DEFAULT_SPOT_PAIR}
                      className="font-mono text-sm"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Definiție (JSON)</Label>
                  <textarea
                    className="min-h-[260px] w-full rounded-md border border-input bg-background p-3 font-mono text-xs"
                    value={jsonText}
                    onChange={(e) => setJsonText(e.target.value)}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit">Salvează strategie</Button>
                  <Button type="button" variant="secondary" onClick={runAuto}>
                    AI Auto {isEditingSaved ? "(actualizează în DB)" : "(ciornă)"}
                  </Button>
                  <Button type="button" variant="outline" onClick={runSafeAuto}>
                    Safe Mode {isEditingSaved ? "(DB)" : "(ciornă)"}
                  </Button>
                  <Button type="button" variant="outline" onClick={runOptimize}>
                    AI Optimize (Elite)
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

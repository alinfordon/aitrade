import { generateAiText } from "@/lib/ai/generate-ai-text";
import { strategyDefinitionSchema } from "@/lib/validations/schemas";

/**
 * @param {{
 *   goal: string,
 *   pair?: string,
 *   riskStyle?: "conservative" | "balanced" | "aggressive",
 *   aiRuntime?: { provider: "gemini" | "claude", claudeAgentic: boolean, credentials: object },
 * }} opts
 */
export async function generateStrategyFromUserGoal(opts) {
  const { aiRuntime } = opts;
  const goal = String(opts.goal || "").trim();
  if (goal.length < 8) {
    throw new Error("Descrie puțin mai mult ce vrei să facă strategia (min. 8 caractere).");
  }
  const pair = opts.pair || "BTC/USDC";
  const risk = opts.riskStyle || "balanced";
  const riskLine =
    risk === "conservative"
      ? "Stil conservator: semnale mai stricte, RSI mai aproape de 50, ieșiri clare."
      : risk === "aggressive"
        ? "Stil dinamic: poți folosi praguri RSI mai extinse, MACD cross_up pe intrare dacă are sens."
        : "Stil echilibrat: clasic swing pe timeframe 1h.";

  const prompt = `Ești un inginer de strategii pentru un bot de paper trading educațional (nu sfaturi de investiții).

Pereche țintă: ${pair}
Obiectiv utilizator (română): ${goal}
${riskLine}

REGULI TEHNICE — respectă-le exact:
- Răspunde DOAR cu JSON valid, fără markdown, fără text înainte/după.
- Schema răspunsului:
{
  "name": "titlu scurt în română (max 80 caractere)",
  "definition": {
    "entry": [ /* reguli AND: toate trebuie îndeplinite */ ],
    "exit": [ /* reguli OR: una e suficientă pentru ieșire */ ]
  }
}

Indicatori permiși în fiecare regulă (câmp "indicator" exact ca mai jos):
1) RSI: { "indicator": "RSI", "operator": "<" | ">" | "<=" | ">=", "value": number, "period": number }
2) EMA_CROSS: { "indicator": "EMA_CROSS", "value": "BULLISH" | "BEARISH", "fast": number, "slow": number }
3) EMA sau SMA: { "indicator": "EMA" sau "SMA", "operator": ">" | "<" | ">=" | "<=", "period": number }
4) MACD: { "indicator": "MACD", "mode": "hist_pos" | "hist_neg" | "cross_up" | "cross_down", opțional "fast","slow","signal" }
5) Bollinger: { "indicator": "BB", "mode": "touch_lower" | "touch_upper" | "above_middle", "period": number, opțional "mult": number }

Cel puțin 1 regulă la entry și 1 la exit. Nu inventa alți indicatori.
Exemplu valid:
{"name":"RSI + trend","definition":{"entry":[{"indicator":"RSI","operator":"<","value":32,"period":14},{"indicator":"EMA_CROSS","value":"BULLISH","fast":9,"slow":21}],"exit":[{"indicator":"RSI","operator":">","value":68,"period":14}]}}`;

  let raw;
  try {
    raw = await generateAiText(prompt, { jsonMode: true, temperature: 0.45, maxOutputTokens: 4096 }, aiRuntime);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/400|unsupported|responseMimeType|json|Ollama API/i.test(msg)) {
      throw e;
    }
    raw = await generateAiText(prompt, { jsonMode: false, temperature: 0.45, maxOutputTokens: 4096 }, aiRuntime);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new Error("Modelul nu a returnat JSON valid. Încearcă din nou sau reformulează.");
    }
    parsed = JSON.parse(raw.slice(start, end + 1));
  }

  const name = typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim().slice(0, 120) : "Strategie AI";
  const rawDef = parsed.definition && typeof parsed.definition === "object" ? parsed.definition : {};
  const definition = strategyDefinitionSchema.parse({
    entry: rawDef.entry,
    exit: rawDef.exit,
  });

  const entryCount = Array.isArray(definition.entry) ? definition.entry.length : 0;
  const exitCount = Array.isArray(definition.exit) ? definition.exit.length : 0;
  if (entryCount < 1 || exitCount < 1) {
    throw new Error("Strategia generată e incompletă (lipsesc reguli). Încearcă din nou.");
  }

  return { name, definition };
}

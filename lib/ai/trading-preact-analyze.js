import { DEFAULT_QUOTE_ASSET } from "@/lib/market-defaults";
import { fetchOHLCV } from "@/lib/binance/service";
import { generateAiText } from "@/lib/ai/generate-ai-text";
import { overlaySpecsFromLiveAiIndicators } from "@/lib/chart-strategy-overlays";

const OUTPUT_SCHEMA = `{
  "analizaTehnica": "string (română, DOAR din datele OHLC furnizate — tendință scurtă/medie, volatilitate, niveluri aproximative)",
  "verdict": "ACUM | ASTEAPTA | NEUTRU — pentru buy: ACUM = intrare rezonabilă acum; ASTEAPTA = nu recomanda intrarea acum; NEUTRU = semnale mixte. Pentru sell: ACUM = vânzare rezonabilă acum; ASTEAPTA = poate fi mai bine așteptat; NEUTRU = mixt.",
  "notaExecutive": "string scurt (1-3 fraze, română)",
  "indicatoriPeGrafic": "optional array (max 4): { tip: EMA|SMA|BB, period: number, mult?: number pentru BB }",
  "sugestieBot": "string (română: dacă are sens, sugerează dacă utilizatorul ar putea folosi un bot pe această pereche pentru intrări/ieșiri sistematice; menționează dacă există deja bot(i) pe pereche din listă)",
  "avertismente": ["string — include că nu e sfat financiar"]
}`;

function compactOhlcRows(rows, max = 48) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const slice = rows.slice(-max);
  return slice.map((r) => ({
    t: r[0],
    o: Number(r[1]),
    h: Number(r[2]),
    l: Number(r[3]),
    c: Number(r[4]),
  }));
}

function normalizeVerdict(raw) {
  const v = String(raw || "")
    .trim()
    .toUpperCase();
  if (v === "ACUM" || v === "ASTEAPTA" || v === "NEUTRU") return v;
  return "NEUTRU";
}

/**
 * @param {{
 *   pair: string,
 *   side: "buy" | "sell",
 *   timeframe: string,
 *   markPrice: number | null,
 *   botsOnPair: { strategyName: string, status: string, mode: string }[],
 *   aiRuntime?: { provider: "gemini" | "claude", claudeAgentic: boolean, credentials: object },
 * }} ctx
 */
export async function runTradingPreTradeAnalysis(ctx) {
  const { pair, side, timeframe, markPrice, botsOnPair, aiRuntime } = ctx;
  const mk = markPrice != null && Number.isFinite(Number(markPrice)) ? Number(markPrice) : null;

  let rows;
  try {
    rows = await fetchOHLCV(pair, timeframe, 160, { allowLinearPerpFallback: true });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    err.code = e?.code;
    throw err;
  }

  if (!Array.isArray(rows) || rows.length < 8) {
    throw new Error("Date OHLC insuficiente pentru analiză.");
  }

  const ohlcCompact = compactOhlcRows(rows, 56);
  const last = rows[rows.length - 1];
  const lastClose = last ? Number(last[4]) : null;

  const payload = {
    pereche: pair,
    cotatie: DEFAULT_QUOTE_ASSET,
    laturaOrdin: side,
    timeframeGrafic: timeframe,
    pretUltimaLumanare: Number.isFinite(lastClose) ? lastClose : null,
    pretPiata: mk,
    ultimileLumanariOHLC: ohlcCompact,
    botiPeAceeasiPereche: Array.isArray(botsOnPair) ? botsOnPair : [],
  };

  const prompt = `Ești analist tehnic (educațional, NU consilier financiar).

Context ordin și piață:
${JSON.stringify(payload)}

CERINȚE:
1. Răspuns în română în câmpurile text.
2. Bazează-te STRICT pe ultimileLumanariOHLC; nu inventa date externe.
3. verdict: alege UN singur cod ACUM / ASTEAPTA / NEUTRU conform schemei din schema JSON.
4. indicatoriPeGrafic: 1–4 elemente (EMA, SMA, BB) coerente cu analiza; period 2–200; pentru BB, mult 1–4 (implicit 2).
5. sugestieBot: dacă utilizatorul are deja boti pe pereche, poți recomanda folosirea/adaptarea lor; altfel, explică pe scurt dacă un bot cu strategie ar putea reduce impulsivitatea (fără a garanta rezultate).
6. NU promite profit. Include disclaimer în avertismente.
7. Răspunde EXCLUSIV cu JSON valid conform schemei, fără \`\`\` markdown.

Schema:
${OUTPUT_SCHEMA}`;

  let raw;
  try {
    raw = await generateAiText(prompt, { jsonMode: true, temperature: 0.45, maxOutputTokens: 4096 }, aiRuntime);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/400|unsupported|responseMimeType|json|Ollama API/i.test(msg)) {
      throw err;
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
      throw new Error("Analiză AI: modelul nu a returnat JSON valid.");
    }
    parsed = JSON.parse(raw.slice(start, end + 1));
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Analiză AI: format neașteptat");
  }

  const indicatoriPeGrafic = Array.isArray(parsed.indicatoriPeGrafic) ? parsed.indicatoriPeGrafic : [];
  const chartOverlaySpecs = overlaySpecsFromLiveAiIndicators(indicatoriPeGrafic);

  return {
    analizaTehnica: String(parsed.analizaTehnica || ""),
    verdict: normalizeVerdict(parsed.verdict),
    notaExecutive: String(parsed.notaExecutive || ""),
    sugestieBot: String(parsed.sugestieBot || ""),
    avertismente: Array.isArray(parsed.avertismente) ? parsed.avertismente.map((x) => String(x)) : [],
    indicatoriPeGrafic,
    chartOverlaySpecs,
  };
}
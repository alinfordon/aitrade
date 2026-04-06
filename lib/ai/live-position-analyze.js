import { DEFAULT_QUOTE_ASSET } from "@/lib/market-defaults";
import { fetchOHLCV } from "@/lib/binance/service";
import { geminiGenerateText } from "@/lib/ai/gemini";
import { overlaySpecsFromLiveAiIndicators } from "@/lib/chart-strategy-overlays";

const OUTPUT_SCHEMA = `{
  "analizaTehnica": "string (română: ce reiese din seriile OHLC date — suport/rezistență aproximative, volatilitate recentă; fără a pretinde indicatori pe care nu îi ai)",
  "analizaFinanciara": "string (română: risc mărime poziție, expunere, limitări date; nu inventa bilanțuri)",
  "stopLoss": "number — preț ABSOLUT strict sub pretMediuIntrare pentru LONG spot",
  "takeProfit": "number — preț ABSOLUT strict peste pretMediuIntrare pentru LONG spot",
  "notaExecutive": "string scurt (1-3 fraze)",
  "indicatoriPeGrafic": "optional array (max 4): obiecte { tip: EMA|SMA|BB, period: number, mult?: number doar pentru BB, implicit 2 } — alege indicatori care susțin analiza tehnică scrisă (ex. EMA 20 și 50, sau BB 20); omit dacă nu ai nevoie",
  "avertismente": ["string — obligatoriu include că nu este sfat financiar și că țintele sunt orientative"]
}`;

/**
 * Rezumat piețe din lumânări 1h (spot sau fallback perp).
 * @param {string} pair ex. BTC/USDC
 */
export async function buildLivePositionMarketContext(pair) {
  try {
    const rows = await fetchOHLCV(pair, "1h", 96, { allowLinearPerpFallback: true });
    if (!Array.isArray(rows) || rows.length < 8) return null;

    const lows = rows.map((r) => Number(r[3]));
    const highs = rows.map((r) => Number(r[2]));
    const closes = rows.map((r) => Number(r[4]));
    const n = closes.length;
    const lastClose = closes[n - 1];
    const low24 = Math.min(...lows.slice(-24));
    const high24 = Math.max(...highs.slice(-24));
    const low72 = Math.min(...lows.slice(-Math.min(72, n)));
    const high72 = Math.max(...highs.slice(-Math.min(72, n)));

    return {
      lastClose1h: lastClose,
      range24h: { low: low24, high: high24 },
      range72h: { low: low72, high: high72 },
      pctFromLow24: lastClose / low24 - 1,
      pctFromHigh24: lastClose / high24 - 1,
      bars: n,
    };
  } catch {
    return null;
  }
}

/**
 * Poziție LONG spot: SL sub intrare, TP peste intrare; clamp la benzi rezonabile.
 * @param {number} avgEntry
 * @param {number | null} markPrice
 * @param {number} sl
 * @param {number} tp
 */
export function clampProtectForLongSpot(avgEntry, markPrice, sl, tp) {
  const e = Number(avgEntry);
  if (!Number.isFinite(e) || e <= 0) {
    throw new Error("Preț mediu intrare invalid.");
  }
  const m = Number.isFinite(markPrice) && markPrice > 0 ? markPrice : e;

  let s = Number(sl);
  let t = Number(tp);

  const floorAbs = e * 0.01;
  const capTp = e * 6;

  if (!Number.isFinite(s) || s >= e) {
    const ref = Math.min(e, m);
    s = ref * 0.97;
  }
  if (!Number.isFinite(t) || t <= e) {
    const ref = Math.max(e, m);
    t = ref * 1.04;
  }

  s = Math.max(floorAbs, Math.min(s, e * 0.999));
  t = Math.min(capTp, Math.max(t, e * 1.001));

  if (s >= e) s = e * 0.995;
  if (t <= e) t = e * 1.005;

  return { stopLoss: s, takeProfit: t };
}

/**
 * @param {{ pair: string, avgEntry: number, qty: number, markPrice: number | null }} ctx
 */
export async function runLivePositionProtectAnalysis(ctx) {
  const { pair, avgEntry, qty, markPrice } = ctx;
  const e = Number(avgEntry);
  const q = Number(qty);
  const mk = markPrice != null && Number.isFinite(Number(markPrice)) ? Number(markPrice) : null;

  const ohlc = await buildLivePositionMarketContext(pair);

  const payload = {
    pereche: pair,
    cotatie: DEFAULT_QUOTE_ASSET,
    pretMediuIntrare: e,
    cantitate: q,
    pretPiata: mk,
    contextOHLC1h: ohlc,
    regula: "Poziția este LONG spot: stopLoss trebuie să fie < pretMediuIntrare; takeProfit > pretMediuIntrare.",
  };

  const prompt = `Ești un analist tehnic și de risc (educațional, NU consilier financiar licențiat).

Date despre poziția utilizatorului și piață (moment „acum”, pot exista întârzieri):
${JSON.stringify(payload, null, 0)}

CERINȚE:
1. Scrie în română.
2. Analiza tehnică se bazează DOAR pe contextul OHLC (dacă lipsește, spune clar că e limitat).
3. Analiza financiară: risc relativ (expunere = cantitate × preț), fără cifre inventate despre emitent.
4. Propune stopLoss și takeProfit ca prețuri ABSOLUTE în aceeași cotă ca perechea (ex. USDC pentru BTC/USDC).
5. În indicatoriPeGrafic include 1–4 instrumente (EMA, SMA sau Bollinger/BB) aliniate cu analiza tehnică; period între 2 și 200; pentru BB poți seta mult (1–4, implicit 2).
6. NU garanta profit. NU folosi „sigur”. Include DYOR în avertismente.
7. Răspunde EXCLUSIV cu JSON valid conform schemei, fără \`\`\` markdown, fără text înainte/după.

Schema obligatorie:
${OUTPUT_SCHEMA}`;

  let raw;
  try {
    raw = await geminiGenerateText(prompt, { jsonMode: true, temperature: 0.45, maxOutputTokens: 4096 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/400|unsupported|responseMimeType|json/i.test(msg)) {
      throw err;
    }
    raw = await geminiGenerateText(prompt, { jsonMode: false, temperature: 0.45, maxOutputTokens: 4096 });
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

  const slRaw = Number(parsed.stopLoss);
  const tpRaw = Number(parsed.takeProfit);
  const clamped = clampProtectForLongSpot(e, mk, slRaw, tpRaw);

  const indicatoriPeGrafic = Array.isArray(parsed.indicatoriPeGrafic)
    ? parsed.indicatoriPeGrafic
    : [];
  const chartOverlaySpecs = overlaySpecsFromLiveAiIndicators(indicatoriPeGrafic);

  return {
    analizaTehnica: String(parsed.analizaTehnica || ""),
    analizaFinanciara: String(parsed.analizaFinanciara || ""),
    notaExecutive: String(parsed.notaExecutive || ""),
    avertismente: Array.isArray(parsed.avertismente)
      ? parsed.avertismente.map((x) => String(x))
      : [],
    indicatoriPeGrafic,
    chartOverlaySpecs,
    stopLoss: clamped.stopLoss,
    takeProfit: clamped.takeProfit,
  };
}

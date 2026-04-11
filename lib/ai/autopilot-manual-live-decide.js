import { generateAiText } from "@/lib/ai/generate-ai-text";

const OUTPUT_SCHEMA = `{
  "rezumat": "string scurt română (context + ce ai decis)",
  "vinde": [
    { "pereche": "ex. ETH/USDC", "motiv": "string scurt" }
  ]
}`;

/**
 * Doar decizii de ieșire pe poziții manuale Spot Live (USDC), fără cumpărări.
 * @param {{
 *   pozitii: { pereche: string, cantitateBaza: number, pretMediu: number, pretPiata: number|null, pctDeLaIntrare: number|null }[],
 *   aiRuntime?: { provider: "gemini" | "claude", claudeAgentic: boolean, credentials: object },
 * }} ctx
 */
export async function runAutopilotManualLiveSellsDecide(ctx) {
  const { pozitii, aiRuntime } = ctx;
  const payload = { pozitiiLiveManuale: pozitii };

  const prompt = `Ești un asistent de trading educațional (NU consilier financiar).
Utilizatorul are poziții manuale Spot LIVE (bani reali, perechi USDC) deschise în aplicație.
Primești pentru fiecare poziție: pereche, cantitate bază, preț mediu de intrare, preț piață curent (sau null), procent față de intrare (sau null).

Date:
${JSON.stringify(payload, null, 0)}

REGULI:
1. Răspunde DOAR JSON valid conform schemei de mai jos.
2. În „vinde” pui DOAR perechi care apar în „pozitiiLiveManuale” cu cantitate > 0. Nu inventa simboluri.
3. Propune vânzare doar când consideri că merită ieșirea (ex. profit taking, deteriorare trend, risc management). Dacă merită păstrat, „vinde” poate fi [].
4. Maxim 5 intrări în „vinde” per rundă.
5. Limba română pentru rezumat și motive.
6. Schema:
${OUTPUT_SCHEMA}`;

  let raw;
  try {
    raw = await generateAiText(prompt, { jsonMode: true, temperature: 0.35, maxOutputTokens: 4096 }, aiRuntime);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/400|unsupported|responseMimeType|json|Ollama API/i.test(msg)) {
      throw e;
    }
    raw = await generateAiText(prompt, { jsonMode: false, temperature: 0.35, maxOutputTokens: 4096 }, aiRuntime);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new Error("AI Pilot Live: răspuns ne‑JSON.");
    }
    parsed = JSON.parse(raw.slice(start, end + 1));
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI Pilot Live: format invalid");
  }
  return parsed;
}

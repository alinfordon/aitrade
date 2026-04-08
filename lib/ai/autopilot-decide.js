import { geminiGenerateText } from "@/lib/ai/gemini";

const OUTPUT_SCHEMA = `{
  "rezumat": "string scurt română (context piață + linia deciziilor)",
  "decizii": [
    {
      "botId": "string (Mongo ObjectId din lista boti)",
      "actiune": "activeaza | pauza | mentine | inchide_pozitie",
      "motiv": "string scurt"
    }
  ],
  "manual": [
    {
      "pereche": "ex. ETH/USDC",
      "actiune": "cumpara | vinde",
      "sumaUsdc": null,
      "motiv": "string scurt"
    }
  ],
  "botNou": null,
  "avertismente": ["string — include că nu e sfat financiar"]
}`;

const BOTNOU_HINT = `
Opțional „botNou” (obiect, NU array):
{
  "pereche": "SOL/USDC",
  "obiectivStrategie": "română: ce să urmărească strategia pe 1h pentru această pereche",
  "risc": "conservative | balanced | aggressive",
  "numeStrategie": "opțional scurt",
  "pornesteActiv": true|false
}`;

/**
 * @param {{
 *   gainersSlice: object[],
 *   botsPayload: object[],
 *   manualPayload: { pereche: string, cantitateBaza: number, pretMediu: number, paper?: boolean }[],
 *   limite: object,
 *   perechiBotiExistente: string[],
 * }} ctx
 */
export async function runAutopilotDecide(ctx) {
  const { gainersSlice, botsPayload, manualPayload, limite, perechiBotiExistente } = ctx;
  const payload = {
    crestereUsdc24h: gainersSlice,
    boti: botsPayload,
    pozitiiManualeDeschise: manualPayload,
    limite,
    perechiCuBotExistent: perechiBotiExistente,
  };

  const prompt = `Ești un orchestrator de trading educațional (NU consilier financiar).
Primești date despre piață USDC, boți, poziții manuale deschise și limite impuse de utilizator.

Date:
${JSON.stringify(payload, null, 0)}

REGULI — BOTI (lista „boti”):
${botsPayload.length ? "1. Câte O decizie pentru FIECARE element din „boti” (botId exact)." : "1. Lista „boti” e goală: pune „decizii”: []."}

REGULI — MANUAL („manual”):
2. Doar dacă limite.tranzactiiManualPermise este true. Altfel „manual”: [].
3. Maxim limite.maxActiuniManualSiBotNouInTotal intrări în „manual” (vânzări + cumpărări la un loc).
4. „vinde”: doar pentru pereche din „pozitiiManualeDeschise” cu cantitate > 0.
5. „cumpara”: doar perechi USDC din „crestereUsdc24h” sau pereche deja urmărită; nu inventa simboluri.
6. „sumaUsdc”: pentru cumpara, număr pozitiv (USDC) sau null (serverul plafonează). Evită sume imense.
7. Dacă limite.pozitiiManualeCurente >= limite.maxPozitiiManualeSimultane, NU propune „cumpara” pe o pereche NOUĂ (fără poziție deja). Mărire poziție pe pereche existentă e permisă.

REGULI — BOT NOU („botNou”):
8. Doar dacă limite.creareBotPermisa este true. Altfel botNou trebuie null.
9. Cel mult UN bot nou per rundă. foarte des null.
10. Nu propune „botNou” dacă „pereche” e în „perechiCuBotExistent”.
11. „obiectivStrategie” = text clar în română pentru generarea regulilor entry/exit (vei fi urmat de un generator tehnic). În „limite”, maxBoțiPilotSimultan plafonează boții creați de pilot; serverul poate înlocui (fără poziție deschisă) dacă e nevoie de loc.

Altceva:
12. Limba română pentru rezumat și motive.
13. Răspunde DOAR JSON valid. „manual” = array (poate []). „botNou” = obiect conform exemplului sau null.
14. Schema de bază:
${OUTPUT_SCHEMA}
${BOTNOU_HINT}`;

  let raw;
  try {
    raw = await geminiGenerateText(prompt, { jsonMode: true, temperature: 0.4, maxOutputTokens: 8192 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/400|unsupported|responseMimeType|json/i.test(msg)) {
      throw e;
    }
    raw = await geminiGenerateText(prompt, { jsonMode: false, temperature: 0.4, maxOutputTokens: 8192 });
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new Error("AI Pilot: răspuns ne‑JSON.");
    }
    parsed = JSON.parse(raw.slice(start, end + 1));
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI Pilot: format invalid");
  }
  return parsed;
}

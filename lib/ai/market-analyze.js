import { DEFAULT_QUOTE_ASSET } from "@/lib/market-defaults";
import { geminiGenerateText } from "@/lib/ai/gemini";

const OUTPUT_SCHEMA = `{
  "rezumatPiata": "string (2-4 propoziții, română)",
  "tendintaGenerala": "bullish | neutral | bearish | mixed",
  "analizaTehnica": "string (paragraf: momentum 24h, volum, extensie preț — fără predicții certe)",
  "analizaFinanciara": "string (paragraf: riscuri, lichiditate observată din volum, limitări date; nu inventa cifre financiare lipsă)",
  "recomandari": [
    {
      "pereche": "string sau null (ex. BTC/USDC)",
      "simbol": "string",
      "actiune": "cumpara | asteapta | evita | urmareste",
      "horizon": "scurt | mediu",
      "risc": "scazut | mediu | ridicat",
      "motiv": "string scurt"
    }
  ],
  "avertismente": ["string — obligatoriu include că nu este sfat financiar"]
}`;

/**
 * @param {{ gainers: object[], trending: object[] }} ctx
 */
export async function runMarketAiAnalysis(ctx) {
  const { gainers, trending } = ctx;
  const gainersSlice = (gainers || []).slice(0, 18).map((g) => ({
    pereche: g.pair,
    pret: g.lastPrice,
    pct24h: g.pct24h,
    volQuote: g.quoteVolume,
  }));
  const trendSlice = (trending || []).slice(0, 10).map((t) => ({
    nume: t.name,
    simbol: t.symbol,
    rank: t.marketCapRank,
    pretUsd: t.priceUsd,
    pct24h: t.pct24hUsd,
  }));

  const dataJson = JSON.stringify(
    { binanceUsdcTopGainers24h: gainersSlice, coingeckoTrending: trendSlice },
    null,
    0
  );

  const prompt = `Ești un analist crypto experimentat (educațional, NU consilier financiar licențiat).
Date de intrare (moment ancorat la „acum”, pot fi întârziate câteva minute):
${dataJson}

Context tranzacționare aplicație: utilizatorii pot tranzacționa spot pe Binance cu cota implicită ${DEFAULT_QUOTE_ASSET}.

CERINȚE:
1. Scrie tot în română.
2. Combină perspectiva pieței: creșteri Binance USDC + interes CoinGecko trending.
3. Analiză tehnică: interpretează DOAR ce se poate deduce din datele date (schimbare % 24h, volum în moneda cotei). Nu afirma că ai grafic sau indicatori RSI/MACD — spune clar că lipsesc date intraday complete.
4. Analiză financiară: discută risc (volatilitate, concentrare, „pump” posibil) și că trending CoinGecko nu egal fundament.
5. Recomandări: maxim 5 intrări, doar pentru simboluri/prezenți în date sau combinații USDC evidente; folosește actiune „evita” sau „urmareste” când riscul e mare sau datele sunt subțiri.
6. NU garanta și NU folosi „sigur”, „profit garantat”. Menționează DYOR.
7. Răspunde EXCLUSIV cu JSON valid conform schemei, fără \`\`\` markdown, fără text înainte/după.

Schema obligatorie:
${OUTPUT_SCHEMA}`;

  let raw;
  try {
    raw = await geminiGenerateText(prompt, { jsonMode: true, temperature: 0.55, maxOutputTokens: 8192 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/400|unsupported|responseMimeType|json/i.test(msg)) {
      throw e;
    }
    raw = await geminiGenerateText(prompt, { jsonMode: false, temperature: 0.55, maxOutputTokens: 8192 });
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
  return parsed;
}

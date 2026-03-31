import { DEFAULT_QUOTE_ASSET } from "@/lib/market-defaults";
import { createExchange, withRetries } from "@/lib/binance/client";
import { resolveBinanceSpotSymbol } from "@/lib/binance/service";

const BINANCE_TICKER_24H = "https://api.binance.com/api/v3/ticker/24hr";
const COINGECKO_TRENDING = "https://api.coingecko.com/api/v3/search/trending";

/** @param {string} symbol ex. BTCUSDC */
export function toCcxtPairUsdc(symbol) {
  const m = String(symbol).match(/^(.*)USDC$/i);
  if (!m) return null;
  return `${m[1].toUpperCase()}/USDC`;
}

/**
 * Perechi USDC cu volum real; sortate după % 24h desc.
 * @param {{ minQuoteVolume?: number, limit?: number }} opts
 */
export async function fetchBinanceUsdcGainers(opts = {}) {
  const minQ = opts.minQuoteVolume ?? 80_000;
  const limit = opts.limit ?? 35;

  /** Răspunsul complet (~2.4MB) depășește limita Data Cache Next (~2MB); fără cache persistent. */
  const r = await fetch(BINANCE_TICKER_24H, { cache: "no-store" });
  if (!r.ok) {
    throw new Error(`Binance ticker: ${r.status}`);
  }
  /** @type {Array<{ symbol: string, lastPrice: string, priceChangePercent: string, quoteVolume: string, volume: string }>} */
  const raw = await r.json();
  if (!Array.isArray(raw)) {
    throw new Error("Binance: răspuns neașteptat");
  }

  const rows = raw
    .map((t) => {
      const pair = toCcxtPairUsdc(t.symbol);
      if (!pair) return null;
      const quoteVol = Number(t.quoteVolume);
      const pct = Number(t.priceChangePercent);
      const last = Number(t.lastPrice);
      if (!Number.isFinite(quoteVol) || quoteVol < minQ) return null;
      if (!Number.isFinite(pct) || !Number.isFinite(last)) return null;
      return {
        pair,
        symbol: t.symbol,
        lastPrice: last,
        pct24h: pct,
        quoteVolume: quoteVol,
        baseVolume: Number(t.volume) || 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.pct24h - a.pct24h)
    .slice(0, limit);

  return rows;
}

/** Tendințe căutare / vizibilitate CoinGecko (inclusiv monede noi sau „hot”). */
/**
 * Pentru fiecare monedă din CoinGecko, atașează `spotPair` (ex. BTC/USDC) dacă există pe Binance Spot.
 */
export async function enrichTrendingWithBinanceSpotUsdc(coins) {
  if (!Array.isArray(coins) || coins.length === 0) return coins;
  const ex = createExchange({ futures: false });
  await withRetries(() => ex.loadMarkets());
  return coins.map((c) => {
    const base = String(c.symbol ?? "")
      .trim()
      .toUpperCase();
    if (!base) return { ...c, spotPair: null };
    const candidate = `${base}/${DEFAULT_QUOTE_ASSET}`;
    const spotPair = resolveBinanceSpotSymbol(ex, candidate);
    return { ...c, spotPair: spotPair || null };
  });
}

export async function fetchCoinGeckoTrending() {
  const r = await fetch(COINGECKO_TRENDING, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!r.ok) {
    throw new Error(`CoinGecko trending: ${r.status}`);
  }
  const j = await r.json();
  const coins = Array.isArray(j.coins) ? j.coins : [];
  return coins.map(({ item }) => {
    const usdPct = item?.data?.price_change_percentage_24h?.usd;
    return {
      id: item?.id,
      name: item?.name,
      symbol: item?.symbol,
      thumb: item?.thumb || item?.small,
      marketCapRank: item?.market_cap_rank ?? null,
      priceUsd: item?.data?.price ?? null,
      pct24hUsd: usdPct != null ? Number(usdPct) : null,
      score: item?.score,
    };
  });
}

export function discoverDisclaimer() {
  return {
    gainers: `Perechi spot ${DEFAULT_QUOTE_ASSET} pe Binance, filtrate după volum (24h) și sortate după creșterea prețului. Tranzacționabile în aplicație pe modul Real dacă ai sold și chei API.`,
    trending:
      "Monede în tendință pe CoinGecko (căutări și interes ridicat). Nu este neapărat „data listării”; include proiecte noi sau foarte discutate. Verifică pe site-uri oficiale înainte de investiții.",
  };
}

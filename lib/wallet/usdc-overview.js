import { DEFAULT_QUOTE_ASSET, defaultPairForBase } from "@/lib/market-defaults";
import { getPricesBatch } from "@/lib/binance/service";

/** Stabile tratate ~1 USD pentru total portofoliu (Binance spot). */
const STABLE_USD_LIKE = new Set([
  "USDC",
  "FDUSD",
  "USDT",
  "BUSD",
  "DAI",
  "TUSD",
  "USDP",
  "USD",
  "USDE",
]);

/**
 * Paper: USDC lichid (manual + cotă nefolosită în boți paper) vs valoare în poziții la cost (manual + bot).
 */
export function paperUsdcOverview(paperQuote, book, bots) {
  let manualInPos = 0;
  const b = book && typeof book === "object" ? book : {};
  for (const [, pos] of Object.entries(b)) {
    const qty = Number(pos?.qty ?? pos?.base ?? 0);
    const avg = Number(pos?.avg ?? 0);
    if (qty > 1e-12 && avg > 0) manualInPos += qty * avg;
  }

  let botPaperInPos = 0;
  let botPaperQuoteFree = 0;
  for (const bot of bots || []) {
    if (bot.mode !== "paper") continue;
    const ps = bot.paperState || {};
    botPaperQuoteFree += Number(ps.quoteBalance ?? 0);
    if (ps.open && Number(ps.baseBalance) > 1e-12) {
      const q = Number(ps.baseBalance);
      const ae = Number(ps.avgEntry ?? 0);
      if (ae > 0) botPaperInPos += q * ae;
    }
  }

  const manualPaperQuoteFree = Number(paperQuote) || 0;

  return {
    usdcFreeTotal: manualPaperQuoteFree + botPaperQuoteFree,
    usdcInPositionsAtCost: manualInPos + botPaperInPos,
    manualInPositionsAtCost: manualInPos,
    botPaperInPositionsAtCost: botPaperInPos,
    botPaperQuoteFree,
    manualPaperQuoteFree,
  };
}

/**
 * Real: USDC liber în spot + estimate USDC din soldurile non-USDC (preț piață).
 */
export async function realUsdcOverview(balances) {
  const rows = Array.isArray(balances) ? balances : [];
  const usdcRow = rows.find((r) => r.currency === DEFAULT_QUOTE_ASSET);
  const usdcFree = usdcRow ? Number(usdcRow.free) : 0;

  const assets = rows
    .map((row) => {
      if (row.currency === DEFAULT_QUOTE_ASSET) return null;
      const f = Number(row.free ?? 0);
      if (f <= 1e-12) return null;
      return { free: f, pair: defaultPairForBase(row.currency) };
    })
    .filter(Boolean);

  const prices = await getPricesBatch(assets.map((a) => a.pair));
  const inAssetsUsdcEstimate = assets.reduce((sum, a) => {
    const px = Number(prices.get(a.pair) ?? 0);
    if (Number.isFinite(px) && px > 0) return sum + a.free * px;
    return sum;
  }, 0);

  return { usdcFree, inAssetsUsdcEstimate };
}

/**
 * Atașează fiecărui rând `usdTotal`: valoarea (free+locked) în ~USD (stibile 1:1, altfel preț spot USDC).
 */
export async function attachUsdTotalsToBalances(rows) {
  const input = Array.isArray(rows) ? rows : [];
  const pairs = [...new Set(
    input
      .filter((row) => !STABLE_USD_LIKE.has(row.currency))
      .map((row) => defaultPairForBase(row.currency))
      .filter(Boolean)
  )];
  const prices = await getPricesBatch(pairs);

  return input.map((row) => {
    const f = Number(row.free ?? 0);
    const u = Number(row.used ?? 0);
    const t = Number(row.total ?? f + u);
    let usd = 0;
    if (!(t > 1e-12)) {
      return { ...row, usdTotal: 0 };
    }
    if (STABLE_USD_LIKE.has(row.currency)) {
      usd = t;
    } else {
      const pair = defaultPairForBase(row.currency);
      const px = Number(prices.get(pair) ?? 0);
      if (Number.isFinite(px) && px > 0) usd = t * px;
    }
    return { ...row, usdTotal: Number(usd.toFixed(4)) };
  });
}

/**
 * Valoare totală spot (free + locked) în echivalent ~USD: stibile 1:1, restul via pereche BASE/USDC.
 */
export async function estimateSpotTotalUsd(balances) {
  const enriched = await attachUsdTotalsToBalances(balances);
  return Number(enriched.reduce((s, r) => s + (Number(r.usdTotal) || 0), 0).toFixed(2));
}

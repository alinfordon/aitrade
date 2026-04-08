import { DEFAULT_QUOTE_ASSET, defaultPairForBase } from "@/lib/market-defaults";
import { getPrice } from "@/lib/binance/service";

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

  let inAssetsUsdcEstimate = 0;
  const todo = [];
  for (const row of rows) {
    if (row.currency === DEFAULT_QUOTE_ASSET) continue;
    const f = Number(row.free ?? 0);
    if (f <= 1e-12) continue;
    const pair = defaultPairForBase(row.currency);
    todo.push(
      (async () => {
        try {
          const px = await getPrice(pair);
          if (Number.isFinite(px) && px > 0) return f * px;
        } catch {
          /* pereche sau preț indisponibil */
        }
        return 0;
      })()
    );
  }
  const parts = await Promise.all(todo);
  inAssetsUsdcEstimate = parts.reduce((a, x) => a + x, 0);

  return { usdcFree, inAssetsUsdcEstimate };
}

/**
 * Valoare totală spot (free + locked) în echivalent ~USD: stibile 1:1, restul via pereche BASE/USDC.
 */
export async function estimateSpotTotalUsd(balances) {
  const rows = Array.isArray(balances) ? balances : [];
  const byCur = new Map();
  for (const row of rows) {
    const c = row.currency;
    const t = Number(row.total ?? 0);
    if (!(t > 1e-12)) continue;
    byCur.set(c, (byCur.get(c) || 0) + t);
  }

  let sum = 0;
  const tasks = [];
  for (const [c, amt] of byCur) {
    if (STABLE_USD_LIKE.has(c)) {
      sum += amt;
      continue;
    }
    const pair = defaultPairForBase(c);
    tasks.push(
      (async () => {
        try {
          const px = await getPrice(pair);
          if (Number.isFinite(px) && px > 0) return amt * px;
        } catch {
          /* fără pereche USDC */
        }
        return 0;
      })()
    );
  }
  const parts = await Promise.all(tasks);
  sum += parts.reduce((a, x) => a + x, 0);
  return Number(sum.toFixed(2));
}

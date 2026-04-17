/**
 * Calculează snapshot-ul unui portofoliu pe termen lung:
 * - holdings agregate pe simbol (spot Binance real + holdings manuale off-exchange)
 * - valoarea curentă în USDC (stabile tratate 1:1)
 * - alocare actuală vs țintă, drift (pp), acțiune recomandată (buy/sell/hold)
 * - alerte: drift peste toleranță, target-uri totale ≠ 100%, concentrare excesivă, assets fără țintă
 *
 * Fără side-effects: primește balances deja formatate și listele din User.portfolio.
 */

import { DEFAULT_QUOTE_ASSET, defaultPairForBase } from "@/lib/market-defaults";
import { getPricesBatch } from "@/lib/binance/service";

/** Stabile tratate ~1 USD în valoarea totală a portofoliului. */
const STABLE_USD_LIKE = new Set([
  "USDC",
  "USDT",
  "FDUSD",
  "BUSD",
  "DAI",
  "TUSD",
  "USDP",
  "USD",
  "USDE",
]);

const CONCENTRATION_WARN_PCT = 60;
/** Valoare implicită sub care un activ e considerat „praf”; poate fi suprascris din `portfolio.dustThresholdUsd`. */
const DEFAULT_DUST_THRESHOLD_USD = 1;

/** @param {unknown} s */
function normSymbol(s) {
  return String(s ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** @param {number} n */
function safe(n) {
  return Number.isFinite(n) ? n : 0;
}

/** @param {number} n @param {number} d */
function round(n, d = 2) {
  const p = 10 ** d;
  return Math.round((Number(n) || 0) * p) / p;
}

/**
 * Agregă holdings din surse diferite (spot real + manual) într-o hartă pe simbol.
 *
 * @param {{
 *   realBalances?: { currency: string, free: number, used?: number, total?: number }[],
 *   manualHoldings?: { symbol: string, quantity: number, avgCost?: number }[],
 *   includeRealSpot?: boolean,
 *   includeManual?: boolean,
 * }} opts
 * @returns {Map<string, { symbol: string, quantity: number, costBasis: number, sources: { real: number, manual: number } }>}
 */
function aggregateHoldings({
  realBalances = [],
  manualHoldings = [],
  includeRealSpot = true,
  includeManual = true,
}) {
  /** @type {Map<string, { symbol: string, quantity: number, costBasis: number, sources: { real: number, manual: number } }>} */
  const map = new Map();

  const upsert = (symbol, qty, cost, kind) => {
    if (!symbol || !(qty > 1e-12)) return;
    const key = normSymbol(symbol);
    const entry = map.get(key) || {
      symbol: key,
      quantity: 0,
      costBasis: 0,
      sources: { real: 0, manual: 0 },
    };
    entry.quantity += qty;
    if (cost > 0) entry.costBasis += cost;
    entry.sources[kind] += qty;
    map.set(key, entry);
  };

  if (includeRealSpot && Array.isArray(realBalances)) {
    for (const row of realBalances) {
      const qty = safe(Number(row?.total ?? row?.free ?? 0));
      upsert(row?.currency, qty, 0, "real");
    }
  }

  if (includeManual && Array.isArray(manualHoldings)) {
    for (const h of manualHoldings) {
      const qty = safe(Number(h?.quantity ?? 0));
      const cost = safe(Number(h?.avgCost ?? 0)) * qty;
      upsert(h?.symbol, qty, cost, "manual");
    }
  }

  return map;
}

/**
 * @param {Map<string, ReturnType<typeof aggregateHoldings> extends Map<any, infer V> ? V : never>} holdings
 */
async function priceSymbols(holdings) {
  const symbols = [...holdings.keys()].filter((s) => !STABLE_USD_LIKE.has(s));
  const pairs = [...new Set(symbols.map((s) => defaultPairForBase(s)))];
  if (pairs.length === 0) return new Map();
  try {
    return await getPricesBatch(pairs);
  } catch {
    return new Map();
  }
}

/**
 * @param {{
 *   realBalances?: { currency: string, free: number, used?: number, total?: number }[],
 *   portfolio?: {
 *     quoteAsset?: string,
 *     tolerancePct?: number,
 *     includeRealSpot?: boolean,
 *     includeManual?: boolean,
 *     targets?: { symbol: string, targetPct: number, note?: string }[],
 *     manualHoldings?: { symbol: string, quantity: number, avgCost?: number, note?: string }[],
 *   } | null,
 * }} ctx
 */
export async function computePortfolioSnapshot(ctx) {
  const portfolio = ctx.portfolio || {};
  const quoteAsset = portfolio.quoteAsset || DEFAULT_QUOTE_ASSET;
  const tolerancePct = safe(Number(portfolio.tolerancePct ?? 5));
  const dustThresholdUsd = Math.max(
    0,
    safe(Number(portfolio.dustThresholdUsd ?? DEFAULT_DUST_THRESHOLD_USD))
  );
  const includeRealSpot = portfolio.includeRealSpot !== false;
  const includeManual = portfolio.includeManual !== false;

  /** Hartă target-uri (sumate pe simbol, dedupe defensiv). */
  /** @type {Map<string, { targetPct: number, note: string }>} */
  const targetsMap = new Map();
  for (const t of Array.isArray(portfolio.targets) ? portfolio.targets : []) {
    const sym = normSymbol(t?.symbol);
    if (!sym) continue;
    const pct = safe(Number(t?.targetPct));
    const prev = targetsMap.get(sym);
    targetsMap.set(sym, {
      targetPct: (prev?.targetPct ?? 0) + pct,
      note: String(t?.note ?? prev?.note ?? ""),
    });
  }

  const holdings = aggregateHoldings({
    realBalances: ctx.realBalances,
    manualHoldings: portfolio.manualHoldings,
    includeRealSpot,
    includeManual,
  });

  const prices = await priceSymbols(holdings);

  /** Construim lista unită: holdings ∪ targets. */
  const allSymbols = new Set([...holdings.keys(), ...targetsMap.keys()]);

  /** @type {{ symbol: string, quantity: number, price: number, valueUsd: number, costBasis: number, targetPct: number|null, currentPct: number, driftPct: number, action: "buy"|"sell"|"hold"|"open"|"close", deltaUsd: number, note: string, sources: { real: number, manual: number }, isStable: boolean }[]} */
  const rowsRaw = [];
  let totalValue = 0;

  for (const sym of allSymbols) {
    const hold = holdings.get(sym);
    const tgt = targetsMap.get(sym);
    const isStable = STABLE_USD_LIKE.has(sym);

    let price = 1;
    if (!isStable) {
      const pair = defaultPairForBase(sym);
      price = safe(Number(prices.get(pair) ?? 0));
    }

    const quantity = safe(hold?.quantity ?? 0);
    const valueUsd = quantity * price;
    totalValue += valueUsd;

    rowsRaw.push({
      symbol: sym,
      quantity,
      price,
      valueUsd,
      costBasis: safe(hold?.costBasis ?? 0),
      targetPct: tgt ? round(tgt.targetPct, 2) : null,
      currentPct: 0,
      driftPct: 0,
      action: "hold",
      deltaUsd: 0,
      note: tgt?.note || "",
      sources: hold?.sources || { real: 0, manual: 0 },
      isStable,
    });
  }

  const targetsTotalPct = round(
    [...targetsMap.values()].reduce((s, t) => s + safe(t.targetPct), 0),
    2
  );

  const rows = rowsRaw
    .map((r) => {
      const currentPct = totalValue > 0 ? (r.valueUsd / totalValue) * 100 : 0;
      const targetPct = r.targetPct;
      const driftPct = targetPct == null ? 0 : currentPct - targetPct;
      /** deltaUsd pozitiv = trebuie cumpărat, negativ = trebuie vândut (pentru a reveni la țintă). */
      const deltaUsd =
        targetPct == null ? 0 : (targetPct - currentPct) * (totalValue / 100);

      /** @type {"buy"|"sell"|"hold"|"open"|"close"} */
      let action = "hold";
      if (targetPct == null) {
        action = r.quantity > 1e-12 ? "close" : "hold";
      } else if (r.quantity <= 1e-12 && targetPct > 0) {
        action = "open";
      } else if (driftPct > tolerancePct) {
        action = "sell";
      } else if (driftPct < -tolerancePct) {
        action = "buy";
      }

      /**
       * Praf = balanță reziduală sub pragul USD și fără țintă activă.
       * Stabilele și activele cu țintă > 0 NU sunt marcate ca praf (chiar dacă valoarea e mică),
       * pentru că e relevant să vezi că o alocare plănuită e subponderată.
       */
      const isDust =
        r.quantity > 1e-12 &&
        !r.isStable &&
        r.valueUsd < dustThresholdUsd &&
        (targetPct == null || targetPct <= 0);

      return {
        ...r,
        currentPct: round(currentPct, 2),
        driftPct: round(driftPct, 2),
        deltaUsd: round(deltaUsd, 2),
        action,
        valueUsd: round(r.valueUsd, 2),
        costBasis: round(r.costBasis, 2),
        price: round(r.price, 8),
        quantity: round(r.quantity, 10),
        isDust,
      };
    })
    .sort((a, b) => b.valueUsd - a.valueUsd || a.symbol.localeCompare(b.symbol));

  /** Alerte high-level pentru UI. */
  const alerts = [];
  if (Math.abs(targetsTotalPct - 100) > 0.01 && targetsMap.size > 0) {
    alerts.push({
      level: "warn",
      code: "targets_sum",
      message: `Suma țintelor este ${targetsTotalPct}% (ideal 100%).`,
    });
  }
  const driftHits = rows.filter((r) => r.targetPct != null && Math.abs(r.driftPct) > tolerancePct);
  if (driftHits.length > 0) {
    alerts.push({
      level: "warn",
      code: "drift",
      message: `${driftHits.length} alocări depășesc toleranța de ±${tolerancePct} pp.`,
    });
  }
  const topConcentration = rows[0];
  if (topConcentration && topConcentration.currentPct >= CONCENTRATION_WARN_PCT) {
    alerts.push({
      level: "info",
      code: "concentration",
      message: `${topConcentration.symbol} reprezintă ${topConcentration.currentPct}% din portofoliu.`,
    });
  }
  const orphanHeld = rows.filter(
    (r) => r.targetPct == null && r.quantity > 1e-12 && !r.isStable
  );
  if (orphanHeld.length > 0) {
    alerts.push({
      level: "info",
      code: "orphan",
      message: `${orphanHeld.length} active deținute nu au țintă definită.`,
    });
  }

  const totalCost = rows.reduce((s, r) => s + r.costBasis, 0);
  const pnlUsd = totalCost > 0 ? totalValue - totalCost : 0;
  const pnlPct = totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0;

  const dustRows = rows.filter((r) => r.isDust);
  const dustValueUsd = round(
    dustRows.reduce((s, r) => s + r.valueUsd, 0),
    2
  );

  if (dustRows.length > 0) {
    alerts.push({
      level: "info",
      code: "dust",
      message: `${dustRows.length} ${dustRows.length === 1 ? "activ" : "active"} sub $${dustThresholdUsd} (≈ ${dustValueUsd} USD total) — praf rezidual.`,
    });
  }

  return {
    quoteAsset,
    tolerancePct,
    dustThresholdUsd,
    totals: {
      valueUsd: round(totalValue, 2),
      costUsd: round(totalCost, 2),
      pnlUsd: round(pnlUsd, 2),
      pnlPct: round(pnlPct, 2),
      targetsTotalPct,
      assetCount: rows.filter((r) => r.quantity > 1e-12).length,
      dustCount: dustRows.length,
      dustValueUsd,
    },
    rows,
    alerts,
    sources: {
      includedRealSpot: includeRealSpot,
      includedManual: includeManual,
    },
  };
}

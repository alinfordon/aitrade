import { DEFAULT_QUOTE_ASSET } from "@/lib/market-defaults";

/**
 * Estimează valoarea în ~USD a părții **libere** dintr-un rând de sold (după
 * `attachUsdTotalsToBalances`), proporțional cu free/total.
 */
export function estimateFreeUsdFromRow(row) {
  if (!row || typeof row !== "object") return 0;
  const f = Number(row.free ?? 0);
  const u = Number(row.used ?? 0);
  const t = Number(row.total ?? f + u);
  if (f <= 1e-12 || t <= 1e-12) return 0;
  const usdTotal = Number(row.usdTotal);
  if (!Number.isFinite(usdTotal)) return 0;
  return Number((usdTotal * (f / t)).toFixed(8));
}

/**
 * Active non-USDC cu **free** estimat sub `maxUsd` (implicit 1), pentru
 * market sell în `BASE/USDC`. BNB e exclus implicit (taxe pe Binance).
 */
export function pickDustCandidatesForUsdc(rows, opts = {}) {
  const maxUsd = Number(opts.maxUsd);
  const cap = Number.isFinite(maxUsd) && maxUsd > 0 ? maxUsd : 1;
  const skipBnb = opts.skipBnb !== false;
  const out = [];
  for (const row of rows || []) {
    const c = String(row.currency || "");
    if (!c || c === DEFAULT_QUOTE_ASSET) continue;
    if (skipBnb && c === "BNB") continue;
    const freeUsd = estimateFreeUsdFromRow(row);
    if (freeUsd <= 1e-10) continue;
    if (freeUsd >= cap) continue;
    out.push({
      currency: c,
      free: Number(row.free ?? 0),
      used: Number(row.used ?? 0),
      total: Number(row.total ?? 0),
      usdTotal: row.usdTotal,
      freeUsdEstimate: freeUsd,
      pair: `${c}/${DEFAULT_QUOTE_ASSET}`,
    });
  }
  /* Afișare / procesare: de la cea mai mare valoare estimată la cea mai mică */
  out.sort((a, b) => b.freeUsdEstimate - a.freeUsdEstimate);
  return out;
}

export function formatSpotBalanceRows(balanceResponse) {
  const free = balanceResponse.free || {};
  const used = balanceResponse.used || {};
  const total = balanceResponse.total || {};
  const keys = new Set([...Object.keys(free), ...Object.keys(used), ...Object.keys(total)]);
  const rows = [];
  for (const currency of keys) {
    const f = Number(free[currency] ?? 0);
    const u = Number(used[currency] ?? 0);
    const t = Number(total[currency] ?? f + u);
    if (t > 1e-12 || f > 1e-12 || u > 1e-12) {
      rows.push({ currency, free: f, used: u, total: t, kind: "spot" });
    }
  }
  return rows.sort((a, b) => {
    if (a.currency === DEFAULT_QUOTE_ASSET) return -1;
    if (b.currency === DEFAULT_QUOTE_ASSET) return 1;
    return b.free - a.free || a.currency.localeCompare(b.currency);
  });
}

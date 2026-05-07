import { getBalance } from "@/lib/binance/service";
import { binanceConvertFromAssetToQuote } from "@/lib/binance/convert-via-quote";
import { attachUsdTotalsToBalances } from "@/lib/wallet/usdc-overview";
import {
  formatSpotBalanceRows,
  pickDustCandidatesForUsdc,
} from "@/lib/wallet/dust-usdc";
import { DEFAULT_QUOTE_ASSET } from "@/lib/market-defaults";

function normCurrency(sym) {
  return String(sym || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Binance **Convert** (getQuote + acceptQuote), nu Spot MARKET — potrivit pentru praf sub NOTIONAL Spot.
 *
 * @param {{ apiKey: string, secret: string, maxUsd?: number, skipBnb?: boolean, currency?: string }} args
 * — dacă `currency` e setat, doar acea monedă (trebuie să treacă filtrele de praf).
 */
export async function runConvertDustToUsdc(args) {
  const { apiKey, secret } = args;
  const maxUsd = Number(args.maxUsd);
  const cap = Number.isFinite(maxUsd) && maxUsd > 0 ? maxUsd : 1;
  const skipBnb = args.skipBnb !== false;
  const onlyCur = normCurrency(args.currency);

  if (!apiKey || !secret) {
    return { ok: false, error: "no_api_keys", results: [], summary: { attempted: 0, sold: 0, failed: 0 } };
  }

  const raw = await getBalance(apiKey, secret, { futures: false });
  const rows = formatSpotBalanceRows(raw);
  const enriched = await attachUsdTotalsToBalances(rows);
  let candidates = pickDustCandidatesForUsdc(enriched, { maxUsd: cap, skipBnb });

  if (onlyCur) {
    candidates = candidates.filter((c) => c.currency === onlyCur);
    if (!candidates.length) {
      return {
        ok: false,
        error: "not_eligible",
        message:
          `„${onlyCur}” nu e eligibilă (nu sub ~${cap} USDC liber estimat, e USDC/BNB exclusă sau lipsă din logică).`,
        results: [],
        summary: { candidates: 0, attempted: 0, sold: 0, failed: 0 },
      };
    }
  }

  const results = [];
  let sold = 0;
  let failed = 0;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const pair = `${c.currency}/${DEFAULT_QUOTE_ASSET}`;
    const amt = Number(c.free);
    if (!(amt > 0)) {
      failed++;
      results.push({
        currency: c.currency,
        pair,
        via: "binance_convert",
        free: amt,
        freeUsdEstimate: c.freeUsdEstimate,
        ok: false,
        code: "zero_free",
        error: "Sold liber zero.",
      });
      continue;
    }

    try {
      const conv = await binanceConvertFromAssetToQuote({
        apiKey,
        secret,
        fromAsset: c.currency,
        amountBase: amt,
      });
      sold++;
      results.push({
        currency: c.currency,
        pair,
        via: "binance_convert",
        free: amt,
        freeUsdEstimate: c.freeUsdEstimate,
        ok: true,
        filled: conv.fromAmount,
        quoteReceived: conv.toAmountEstimate,
        quoteId: conv.quoteId,
        orderId: conv.orderId,
        orderStatus: conv.orderStatus,
      });
    } catch (e) {
      failed++;
      const code = e && typeof e === "object" && e.code ? String(e.code) : "CONVERT_FAILED";
      const error = e instanceof Error ? e.message : String(e);
      results.push({
        currency: c.currency,
        pair,
        via: "binance_convert",
        free: amt,
        freeUsdEstimate: c.freeUsdEstimate,
        ok: false,
        code,
        error,
      });
    }

    if (i < candidates.length - 1) {
      await sleep(400);
    }
  }

  return {
    ok: true,
    thresholdUsd: cap,
    skipBnb,
    via: "binance_convert",
    results,
    summary: {
      candidates: candidates.length,
      attempted: candidates.length,
      sold,
      failed,
    },
  };
}

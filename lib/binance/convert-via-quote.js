import { createExchange, syncServerTime, withRetries } from "@/lib/binance/client";
import { DEFAULT_QUOTE_ASSET } from "@/lib/market-defaults";

/**
 * Trunchiere spre zero la max `dec` zecimale — fără a folosi precision CCXT care uneori e 0,
 * ceea ce cu Math.floor zerifica complet praful (ex. PENDLE).
 */
function truncateTowardZero(n, maxDec = 12) {
  const x = Number(n);
  if (!(Number.isFinite(x) && x > 0)) return null;
  const f = 10 ** maxDec;
  const t = Math.trunc(x * f + Number.EPSILON) / f;
  return t > 0 ? t : x;
}

/**
 * Conversie Binance **Convert** (SAPI), nu Spot MARKET.
 * Flux: getQuote → acceptQuote.
 *
 * @param {{ apiKey: string, secret: string, fromAsset: string, amountBase: number }} args
 * @returns {Promise<{ quoteId: string, orderId: string | null, orderStatus: string | null, fromAmount: number, toAmountEstimate: number | null, rawQuote?: object, rawTrade?: object }>}
 */
export async function binanceConvertFromAssetToQuote({
  apiKey,
  secret,
  fromAsset,
  amountBase,
}) {
  const from = String(fromAsset || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const to = DEFAULT_QUOTE_ASSET;
  if (!from || from === to) {
    const err = new Error("Monedă sursă invalidă.");
    err.code = "INVALID_ASSET";
    throw err;
  }

  const amt = Number(amountBase);
  if (!(Number.isFinite(amt) && amt > 0)) {
    const err = new Error("Cantitate invalidă.");
    err.code = "INVALID_AMOUNT";
    throw err;
  }

  const ex = createExchange({ apiKey, secret, futures: false });
  await syncServerTime(ex);
  await withRetries(() => ex.loadMarkets(), { exchange: ex });

  /** Nu folosi currency.precision + Math.floor: pentru multe active CCXT are precision 0 și 0.09 → 0. */
  let convertAmount = truncateTowardZero(amt, 12);
  if (convertAmount == null || !(convertAmount > 0)) {
    convertAmount = amt;
  }

  if (!(convertAmount > 0)) {
    const err = new Error("Cantitate zero după rotunjire.");
    err.code = "INVALID_AMOUNT";
    throw err;
  }

  const quote = await withRetries(
    () =>
      ex.fetchConvertQuote(from, to, convertAmount, {
        walletType: "SPOT",
      }),
    { exchange: ex }
  );

  const info = quote?.info && typeof quote.info === "object" ? quote.info : {};
  const quoteId =
    quote?.id != null && String(quote.id).trim() !== ""
      ? String(quote.id)
      : info.quoteId != null
        ? String(info.quoteId)
        : null;

  if (!quoteId) {
    const err = new Error(
      "Binance Convert nu a returnat ofertă ( quoteId ). Perechea sau suma pot fi indisponibile în Convert — verifică în Binance și drepturile API pentru Convert."
    );
    err.code = "NO_QUOTE";
    throw err;
  }

  const trade = await withRetries(() => ex.createConvertTrade(quoteId, from, to), { exchange: ex });

  const tradeInfo = trade?.info && typeof trade.info === "object" ? trade.info : {};
  const toFromQuote =
    info.toAmount != null ? Number(info.toAmount) : quote?.cost != null ? Number(quote.cost) : null;

  return {
    quoteId,
    orderId:
      trade?.id != null
        ? String(trade.id)
        : tradeInfo.orderId != null
          ? String(tradeInfo.orderId)
          : null,
    orderStatus: tradeInfo.orderStatus != null ? String(tradeInfo.orderStatus) : null,
    fromAmount: convertAmount,
    toAmountEstimate: Number.isFinite(toFromQuote) ? toFromQuote : null,
    rawQuote: info,
    rawTrade: tradeInfo,
  };
}

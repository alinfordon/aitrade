/**
 * Binance Spot OCO (One-Cancels-the-Other) — plasarea / anularea / reconcilierea
 * ordinelor de protecție SL+TP direct pe exchange.
 *
 * Layer de siguranță principală pentru pozițiile spot reale:
 * - Binance execută SL / TP cu latență sub-secundă, indiferent dacă server-ul
 *   aplicației e up sau nu.
 * - Noi stocăm referințele (`orderListId`, `stopOrderId`, `limitOrderId`) în
 *   `user.liveProtections[pair].oco` și le sincronizăm la cron sau la buy/sell.
 *
 * OCO Spot pe Binance:
 * - `stopPrice` = nivelul SL (trigger).
 * - `stopLimitPrice` = prețul LIMIT la care se intră în order book după trigger
 *   (noi setăm `stopPrice × 0.998`, buffer 0.2% pentru fill în spike).
 * - `price` = prețul TP (LIMIT_MAKER).
 * - Cantitatea se blochează pe Binance — pentru a vinde manual, trebuie cancel
 *   OCO întâi.
 */
import ccxt from "ccxt";
import { createExchange, syncServerTime, withRetries } from "@/lib/binance/client";
import { resolveBinanceSpotSymbol, minSpotNotionalFromMarket } from "@/lib/binance/service";

/** Buffer sub stopPrice pentru LIMIT-ul SL; 0.2% e standard pentru spot USDC. */
const SL_LIMIT_BUFFER = 0.002;

/** PRICE_FILTER / tickSize filter al pieței. */
function readPriceFilter(market) {
  const filters = market?.info?.filters;
  if (!Array.isArray(filters)) return { tickSize: null, minPrice: null, maxPrice: null };
  for (const f of filters) {
    if (String(f.filterType) === "PRICE_FILTER") {
      const tickSize = f.tickSize != null ? Number(f.tickSize) : null;
      const minPrice = f.minPrice != null ? Number(f.minPrice) : null;
      const maxPrice = f.maxPrice != null ? Number(f.maxPrice) : null;
      return {
        tickSize: Number.isFinite(tickSize) && tickSize > 0 ? tickSize : null,
        minPrice: Number.isFinite(minPrice) && minPrice > 0 ? minPrice : null,
        maxPrice: Number.isFinite(maxPrice) && maxPrice > 0 ? maxPrice : null,
      };
    }
  }
  return { tickSize: null, minPrice: null, maxPrice: null };
}

function readLotSize(market) {
  const filters = market?.info?.filters;
  if (!Array.isArray(filters)) return { stepSize: null, minQty: null };
  for (const f of filters) {
    if (String(f.filterType) === "LOT_SIZE") {
      const stepSize = f.stepSize != null ? Number(f.stepSize) : null;
      const minQty = f.minQty != null ? Number(f.minQty) : null;
      return {
        stepSize: Number.isFinite(stepSize) && stepSize > 0 ? stepSize : null,
        minQty: Number.isFinite(minQty) && minQty > 0 ? minQty : null,
      };
    }
  }
  return { stepSize: null, minQty: null };
}

function floorToTick(value, tickSize) {
  if (!(Number.isFinite(tickSize) && tickSize > 0)) return value;
  return Math.floor(value / tickSize + 1e-10) * tickSize;
}

function floorToStep(value, stepSize) {
  if (!(Number.isFinite(stepSize) && stepSize > 0)) return value;
  return Math.floor(value / stepSize + 1e-10) * stepSize;
}

function ocoError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Plasează un OCO Spot SELL pe poziția curentă (SL + TP ambele).
 *
 * @param {{ apiKey: string, secret: string, pair: string, qty: number, stopLoss: number, takeProfit: number }} args
 * @returns {Promise<{ orderListId: string, stopOrderId: string | null, limitOrderId: string | null, placedQty: number, stopPrice: number, stopLimitPrice: number, limitPrice: number, symbol: string }>}
 */
export async function placeSpotOcoSell({ apiKey, secret, pair, qty, stopLoss, takeProfit }) {
  if (!apiKey || !secret) throw ocoError("NO_API_KEYS", "Chei API Binance lipsă.");
  const wantQty = Number(qty);
  const sl = Number(stopLoss);
  const tp = Number(takeProfit);
  if (!(Number.isFinite(wantQty) && wantQty > 0)) {
    throw ocoError("INVALID_QTY", "Cantitate OCO invalidă.");
  }
  if (!(Number.isFinite(sl) && sl > 0)) throw ocoError("INVALID_SL", "Stop loss invalid.");
  if (!(Number.isFinite(tp) && tp > 0)) throw ocoError("INVALID_TP", "Take profit invalid.");
  if (!(tp > sl)) {
    throw ocoError(
      "INVALID_LEVELS",
      "Pentru OCO pe poziție long, take profit trebuie > stop loss."
    );
  }

  const ex = createExchange({ apiKey, secret, futures: false });
  await syncServerTime(ex);
  await withRetries(() => ex.loadMarkets());
  await syncServerTime(ex);

  const sym = resolveBinanceSpotSymbol(ex, pair);
  if (!sym) throw ocoError("MARKET_NOT_FOUND", `Pereche spot indisponibilă: ${pair}`);
  const market = ex.markets[sym];
  const base = market.base;

  const bal = await withRetries(() => ex.fetchBalance(), { exchange: ex });
  const free = Number(bal.free?.[base] ?? 0) || 0;
  if (!(free > 0)) {
    throw ocoError(
      "INSUFFICIENT_FREE_BASE",
      `Sold ${base} liber pe Binance e 0 (posibil blocat într-un ordin existent). Anulează ordine deschise pe ${sym} și reîncearcă.`
    );
  }

  const lot = readLotSize(market);
  let qClamped = Math.min(wantQty, free);
  if (lot.stepSize != null) qClamped = floorToStep(qClamped, lot.stepSize);
  if (!(qClamped > 0)) {
    throw ocoError(
      "DUST_QTY",
      `Cantitate sub LOT_SIZE după aliniere (step ${lot.stepSize ?? "?"}, liber ${free}). Nu poate fi protejată cu OCO.`
    );
  }
  if (lot.minQty != null && qClamped + 1e-12 < lot.minQty) {
    throw ocoError(
      "BELOW_MIN_QTY",
      `Sub minQty Binance (${lot.minQty} ${base}); OCO imposibil.`
    );
  }

  const pf = readPriceFilter(market);
  const stopPriceRaw = floorToTick(sl, pf.tickSize ?? 0);
  const stopLimitPriceRaw = floorToTick(sl * (1 - SL_LIMIT_BUFFER), pf.tickSize ?? 0);
  const limitPriceRaw = floorToTick(tp, pf.tickSize ?? 0);
  if (!(stopPriceRaw > 0) || !(stopLimitPriceRaw > 0) || !(limitPriceRaw > 0)) {
    throw ocoError("INVALID_PRICE", "Preț invalid după aliniere la tickSize.");
  }
  if (!(limitPriceRaw > stopPriceRaw)) {
    throw ocoError(
      "INVALID_LEVELS",
      `După aliniere la tickSize, TP (${limitPriceRaw}) nu mai e > SL (${stopPriceRaw}).`
    );
  }

  const minNotional = minSpotNotionalFromMarket(market);
  if (minNotional != null) {
    const notionalSl = qClamped * stopPriceRaw;
    const notionalTp = qClamped * limitPriceRaw;
    if (Math.min(notionalSl, notionalTp) + 1e-12 < minNotional) {
      throw ocoError(
        "BELOW_MIN_NOTIONAL",
        `Valoarea estimată a OCO (~${notionalSl.toFixed(4)} / ~${notionalTp.toFixed(4)} ${market.quote}) e sub MIN_NOTIONAL (${minNotional}). Poziția e prea mică pentru protecție pe exchange.`
      );
    }
  }

  const qtyStr = ex.amountToPrecision(sym, qClamped);
  const stopStr = ex.priceToPrecision(sym, stopPriceRaw);
  const stopLimitStr = ex.priceToPrecision(sym, stopLimitPriceRaw);
  const limitStr = ex.priceToPrecision(sym, limitPriceRaw);
  const qtyNum = Number(qtyStr);
  const stopNum = Number(stopStr);
  const stopLimitNum = Number(stopLimitStr);
  const limitNum = Number(limitStr);

  let result;
  try {
    result = await withRetries(
      () =>
        ex.createOrder(sym, "OCO", "sell", qtyNum, limitNum, {
          stopPrice: stopNum,
          stopLimitPrice: stopLimitNum,
          stopLimitTimeInForce: "GTC",
        }),
      { exchange: ex }
    );
  } catch (e) {
    const msg = String(e?.message || e);
    const err = new Error(`OCO respins de Binance: ${msg}`);
    err.code = e?.code || "OCO_PLACE_FAILED";
    err.cause = e;
    throw err;
  }

  const info = result?.info || {};
  const orderListId =
    info.orderListId != null
      ? String(info.orderListId)
      : result?.id != null
        ? String(result.id)
        : null;
  const orderReports = Array.isArray(info.orderReports) ? info.orderReports : [];
  let stopOrderId = null;
  let limitOrderId = null;
  for (const o of orderReports) {
    const t = String(o.type || "").toUpperCase();
    if (t.includes("STOP")) stopOrderId = String(o.orderId);
    else if (t.includes("LIMIT")) limitOrderId = String(o.orderId);
  }

  if (!orderListId) {
    throw ocoError(
      "OCO_PLACE_FAILED",
      "Binance a răspuns fără orderListId; OCO nu s-a putut înregistra."
    );
  }

  return {
    orderListId,
    stopOrderId,
    limitOrderId,
    placedQty: qtyNum,
    stopPrice: stopNum,
    stopLimitPrice: stopLimitNum,
    limitPrice: limitNum,
    symbol: sym,
  };
}

function isOrderGoneError(e) {
  if (!e) return false;
  const msg = String(e?.message || "");
  if (e instanceof ccxt.OrderNotFound) return true;
  return /-2011|Unknown order|CANCEL_REJECTED|Order does not exist|Order list does not exist/i.test(msg);
}

/**
 * Anulează un OCO după `orderListId`. Tolerant la „deja cancel/filled”.
 */
export async function cancelSpotOco({ apiKey, secret, pair, orderListId }) {
  if (!apiKey || !secret) return { ok: false, alreadyGone: false, error: "no_api_keys" };
  if (!orderListId) return { ok: true, alreadyGone: true };

  const ex = createExchange({ apiKey, secret, futures: false });
  await syncServerTime(ex);
  await withRetries(() => ex.loadMarkets());
  await syncServerTime(ex);

  const sym = resolveBinanceSpotSymbol(ex, pair);
  if (!sym) return { ok: false, alreadyGone: false, error: "market_not_found" };

  try {
    await withRetries(
      () =>
        ex.privateDeleteOrderList({
          symbol: sym.replace("/", ""),
          orderListId: Number(orderListId),
        }),
      { exchange: ex }
    );
    return { ok: true, alreadyGone: false };
  } catch (e) {
    if (isOrderGoneError(e)) return { ok: true, alreadyGone: true };
    return {
      ok: false,
      alreadyGone: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Defensivă: anulează TOATE ordinele open pe pereche (după modificări manuale
 * pe Binance sau recovery). Folosește `cancelAllOrders` din ccxt.
 */
export async function cancelAllSpotOrdersForPair({ apiKey, secret, pair }) {
  if (!apiKey || !secret) return { ok: false, cancelled: 0, error: "no_api_keys" };
  const ex = createExchange({ apiKey, secret, futures: false });
  await syncServerTime(ex);
  await withRetries(() => ex.loadMarkets());
  await syncServerTime(ex);
  const sym = resolveBinanceSpotSymbol(ex, pair);
  if (!sym) return { ok: false, cancelled: 0, error: "market_not_found" };

  try {
    const res = await withRetries(() => ex.cancelAllOrders(sym), { exchange: ex });
    const cancelled = Array.isArray(res) ? res.length : res?.orderReports?.length ?? 0;
    return { ok: true, cancelled };
  } catch (e) {
    if (isOrderGoneError(e)) return { ok: true, cancelled: 0 };
    return {
      ok: false,
      cancelled: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Interoghează Binance pentru un OCO cunoscut și returnează starea lui sau
 * `gone: true` dacă nu mai există (a fost executat / cancelat manual).
 */
export async function fetchOcoStatus({ apiKey, secret, pair, orderListId }) {
  if (!apiKey || !secret || !orderListId) return { gone: true };
  const ex = createExchange({ apiKey, secret, futures: false });
  await syncServerTime(ex);
  await withRetries(() => ex.loadMarkets());
  await syncServerTime(ex);
  const sym = resolveBinanceSpotSymbol(ex, pair);
  if (!sym) return { gone: true };

  try {
    const res = await withRetries(
      () =>
        ex.privateGetOrderList({
          orderListId: Number(orderListId),
        }),
      { exchange: ex }
    );
    const status = String(res?.listOrderStatus || res?.orderListStatus || "").toUpperCase();
    const contingencyType = String(res?.contingencyType || "OCO").toUpperCase();
    /** EXECUTING = în așteptare; ALL_DONE = unul din leg-uri s-a umplut; REJECT = refuzat la plasare. */
    const active = status === "EXECUTING" || status === "EXEC_STARTED";
    return {
      gone: !active,
      status: status || null,
      contingencyType,
      raw: res,
    };
  } catch (e) {
    if (isOrderGoneError(e)) return { gone: true };
    return { gone: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Detaliile fill-ului unui OCO finalizat: care leg s-a executat (SL / TP),
 * cantitatea umplută, prețul mediu, status-urile celor două ordine.
 *
 * @returns {Promise<{ ok: boolean, symbol?: string, filledQty?: number, avgPrice?: number, trigger?: "sl" | "tp" | null, stop?: any, limit?: any, error?: string }>}
 */
export async function fetchOcoFillDetails({
  apiKey,
  secret,
  pair,
  stopOrderId,
  limitOrderId,
}) {
  if (!apiKey || !secret) return { ok: false, error: "no_api_keys" };
  const ex = createExchange({ apiKey, secret, futures: false });
  await syncServerTime(ex);
  await withRetries(() => ex.loadMarkets());
  await syncServerTime(ex);
  const sym = resolveBinanceSpotSymbol(ex, pair);
  if (!sym) return { ok: false, error: "market_not_found" };

  async function safeFetch(id) {
    if (!id) return null;
    try {
      return await withRetries(() => ex.fetchOrder(String(id), sym), { exchange: ex });
    } catch (e) {
      if (isOrderGoneError(e)) return null;
      return null;
    }
  }

  const [stop, limit] = await Promise.all([
    safeFetch(stopOrderId),
    safeFetch(limitOrderId),
  ]);

  let trigger = null;
  let filledQty = 0;
  let weightedCost = 0;

  for (const [label, o] of [["sl", stop], ["tp", limit]]) {
    if (!o) continue;
    const f = Number(o.filled ?? 0);
    if (Number.isFinite(f) && f > 0) {
      const px = Number(o.average || o.price || 0);
      filledQty += f;
      weightedCost += f * (Number.isFinite(px) ? px : 0);
      if (trigger == null) trigger = label;
    }
  }

  return {
    ok: true,
    symbol: sym,
    filledQty,
    avgPrice: filledQty > 0 ? weightedCost / filledQty : 0,
    trigger,
    stop,
    limit,
  };
}

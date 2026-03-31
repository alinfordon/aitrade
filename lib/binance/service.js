import ccxt from "ccxt";
import { createExchange, withRetries, syncServerTime } from "./client";

/**
 * Pereche spot Binance exactă (fără remap la alte cote — aplicația folosește doar USDC ca default).
 * @param {import("ccxt").Exchange} ex
 * @param {string} symbol ex. BTC/USDC
 * @returns {string | null}
 */
export function resolveBinanceSpotSymbol(ex, symbol) {
  if (!symbol || typeof symbol !== "string") return null;
  const s = symbol.trim().replace(/-/g, "/");
  return ex.markets[s] ? s : null;
}

/** Valoare minimă a ordinului în moneda cotei (MIN_NOTIONAL / NOTIONAL), sau null dacă nu e în market. */
export function minSpotNotionalFromMarket(m) {
  if (!m || typeof m !== "object") return null;
  const fromLimits = m.limits?.cost?.min;
  if (fromLimits != null) {
    const n = Number(fromLimits);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const filters = m.info?.filters;
  if (!Array.isArray(filters)) return null;
  for (const f of filters) {
    const t = f.filterType;
    if ((t === "NOTIONAL" || t === "MIN_NOTIONAL") && f.minNotional != null) {
      const n = Number(f.minNotional);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

/**
 * LOT_SIZE Binance: minQty și stepSize (mai fiabil decât `limits.amount` pe unele perechi, ex. FET/USDC).
 * @param {import("ccxt").Market} market
 */
function readLotSizeFilter(market) {
  const filters = market?.info?.filters;
  if (!Array.isArray(filters)) return { minQty: null, stepSize: null };
  for (const f of filters) {
    if (String(f.filterType) === "LOT_SIZE") {
      const minQty = f.minQty != null ? Number(f.minQty) : null;
      const stepSize = f.stepSize != null ? Number(f.stepSize) : null;
      return {
        minQty: Number.isFinite(minQty) && minQty > 0 ? minQty : null,
        stepSize: Number.isFinite(stepSize) && stepSize > 0 ? stepSize : null,
      };
    }
  }
  return { minQty: null, stepSize: null };
}

/** Scade la multiplu de stepSize — Binance respinge cantități nealiniate la pas (ex. praf după float). */
function floorQtyToLotStep(qty, stepSize) {
  if (!(Number.isFinite(qty) && qty > 0) || !(Number.isFinite(stepSize) && stepSize > 0)) {
    return qty;
  }
  const n = Math.floor(qty / stepSize + 1e-10);
  return n * stepSize;
}

/**
 * Mapare BASE/USDC sau BASE/USDT → simbol CCXT perpetual USDT-M (Binance USDM).
 * @param {string} pair
 * @returns {string | null}
 */
function linearUsdmPerpSymbolFromPair(pair) {
  const s = String(pair || "")
    .trim()
    .replace(/-/g, "/");
  const parts = s.split("/");
  if (parts.length !== 2) return null;
  const base = parts[0].toUpperCase();
  const quote = parts[1].toUpperCase();
  if (quote !== "USDC" && quote !== "USDT") return null;
  return `${base}/USDT:USDT`;
}

/** Last ticker price (spot sau futures). Spot: doar simboluri listate (rezolvare strictă). */
export async function getPrice(symbol, opts = {}) {
  const ex = createExchange({ futures: opts.futures });
  await withRetries(() => ex.loadMarkets());
  let sym = String(symbol).trim().replace(/-/g, "/");
  if (!opts.futures) {
    const r = resolveBinanceSpotSymbol(ex, sym);
    if (!r) {
      const err = new Error(`Pereche spot indisponibilă: ${sym}`);
      err.code = "MARKET_NOT_FOUND";
      throw err;
    }
    sym = r;
  }
  const t = await withRetries(() => ex.fetchTicker(sym));
  return Number(t.last || t.info?.lastPrice || 0);
}

/**
 * OHLCV: [ts, o, h, l, c, v][], sau `{ rows, resolvedSymbol, dataSource? }` dacă `opts.returnResolvedSymbol`.
 * @param {string} symbol
 * @param {string} [timeframe]
 * @param {number} [limit]
 * @param {{ futures?: boolean, returnResolvedSymbol?: boolean, allowLinearPerpFallback?: boolean }} [opts]
 */
export async function fetchOHLCV(symbol, timeframe = "1h", limit = 200, opts = {}) {
  const {
    returnResolvedSymbol,
    allowLinearPerpFallback = false,
    ...exOpts
  } = opts ?? {};

  let tradeSymbol = String(symbol).trim().replace(/-/g, "/");

  if (exOpts.futures) {
    const ex = createExchange({ futures: true });
    await withRetries(() => ex.loadMarkets());
    const rows = await withRetries(() => ex.fetchOHLCV(tradeSymbol, timeframe, undefined, limit));
    if (returnResolvedSymbol) {
      return { rows, resolvedSymbol: tradeSymbol, dataSource: "linear_perp" };
    }
    return rows;
  }

  const spotEx = createExchange({ futures: false });
  await withRetries(() => spotEx.loadMarkets());

  const spotResolved = resolveBinanceSpotSymbol(spotEx, tradeSymbol);
  if (spotResolved) {
    const rows = await withRetries(() =>
      spotEx.fetchOHLCV(spotResolved, timeframe, undefined, limit)
    );
    if (returnResolvedSymbol) {
      return { rows, resolvedSymbol: spotResolved, dataSource: "spot" };
    }
    return rows;
  }

  if (allowLinearPerpFallback) {
    const linearSym = linearUsdmPerpSymbolFromPair(tradeSymbol);
    if (linearSym) {
      const futEx = createExchange({ futures: true });
      await withRetries(() => futEx.loadMarkets());
      if (futEx.markets[linearSym]) {
        const rows = await withRetries(() =>
          futEx.fetchOHLCV(linearSym, timeframe, undefined, limit)
        );
        if (returnResolvedSymbol) {
          return {
            rows,
            resolvedSymbol: tradeSymbol,
            dataSource: "linear_perp",
          };
        }
        return rows;
      }
    }
  }

  const err = new Error(
    `Pereche indisponibilă pe Binance spot (verifică că există cu cotă USDC): ${tradeSymbol}`
  );
  err.code = "MARKET_NOT_FOUND";
  throw err;
}

/** Mapare erori CCXT → status HTTP pentru rute publice. */
export function httpStatusForOhlcvError(e) {
  if (e && typeof e === "object" && e.code === "MARKET_NOT_FOUND") return 404;
  if (e instanceof ccxt.BadSymbol) return 404;
  const msg = String(e?.message || e);
  if (/does not have market symbol|invalid symbol|unknown symbol|market not found|bad symbol/i.test(msg)) {
    return 404;
  }
  if (e instanceof ccxt.RateLimitExceeded || e instanceof ccxt.DDoSProtection) return 429;
  return 502;
}

export async function getBalance(apiKey, secret, opts = {}) {
  const ex = createExchange({ apiKey, secret, futures: opts.futures });
  await syncServerTime(ex);
  await withRetries(() => ex.loadMarkets());
  await syncServerTime(ex);
  const b = await withRetries(() => ex.fetchBalance(), { exchange: ex });
  return b;
}

/**
 * Spot market buy/sell by quote or base. Simplifies to market order.
 */
export async function placeOrder(
  { apiKey, secret, symbol, side, amount, price, orderType = "market", futures = false },
  opts = {}
) {
  const ex = createExchange({ apiKey, secret, futures });
  await syncServerTime(ex);
  await withRetries(() => ex.loadMarkets());
  await syncServerTime(ex);
  const type = orderType;
  const params = {};
  const orderSide = side === "buy" ? "buy" : "sell";

  if (type === "market") {
    const order = await withRetries(
      () => ex.createOrder(symbol, "market", orderSide, amount, price ?? undefined, params),
      { exchange: ex }
    );
    return order;
  }

  const order = await withRetries(
    () => ex.createOrder(symbol, type, orderSide, amount, price, params),
    { exchange: ex }
  );
  return order;
}

/**
 * Sell spot: limitează cantitatea la soldul liber (base) + pasul pieței.
 * Reduce erorile „Account has insufficient balance” când botul are cantitate ușor supraestimată față de Binance.
 */
export async function placeMarketSellSpotClamped({ apiKey, secret, symbol, amountBase }) {
  const ex = createExchange({ apiKey, secret, futures: false });
  await syncServerTime(ex);
  await withRetries(() => ex.loadMarkets());
  await syncServerTime(ex);

  const symNorm = String(symbol || "").trim().replace(/-/g, "/");
  const sym = resolveBinanceSpotSymbol(ex, symNorm);
  if (!sym) {
    const err = new Error(`Pereche spot indisponibilă: ${symNorm}`);
    err.code = "MARKET_NOT_FOUND";
    throw err;
  }

  const m = ex.markets[sym];
  const base = m.base;
  const bal = await withRetries(() => ex.fetchBalance(), { exchange: ex });
  const free = Number(bal.free?.[base] ?? 0) || 0;
  const want = Number(amountBase);

  if (!Number.isFinite(want) || want <= 0) {
    const err = new Error("Cantitate de vânzare invalidă.");
    err.code = "INVALID_AMOUNT";
    throw err;
  }

  const lot = readLotSizeFilter(m);
  let qty = Math.min(want, free);
  if (!(qty > 0)) {
    const err = new Error(
      `Sold ${base} insuficient pe Binance: disponibil ${free}, cerut din poziție ${want}.`
    );
    err.code = "INSUFFICIENT_BALANCE";
    throw err;
  }

  if (lot.stepSize != null) {
    qty = floorQtyToLotStep(qty, lot.stepSize);
  }

  if (!(qty > 0)) {
    const err = new Error(
      `După alinierea la pasul LOT_SIZE (${lot.stepSize ?? "?"} ${base}), cantitatea de vânzare e nulă. Liber: ${free} ${base}. Verifică soldul pe Binance față de poziția din app.`
    );
    err.code = "DUST_AMOUNT";
    throw err;
  }

  const qtyStr = ex.amountToPrecision(sym, qty);
  const qtyN = Number(qtyStr);
  if (!Number.isFinite(qtyN) || qtyN <= 0) {
    const err = new Error(
      `După rotunjire Binance, cantitatea de vânzare e nulă (liber ${base}: ${free}).`
    );
    err.code = "DUST_AMOUNT";
    throw err;
  }

  const minAmt = lot.minQty ?? m.limits?.amount?.min ?? null;
  if (minAmt != null && qtyN + 1e-12 < Number(minAmt)) {
    const err = new Error(
      `Sub minimul de cantitate Binance pentru ${sym}: minim ${minAmt} ${base} (LOT_SIZE), disponibil aliniat la pas ~${qtyN} ${base}. Restul e „praf” — închide din Binance (Convert) sau așteaptă sold suficient.`
    );
    err.code = "BELOW_MIN_AMOUNT";
    throw err;
  }

  const t = await withRetries(() => ex.fetchTicker(sym), { exchange: ex });
  const px = Number(t.last || t.bid || t.ask || 0);
  if (!(px > 0)) {
    const err = new Error(`Preț indisponibil pentru ${sym}.`);
    err.code = "NO_PRICE";
    throw err;
  }
  const estNotional = qtyN * px;
  const minNotional = minSpotNotionalFromMarket(m);
  const quote = m.quote || "QUOTE";
  if (minNotional != null && estNotional + 1e-12 < minNotional) {
    const err = new Error(
      `Valoarea estimată a vânzării (~${estNotional.toFixed(6)} ${quote}) e sub minimul Binance pentru ${sym} (≈${minNotional} ${quote}). Cantitatea e prea mică („dust”): folosește Convert / Trade pe Binance pentru rest sau adaugă în carte doar ce poți închide peste prag.`
    );
    err.code = "BELOW_MIN_NOTIONAL";
    throw err;
  }

  return withRetries(
    () => ex.createOrder(sym, "market", "sell", qtyStr, undefined, {}),
    { exchange: ex }
  );
}

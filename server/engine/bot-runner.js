import crypto from "crypto";
import { connectDB } from "@/models/db";
import { Bot, Strategy, User, Trade } from "@/models";
import {
  fetchOHLCV,
  getPrice,
  placeMarketSellSpotClamped,
  placeOrder,
  getBalance,
  fetchBinanceSpotMarket,
  spotMaxSellableBaseFromFree,
} from "@/lib/binance/service";
import { withRetries } from "@/lib/binance/client";
import { isBinanceMarketClosedError } from "@/lib/binance/map-exchange-error";
import { isDustOrMinNotionalError } from "@/server/trading/execute-manual";
import { ohlcvToSeries } from "@/server/candles";
import { evaluateStrategy } from "@/server/engine/strategy-eval";
import { decryptSecret } from "@/lib/security/crypto";
import {
  getCachedPrice,
  setCachedPrice,
  acquireOrderLock,
  getDailyLoss,
  incrDailyLoss,
} from "@/lib/redis/cache";
import { utcDateKey } from "@/lib/utils";
import { replicateTradeForFollowers } from "@/server/copy-trading";
import { DEFAULT_QUOTE_ASSET } from "@/lib/market-defaults";

function pctChange(a, b) {
  const A = Number(a);
  const B = Number(b);
  if (!Number.isFinite(A) || !Number.isFinite(B) || B <= 0) return null;
  return A / B - 1;
}

/**
 * Cache partajat pe durata unei rulări `runActiveBotsBatch` ca să evităm
 * duplicarea call-urilor scumpe (user doc, OHLCV pe aceeași pereche/timeframe,
 * balanță Binance pe același user). Se creează fresh per batch și se aruncă la final.
 */
function createBotRuntime() {
  return {
    userCache: new Map(), // userId -> User doc
    ohlcvCache: new Map(), // `${pair}:${tf}:${limit}:${fut}` -> rows
    balanceCache: new Map(), // `${userId}:${fut}` -> bal obj
  };
}

async function getUserCached(runtime, userId) {
  const key = String(userId);
  if (runtime?.userCache?.has(key)) return runtime.userCache.get(key);
  const u = await User.findById(userId);
  if (runtime?.userCache) runtime.userCache.set(key, u);
  return u;
}

async function getOHLCVCached(runtime, pair, timeframe, limit, opts = {}) {
  if (!runtime?.ohlcvCache) return fetchOHLCV(pair, timeframe, limit, opts);
  const fut = opts?.futures ? 1 : 0;
  const key = `${pair}:${timeframe}:${limit}:${fut}`;
  if (runtime.ohlcvCache.has(key)) return runtime.ohlcvCache.get(key);
  const rows = await fetchOHLCV(pair, timeframe, limit, opts);
  runtime.ohlcvCache.set(key, rows);
  return rows;
}

async function getBalanceCached(runtime, { apiKey, secret, userId, futures }) {
  if (!runtime?.balanceCache) return getBalance(apiKey, secret, { futures });
  const key = `${userId}:${futures ? 1 : 0}`;
  if (runtime.balanceCache.has(key)) return runtime.balanceCache.get(key);
  const bal = await getBalance(apiKey, secret, { futures });
  runtime.balanceCache.set(key, bal);
  return bal;
}

function invalidateBalanceCached(runtime, userId) {
  if (!runtime?.balanceCache) return;
  for (const k of [...runtime.balanceCache.keys()]) {
    if (k.startsWith(`${String(userId)}:`)) runtime.balanceCache.delete(k);
  }
}

/**
 * Guard anti-intrări târzii (ex. după vârf + scădere bruscă):
 * - intrare doar dacă pe 15m urcarea e încă în derulare (change > prag)
 * - și dacă nu e "încetare în viteza urcării" (acceleration nu e prea negativă)
 * - și dacă prețul nu e prea departe de vârful recent (limităm efectul "re-entry la vârf")
 *
 * Fail-open: dacă nu avem destule lumânări/valori valide, returnează ok=true.
 * @param {{ closes: number[] }} series15m
 * @param {"permissive" | "balanced" | "strict"} strictness
 */
function getMomentumGuardParams(strictness, customParams) {
  const level = String(strictness || "balanced");
  let defaults;
  if (level === "permissive") {
    defaults = {
      minLastChange: 0.00025, // ~+0.025%
      minAcceleration: -0.001, // decelerare tolerată până la -0.1%
      maxDrawdownFromHigh: 0.04, // max ~-4% sub vârful recent
    };
  } else if (level === "strict") {
    defaults = {
      minLastChange: 0.001, // ~+0.1%
      minAcceleration: -0.00025, // decelerare tolerată până la -0.025%
      maxDrawdownFromHigh: 0.015, // max ~-1.5% sub vârful recent
    };
  } else {
    // balanced (implicit)
    defaults = {
      minLastChange: 0.0005, // +0.05% / ~fără urcare clară
      minAcceleration: -0.0005, // decelerare tolerată până la -0.05%
      maxDrawdownFromHigh: 0.025, // -2.5% sub vârful recent blocăm re-entry
    };
  }

  const useCustom = Boolean(customParams?.enabled);
  if (!useCustom) return defaults;

  const minLastChangePct = Number(customParams?.minLastChangePct);
  const minAccelerationPct = Number(customParams?.minAccelerationPct);
  const maxDrawdownFromHighPct = Number(customParams?.maxDrawdownFromHighPct);

  return {
    minLastChange: Number.isFinite(minLastChangePct) ? minLastChangePct / 100 : defaults.minLastChange,
    minAcceleration: Number.isFinite(minAccelerationPct)
      ? minAccelerationPct / 100
      : defaults.minAcceleration,
    maxDrawdownFromHigh: Number.isFinite(maxDrawdownFromHighPct)
      ? maxDrawdownFromHighPct / 100
      : defaults.maxDrawdownFromHigh,
  };
}

function momentumContinuationGuardOn15m(series15m, strictness, customParams) {
  const closes = Array.isArray(series15m?.closes) ? series15m.closes : [];
  const n = closes.length;
  // Avem nevoie de ~2 segmente + recent high
  const lenFast = 4; // ~1h pe 15m (4 lumânări)
  const lenHigh = 12; // ~3h fereastră pentru vârf recent
  const minBars = 2 * lenFast + 1;
  if (n < Math.max(minBars, lenHigh)) return { ok: true };

  const last = closes[n - 1];
  const startNow = n - 1 - lenFast; // capătul segmentului anterior (prima lumânare din segmentul "now")
  const prevStart = n - 1 - 2 * lenFast;

  const prevStartPx = closes[prevStart];
  const segmentStartPx = closes[startNow];
  if (!(last > 0 && prevStartPx > 0 && segmentStartPx > 0)) return { ok: true };

  const changePrev = pctChange(segmentStartPx, prevStartPx); // (segStart - prevStart) / prevStart
  const changeNow = pctChange(last, segmentStartPx); // (last - segStart) / segStart
  if (changePrev == null || changeNow == null) return { ok: true };

  const acceleration = changeNow - changePrev;

  const recentHigh = Math.max(...closes.slice(n - lenHigh, n));
  if (!(Number.isFinite(recentHigh) && recentHigh > 0)) return { ok: true };
  const drawdownFromHigh = (recentHigh - last) / recentHigh;

  const { minLastChange, minAcceleration, maxDrawdownFromHigh } = getMomentumGuardParams(strictness, customParams);

  const ok = changeNow > minLastChange && acceleration > minAcceleration && drawdownFromHigh < maxDrawdownFromHigh;
  return { ok };
}

function parsePair(pair) {
  const [base, quote] = pair.split("/");
  return { base, quote: quote || DEFAULT_QUOTE_ASSET };
}

function quoteFreeBalance(freeObj, quote) {
  const o = freeObj || {};
  return Number(o[quote] ?? o.USDC ?? 0) || 0;
}

/** Plafon USDC per ordin când AI Pilot e activ și botul e în lista pilotului. */
function pilotMaxSpendQuote(user, botId) {
  const p = user?.aiPilot;
  if (!p?.enabled || !Array.isArray(p.botIds)) return null;
  if (!p.botIds.some((id) => String(id) === String(botId))) return null;
  const cap = Number(p.maxUsdcPerTrade);
  if (!Number.isFinite(cap) || cap <= 0) return null;
  return cap;
}

async function safePrice(pair) {
  let p = await getCachedPrice(pair);
  if (p == null || p <= 0) {
    p = await getPrice(pair);
    await setCachedPrice(pair, p);
  }
  return p;
}

/**
 * Run one bot tick: signals, risk, execution (real or paper).
 * @param {string|mongoose.Types.ObjectId} botId
 * @param {ReturnType<typeof createBotRuntime>} [runtime] optional per-batch cache
 */
export async function runSingleBot(botId, runtime = null) {
  await connectDB();
  const bot = await Bot.findById(botId).populate("strategyId");
  if (!bot || bot.status !== "active") {
    return { skipped: true, reason: "inactive" };
  }
  const strategy = bot.strategyId;
  if (!strategy?.definition) {
    return { skipped: true, reason: "no_strategy" };
  }

  const user = await getUserCached(runtime, bot.userId);
  if (!user) return { skipped: true, reason: "no_user" };

  const momentumGuardEnabled =
    user.aiPilot && typeof user.aiPilot === "object" ? user.aiPilot.momentumGuardEnabled !== false : true;
  const momentumGuardStrictnessRaw =
    user.aiPilot && typeof user.aiPilot === "object" ? user.aiPilot.momentumGuardStrictness : null;
  const momentumGuardStrictness = ["permissive", "balanced", "strict"].includes(String(momentumGuardStrictnessRaw))
    ? String(momentumGuardStrictnessRaw)
    : "balanced";
  const momentumGuardCustomEnabled =
    user.aiPilot && typeof user.aiPilot === "object" ? Boolean(user.aiPilot.momentumGuardCustomEnabled) : false;
  const momentumGuardCustomMinLastChangePct = user.aiPilot?.momentumGuardMinLastChangePct;
  const momentumGuardCustomMinAccelerationPct = user.aiPilot?.momentumGuardMinAccelerationPct;
  const momentumGuardCustomMaxDrawdownFromHighPct = user.aiPilot?.momentumGuardMaxDrawdownFromHighPct;

  const risk = bot.risk || {};
  const slPct = risk.stopLossPct ?? 2;
  const tpPct = risk.takeProfitPct ?? 3;
  const maxDailyLossPct = risk.maxDailyLossPct ?? 5;
  const posPct = (risk.positionSizePct ?? 10) / 100;

  // Multi-timeframe pentru AI Pilot:
  // - entry: după indicatorii din 15m
  // - analiză tehnică/trend: și din 1d (filtru opțional, dacă există lumânări suficiente)
  // Cache per batch: boții pe aceeași pereche partajează datele OHLCV.
  const [res15m, res1d] = await Promise.allSettled([
    getOHLCVCached(runtime, bot.pair, "15m", 200, { futures: bot.futuresEnabled }),
    getOHLCVCached(runtime, bot.pair, "1d", 220, { futures: bot.futuresEnabled }),
  ]);

  const ohlcv15m = res15m.status === "fulfilled" && Array.isArray(res15m.value) ? res15m.value : [];
  const ohlcv1d = res1d.status === "fulfilled" && Array.isArray(res1d.value) ? res1d.value : [];

  const series15m = ohlcvToSeries(ohlcv15m);
  const series1d = ohlcvToSeries(ohlcv1d);
  if (!series15m.closes.length) {
    return { skipped: true, reason: "no_candles_15m" };
  }

  const r15m = evaluateStrategy(strategy.definition, series15m);
  let entryOk = r15m.entryOk;
  let exitOk = r15m.exitOk;

  // Dacă avem suficiente lumânări daily, folosim 1d ca filtru suplimentar la intrare.
  if (series1d.closes.length) {
    const r1d = evaluateStrategy(strategy.definition, series1d);
    entryOk = entryOk && r1d.entryOk;
    // Confirmare și la ieșire: exit trebuie să fie valid și pe 1d.
    exitOk = exitOk && r1d.exitOk;
  }

  // Guard anti-intrări târzii: dacă AI/strategia cere buy, dar momentum-ul pe 15m
  // arată decelerare / lipsă de urcare clară (sau re-entry după cădere),
  // anulăm entryOk.
  if (entryOk && momentumGuardEnabled) {
    const guard = momentumContinuationGuardOn15m(series15m, momentumGuardStrictness, {
      enabled: momentumGuardCustomEnabled,
      minLastChangePct: momentumGuardCustomMinLastChangePct,
      minAccelerationPct: momentumGuardCustomMinAccelerationPct,
      maxDrawdownFromHighPct: momentumGuardCustomMaxDrawdownFromHighPct,
    });
    entryOk = Boolean(guard.ok);
  }
  const price = await safePrice(bot.pair);
  if (price <= 0) return { skipped: true, reason: "no_price" };

  const dateKey = utcDateKey();
  let dailyLossPct = await getDailyLoss(String(bot._id), dateKey);

  const modePaper = bot.mode === "paper";

  async function approximateRealEquity() {
    try {
      const ukey = decryptSecret(user.apiKeyEncrypted || "");
      const usec = decryptSecret(user.apiSecretEncrypted || "");
      if (!ukey || !usec) return 0;
      const bal = await getBalanceCached(runtime, {
        apiKey: ukey,
        secret: usec,
        userId: String(user._id),
        futures: bot.futuresEnabled,
      });
      const { quote } = parsePair(bot.pair);
      const freeObj = bal.free || bal;
      const qf = quoteFreeBalance(freeObj, quote);
      const ps = bot.positionState?.open ? Number(bot.positionState.quantity || 0) * price : 0;
      return qf + ps;
    } catch {
      return 0;
    }
  }
  let paper = bot.paperState || {
    quoteBalance: 10000,
    baseBalance: 0,
    avgEntry: 0,
    open: false,
  };
  let pos = bot.positionState || { open: false, side: "buy", entryPrice: 0, quantity: 0 };

  function equity() {
    if (modePaper) {
      return paper.quoteBalance + paper.baseBalance * price;
    }
    return 0;
  }

  async function markDailyLossFromPnl(pnlQuote, equityBase) {
    const base = equityBase || (modePaper ? equity() : eqForRisk);
    if (pnlQuote < 0 && base > 0) {
      const inc = (-pnlQuote / base) * 100;
      dailyLossPct = await incrDailyLoss(String(bot._id), dateKey, inc);
    }
  }

  // Risk: max daily loss vs virtual (paper) or approx spot equity (real)
  const eqForRisk = modePaper ? equity() : await approximateRealEquity();
  if (eqForRisk > 0 && dailyLossPct >= maxDailyLossPct) {
    bot.lastRun = new Date();
    await bot.save();
    return { skipped: true, reason: "max_daily_loss", dailyLossPct };
  }

  /** Stop-loss / take-profit for open positions */
  async function checkSlTp() {
    if (modePaper && paper.open && paper.avgEntry > 0) {
      const low = ((price - paper.avgEntry) / paper.avgEntry) * 100;
      if (low <= -slPct || low >= tpPct || exitOk) {
        const eqBefore = paper.quoteBalance + paper.baseBalance * price;
        const qty = paper.baseBalance;
        const gross = qty * price * 0.999;
        const pnl = gross - qty * paper.avgEntry;
        await markDailyLossFromPnl(pnl, eqBefore);
        paper.quoteBalance += gross;
        paper.baseBalance = 0;
        paper.avgEntry = 0;
        paper.open = false;
        await Trade.create({
          userId: bot.userId,
          botId: bot._id,
          pair: bot.pair,
          side: "sell",
          quantity: qty,
          price,
          quoteQty: gross,
          pnl,
          status: "simulated",
          isPaper: true,
        });
        await updateUserStats(user._id, pnl, pnl > 0);
        bot.paperState = paper;
        await bot.save();
        return true;
      }
    }
    if (!modePaper && pos.open && pos.entryPrice > 0) {
      const change = ((price - pos.entryPrice) / pos.entryPrice) * 100;
      if (change <= -slPct || change >= tpPct || exitOk) {
        const ukey = decryptSecret(user.apiKeyEncrypted || "");
        const usec = decryptSecret(user.apiSecretEncrypted || "");
        if (!ukey || !usec) return true;
        const digest = `close:${bot._id}:${Math.round(price * 100)}`;
        const ok = await acquireOrderLock(String(bot._id), digest);
        if (!ok) return true;

        const logFailedClose = async (errLike) => {
          if (isBinanceMarketClosedError(errLike)) return;
          const msg =
            errLike instanceof Error ? errLike.message : String(errLike ?? "close failed");
          try {
            await Trade.create({
              userId: bot.userId,
              botId: bot._id,
              pair: bot.pair,
              side: "sell",
              quantity: pos.quantity,
              price,
              status: "failed",
              isPaper: false,
              errorMessage: msg,
            });
          } catch {
            /* nu blocăm revenirea la flat */
          }
        };

        if (bot.futuresEnabled) {
          try {
            const order = await placeOrder({
              apiKey: ukey,
              secret: usec,
              symbol: bot.pair,
              side: "sell",
              amount: pos.quantity,
              futures: true,
            });
            const soldQty = Number(order.filled ?? pos.quantity);
            const gross = soldQty * price;
            const feeEst = gross * 0.001;
            const pnl = gross - feeEst - soldQty * pos.entryPrice;
            await markDailyLossFromPnl(pnl, eqForRisk);
            try {
              const tr = await Trade.create({
                userId: bot.userId,
                botId: bot._id,
                pair: bot.pair,
                side: "sell",
                quantity: soldQty,
                price,
                quoteQty: gross,
                pnl,
                status: "filled",
                isPaper: false,
                meta: { orderId: order.id },
              });
              await updateUserStats(user._id, pnl, pnl > 0);
              await replicateTradeForFollowers({
                traderId: user._id,
                traderUser: user,
                sourceTradeDoc: tr,
                pair: bot.pair,
                side: "sell",
                quantity: soldQty,
                price,
                quoteQty: gross,
              });
            } catch (e) {
              console.error("[bot-runner] futures close log", e);
            }
          } catch (e) {
            await logFailedClose(e);
          }
          pos = { open: false, side: "buy", entryPrice: 0, quantity: 0 };
          bot.positionState = pos;
          await bot.save();
          invalidateBalanceCached(runtime, user._id);
          return true;
        }

        /* Spot: mai multe picioare + praf LOT_SIZE → închidem poziția în app ca să poată urma buy */
        try {
          const meta = await fetchBinanceSpotMarket(ukey, usec, bot.pair);
          if (!meta) {
            await logFailedClose("Pereche spot indisponibilă.");
            pos = { open: false, side: "buy", entryPrice: 0, quantity: 0 };
            bot.positionState = pos;
            await bot.save();
            return true;
          }
          const baseSym = meta.market.base;
          const legs = [];
          let soldSum = 0;
          let weightedCost = 0;
          let remainingWant = pos.quantity;
          const maxLegs = 6;

          while (remainingWant > 1e-14 && legs.length < maxLegs) {
            let orderLeg;
            try {
              orderLeg = await placeMarketSellSpotClamped({
                apiKey: ukey,
                secret: usec,
                symbol: bot.pair,
                amountBase: remainingWant,
              });
            } catch (e) {
              if (isDustOrMinNotionalError(e)) break;
              throw e;
            }
            const f = Number(orderLeg.filled ?? 0);
            if (!Number.isFinite(f) || f <= 0) break;
            const pxLeg = Number(orderLeg.average || orderLeg.price || price);
            legs.push({ orderId: orderLeg.id, filled: f, price: pxLeg });
            soldSum += f;
            weightedCost += f * pxLeg;
            remainingWant = Math.max(0, pos.quantity - soldSum);
            if (remainingWant <= 1e-12) break;
          }

          const bal = await withRetries(() => meta.exchange.fetchBalance(), { exchange: meta.exchange });
          const freeNow = Number(bal.free?.[baseSym] ?? 0) || 0;
          const sellableLeft = spotMaxSellableBaseFromFree(freeNow, meta.market, price);

          if (soldSum > 0) {
            const avgSell = weightedCost / soldSum;
            const gross = weightedCost;
            const feeEst = gross * 0.001;
            const pnl = gross - feeEst - soldSum * pos.entryPrice;
            await markDailyLossFromPnl(pnl, eqForRisk);
            try {
              const tr = await Trade.create({
                userId: bot.userId,
                botId: bot._id,
                pair: bot.pair,
                side: "sell",
                quantity: soldSum,
                price: avgSell,
                quoteQty: gross,
                pnl,
                status: "filled",
                isPaper: false,
                meta: {
                  orderId: legs[0]?.orderId,
                  sellLegs: legs.length > 1 ? legs : undefined,
                },
              });
              await updateUserStats(user._id, pnl, pnl > 0);
              await replicateTradeForFollowers({
                traderId: user._id,
                traderUser: user,
                sourceTradeDoc: tr,
                pair: bot.pair,
                side: "sell",
                quantity: soldSum,
                price: avgSell,
                quoteQty: gross,
              });
            } catch (e) {
              console.error("[bot-runner] spot close log", e);
            }
          } else {
            await logFailedClose(
              "Vânzare spot eșuată sau cantitatea e praf sub LOT_SIZE/min notional — poziție închisă în app; verifică restul pe Binance."
            );
          }

          if (sellableLeft > 1e-12) {
            pos = {
              open: true,
              side: "buy",
              entryPrice: pos.entryPrice,
              quantity: freeNow,
              openedAt: pos.openedAt,
            };
          } else {
            pos = { open: false, side: "buy", entryPrice: 0, quantity: 0 };
          }
          bot.positionState = pos;
          await bot.save();
          invalidateBalanceCached(runtime, user._id);
          return true;
        } catch (e) {
          await logFailedClose(e);
          pos = { open: false, side: "buy", entryPrice: 0, quantity: 0 };
          bot.positionState = pos;
          await bot.save();
          invalidateBalanceCached(runtime, user._id);
          return true;
        }
      }
    }
    return false;
  }

  await checkSlTp();
  // După vânzare (SL/TP sau semnal ieșire) nu ieșim din ciclu: dacă poziția e închisă și
  // strategia încă cere intrare, putem cumpăra în același tick (evită „gol” până la următorul cron).

  // Flat fără semnal de intrare: cron rulează, dar strategia nu validează entry acum.
  if (modePaper && !paper.open && !entryOk) {
    bot.lastRun = new Date();
    await bot.save();
    return { skipped: true, reason: "no_entry_signal", entryOk, exitOk };
  }
  if (!modePaper && !pos.open && !entryOk) {
    bot.lastRun = new Date();
    await bot.save();
    return { skipped: true, reason: "no_entry_signal", entryOk, exitOk };
  }

  // Entry when flat
  if (modePaper && !paper.open && entryOk) {
    let alloc = paper.quoteBalance * posPct;
    const capQ = pilotMaxSpendQuote(user, bot._id);
    if (capQ != null) alloc = Math.min(alloc, capQ);
    if (alloc <= 0) {
      bot.lastRun = new Date();
      await bot.save();
      return { skipped: true, reason: "no_alloc" };
    }
    const qty = (alloc / price) * 0.999;
    paper.quoteBalance -= alloc;
    paper.baseBalance += qty;
    paper.avgEntry = price;
    paper.open = true;
    bot.paperState = paper;
    bot.lastRun = new Date();
    await bot.save();
    await Trade.create({
      userId: bot.userId,
      botId: bot._id,
      pair: bot.pair,
      side: "buy",
      quantity: qty,
      price,
      quoteQty: alloc,
      status: "simulated",
      isPaper: true,
    });
    return { ok: true, action: "paper_buy", entryOk, exitOk };
  }

  if (!modePaper && !pos.open && entryOk) {
    const ukey = decryptSecret(user.apiKeyEncrypted || "");
    const usec = decryptSecret(user.apiSecretEncrypted || "");
    if (!ukey || !usec) {
      bot.lastRun = new Date();
      await bot.save();
      return { skipped: true, reason: "no_api_keys" };
    }
    const digest = crypto.createHash("sha256").update(`buy:${bot._id}:${entryOk}:${price}`).digest("hex").slice(0, 32);
    const ok = await acquireOrderLock(String(bot._id), digest);
    if (!ok) {
      bot.lastRun = new Date();
      await bot.save();
      return { skipped: true, reason: "dedupe" };
    }
    const bal = await getBalanceCached(runtime, {
      apiKey: ukey,
      secret: usec,
      userId: String(user._id),
      futures: bot.futuresEnabled,
    });
    const { quote } = parsePair(bot.pair);
    const freeObj = bal.free || bal;
    const quoteFree = quoteFreeBalance(freeObj, quote);
    let spend = quoteFree * posPct;
    const capQ = pilotMaxSpendQuote(user, bot._id);
    if (capQ != null) spend = Math.min(spend, capQ);
    const qty = spend / price;
    if (spend < 10) {
      bot.lastRun = new Date();
      await bot.save();
      return { skipped: true, reason: "insufficient_quote", freeQuote: quoteFree };
    }
    try {
      const order = await placeOrder({
        apiKey: ukey,
        secret: usec,
        symbol: bot.pair,
        side: "buy",
        amount: qty,
        futures: bot.futuresEnabled,
      });
      const filledPrice = Number(order.average || price);
      const filledQty = Number(order.filled ?? qty);
      const tr = await Trade.create({
        userId: bot.userId,
        botId: bot._id,
        pair: bot.pair,
        side: "buy",
        quantity: filledQty,
        price: filledPrice,
        quoteQty: spend,
        status: "filled",
        isPaper: false,
        meta: { orderId: order.id },
      });
      pos = {
        open: true,
        side: "buy",
        entryPrice: filledPrice,
        quantity: filledQty,
        openedAt: new Date(),
      };
      bot.positionState = pos;
      bot.lastRun = new Date();
      await bot.save();
      invalidateBalanceCached(runtime, user._id);
      await replicateTradeForFollowers({
        traderId: user._id,
        traderUser: user,
        sourceTradeDoc: tr,
        pair: bot.pair,
        side: "buy",
        quantity: filledQty,
        price: filledPrice,
        quoteQty: spend,
      });
      return { ok: true, action: "live_buy", entryOk, exitOk };
    } catch (e) {
      if (!isBinanceMarketClosedError(e)) {
        await Trade.create({
          userId: bot.userId,
          botId: bot._id,
          pair: bot.pair,
          side: "buy",
          quantity: qty,
          price,
          status: "failed",
          isPaper: false,
          errorMessage: String(e?.message || e),
        });
      }
      bot.lastRun = new Date();
      await bot.save();
      return { ok: false, error: String(e?.message || e), entryOk, exitOk };
    }
  }

  bot.lastRun = new Date();
  await bot.save();
  return { ok: true, action: "hold", entryOk, exitOk };
}

async function updateUserStats(userId, pnl, win) {
  await User.findByIdAndUpdate(userId, {
    $inc: {
      "stats.totalProfit": pnl,
      "stats.totalTrades": 1,
      ...(win ? { "stats.winTrades": 1 } : {}),
    },
  });
}

/**
 * Batch entry for cron: capped per invocation for serverless timeouts.
 *
 * Performanță:
 * - Un `BotRuntime` unic per batch cachează: user doc, OHLCV pe (pair,tf,limit),
 *   balanță Binance pe (userId, futures). Boții pe aceeași pereche / același
 *   user nu mai dublează call-urile.
 * - Boții aceluiași user se execută SECVENȚIAL (cheia API Binance are rate limit
 *   per account), dar useri diferiți rulează în PARALEL cu o limită de
 *   concurență — fiecare user are o cronologie independentă.
 */
export async function runActiveBotsBatch(limit = 15, opts = {}) {
  await connectDB();
  // Fair rotation: prioritize bots that haven't run recently.
  const bots = await Bot.find({ status: "active" })
    .sort({ lastRun: 1, _id: 1 })
    .limit(limit)
    .lean();
  if (!bots.length) return [];

  const runtime = createBotRuntime();

  // Grupare pe userId
  const byUser = new Map();
  for (const b of bots) {
    const k = String(b.userId);
    if (!byUser.has(k)) byUser.set(k, []);
    byUser.get(k).push(b);
  }

  const MAX_USER_CONCURRENCY = Math.min(
    Math.max(Number(opts?.userConcurrency) || Number(process.env.RUN_BOTS_USER_CONCURRENCY) || 4, 1),
    10
  );
  const results = [];
  const userIds = [...byUser.keys()];
  let idx = 0;

  async function worker() {
    while (idx < userIds.length) {
      const myIdx = idx++;
      const userBots = byUser.get(userIds[myIdx]) || [];
      for (const b of userBots) {
        try {
          const r = await runSingleBot(b._id, runtime);
          results.push({ botId: String(b._id), ...r });
        } catch (e) {
          results.push({ botId: String(b._id), ok: false, error: String(e?.message || e) });
        }
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(MAX_USER_CONCURRENCY, userIds.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

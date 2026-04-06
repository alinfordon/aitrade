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

/** Run one bot tick: signals, risk, execution (real or paper). */
export async function runSingleBot(botId) {
  await connectDB();
  const bot = await Bot.findById(botId).populate("strategyId");
  if (!bot || bot.status !== "active") {
    return { skipped: true, reason: "inactive" };
  }
  const strategy = bot.strategyId;
  if (!strategy?.definition) {
    return { skipped: true, reason: "no_strategy" };
  }

  const user = await User.findById(bot.userId);
  if (!user) return { skipped: true, reason: "no_user" };

  const risk = bot.risk || {};
  const slPct = risk.stopLossPct ?? 2;
  const tpPct = risk.takeProfitPct ?? 3;
  const maxDailyLossPct = risk.maxDailyLossPct ?? 5;
  const posPct = (risk.positionSizePct ?? 10) / 100;

  const ohlcv = await fetchOHLCV(bot.pair, "1h", 200, { futures: bot.futuresEnabled });
  const series = ohlcvToSeries(ohlcv);
  if (!series.closes.length) {
    return { skipped: true, reason: "no_candles" };
  }

  const { entryOk, exitOk } = evaluateStrategy(strategy.definition, series);
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
      const bal = await getBalance(ukey, usec, { futures: bot.futuresEnabled });
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

        const logFailedClose = async (msg) => {
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
              errorMessage: String(msg || "close failed"),
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
            await logFailedClose(e?.message || e);
          }
          pos = { open: false, side: "buy", entryPrice: 0, quantity: 0 };
          bot.positionState = pos;
          await bot.save();
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
          return true;
        } catch (e) {
          await logFailedClose(e?.message || e);
          pos = { open: false, side: "buy", entryPrice: 0, quantity: 0 };
          bot.positionState = pos;
          await bot.save();
          return true;
        }
      }
    }
    return false;
  }

  await checkSlTp();
  // După vânzare (SL/TP sau semnal ieșire) nu ieșim din ciclu: dacă poziția e închisă și
  // strategia încă cere intrare, putem cumpăra în același tick (evită „gol” până la următorul cron).

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
    return { ok: true, action: "paper_buy" };
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
    const bal = await getBalance(ukey, usec, { futures: bot.futuresEnabled });
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
      return { skipped: true, reason: "insufficient_quote" };
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
      return { ok: true, action: "live_buy" };
    } catch (e) {
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
      bot.lastRun = new Date();
      await bot.save();
      return { ok: false, error: String(e?.message || e) };
    }
  }

  bot.lastRun = new Date();
  await bot.save();
  return { ok: true, action: "hold" };
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

/** Batch entry for cron: capped per invocation for serverless timeouts. */
export async function runActiveBotsBatch(limit = 15) {
  await connectDB();
  const bots = await Bot.find({ status: "active" }).limit(limit).lean();
  const results = [];
  for (const b of bots) {
    try {
      const r = await runSingleBot(b._id);
      results.push({ botId: String(b._id), ...r });
    } catch (e) {
      results.push({ botId: String(b._id), ok: false, error: String(e?.message || e) });
    }
  }
  return results;
}

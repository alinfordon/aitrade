import { connectDB } from "@/models/db";
import { Bot, User, Trade } from "@/models";
import {
  getPrice,
  placeMarketSellSpotClamped,
  placeOrder,
  fetchBinanceSpotMarket,
} from "@/lib/binance/service";
import { decryptSecret } from "@/lib/security/crypto";
import { isDustOrMinNotionalError } from "@/server/trading/execute-manual";
import { acquireOrderLock } from "@/lib/redis/cache";
import { replicateTradeForFollowers } from "@/server/copy-trading";

async function bumpUserStats(userId, pnl, win) {
  await User.findByIdAndUpdate(userId, {
    $inc: {
      "stats.totalProfit": pnl,
      "stats.totalTrades": 1,
      ...(win ? { "stats.winTrades": 1 } : {}),
    },
  });
}

function readOpenPosition(bot) {
  const modePaper = bot.mode === "paper";
  if (modePaper) {
    const p = bot.paperState || {};
    const qty = Number(p.baseBalance ?? 0);
    const avg = Number(p.avgEntry ?? 0);
    if (p.open && Number.isFinite(qty) && qty > 1e-12 && Number.isFinite(avg) && avg > 0) {
      return { modePaper: true, qty, avgEntry: avg, paper: p };
    }
  } else {
    const pos = bot.positionState || {};
    const qty = Number(pos.quantity ?? 0);
    const avg = Number(pos.entryPrice ?? 0);
    if (pos.open && Number.isFinite(qty) && qty > 1e-12 && Number.isFinite(avg) && avg > 0) {
      return { modePaper: false, qty, avgEntry: avg, pos };
    }
  }
  return null;
}

function emptyPaperState(from) {
  const p = from && typeof from === "object" ? from : {};
  return {
    quoteBalance: Number(p.quoteBalance ?? 10000),
    baseBalance: 0,
    avgEntry: 0,
    open: false,
  };
}

function emptyPositionState() {
  return { open: false, side: "buy", entryPrice: 0, quantity: 0, openedAt: null };
}

function serializeBot(bot) {
  if (bot && typeof bot.toObject === "function") return bot.toObject({ flattenMaps: true });
  return bot;
}

/**
 * @param {{
 *   userId: string,
 *   botId: string,
 *   disposition?: "close_market" | "manual",
 *   preserveStatusAfterClose?: boolean,
 *   closeTradeMetaReason?: string,
 * }} args
 * @returns {Promise<{ ok: boolean, error?: string, status?: number, needsDisposition?: boolean, bot?: unknown, action?: string }>}
 */
export async function stopBotWithDisposition(args) {
  const {
    userId,
    botId,
    disposition,
    preserveStatusAfterClose = false,
    closeTradeMetaReason = "bot_stop",
  } = args;

  await connectDB();
  const bot = await Bot.findOne({ _id: botId, userId });
  if (!bot) {
    return { ok: false, error: "Bot inexistent.", status: 404 };
  }

  if (bot.status !== "active" && bot.status !== "paused") {
    return { ok: false, error: "Botul nu e pornit.", status: 400 };
  }

  const open = readOpenPosition(bot);

  if (disposition === "close_market" && !open) {
    return { ok: true, bot: serializeBot(bot), action: "noop_no_position" };
  }

  if (!open) {
    bot.status = "stopped";
    await bot.save();
    return { ok: true, bot: serializeBot(bot) };
  }

  if (!disposition) {
    return { ok: false, needsDisposition: true, error: "Alege ce faci cu poziția deschisă.", status: 400 };
  }

  const user = await User.findById(userId);
  if (!user) {
    return { ok: false, error: "User not found", status: 404 };
  }

  const pair = bot.pair;

  if (disposition === "manual") {
    if (bot.futuresEnabled) {
      return {
        ok: false,
        error: "Eliberarea la manual e doar pentru boturi spot. Închide poziția (sell) sau gestionează din exchange.",
        status: 400,
      };
    }
    const book =
      user.manualSpotBook && typeof user.manualSpotBook === "object" && !Array.isArray(user.manualSpotBook)
        ? { ...user.manualSpotBook }
        : {};
    const existing = book[pair];
    const exQty = Number(existing?.qty ?? 0);
    if (Number.isFinite(exQty) && exQty > 1e-12) {
      return {
        ok: false,
        error: `Ai deja o poziție manuală pe ${pair}. Încheie-o sau fuzionează înainte.`,
        status: 409,
      };
    }

    book[pair] = {
      qty: open.qty,
      avg: open.avgEntry,
      paper: open.modePaper,
    };
    user.manualSpotBook = book;
    await user.save();

    if (open.modePaper) {
      bot.paperState = emptyPaperState(bot.paperState);
    } else {
      bot.positionState = emptyPositionState();
    }
    bot.status = "stopped";
    await bot.save();
    return { ok: true, bot: serializeBot(bot), action: "released_to_manual" };
  }

  if (disposition === "close_market") {
    let price;
    try {
      price = await getPrice(pair);
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Preț indisponibil pentru închidere.",
        status: 502,
      };
    }
    if (!Number.isFinite(price) || price <= 0) {
      return { ok: false, error: "Preț invalid.", status: 502 };
    }

    if (open.modePaper) {
      const paper = bot.paperState || {};
      const qty = open.qty;
      const gross = qty * price * 0.999;
      const pnl = gross - qty * open.avgEntry;
      paper.quoteBalance = Number(paper.quoteBalance ?? 10000) + gross;
      paper.baseBalance = 0;
      paper.avgEntry = 0;
      paper.open = false;
      bot.paperState = paper;

      await Trade.create({
        userId: bot.userId,
        botId: bot._id,
        pair,
        side: "sell",
        quantity: qty,
        price,
        quoteQty: gross,
        pnl,
        status: "simulated",
        isPaper: true,
      });
      await bumpUserStats(user._id, pnl, pnl > 0);
    } else {
      const ukey = decryptSecret(user.apiKeyEncrypted || "");
      const usec = decryptSecret(user.apiSecretEncrypted || "");
      if (!ukey || !usec) {
        return { ok: false, error: "Chei API lipsă pentru vânzare reală.", status: 400 };
      }
      const digest = `stop-close:${bot._id}:${Math.round(price * 100)}`;
      const lockOk = await acquireOrderLock(String(bot._id), digest);
      if (!lockOk) {
        return { ok: false, error: "Altă operațiune e în curs pentru acest bot. Încearcă din nou.", status: 429 };
      }
      try {
        if (bot.futuresEnabled) {
          const order = await placeOrder({
            apiKey: ukey,
            secret: usec,
            symbol: pair,
            side: "sell",
            amount: open.qty,
            futures: true,
          });
          const soldQty = Number(order.filled ?? open.qty);
          const gross = soldQty * price;
          const feeEst = gross * 0.001;
          const pnl = gross - feeEst - soldQty * open.avgEntry;
          const tr = await Trade.create({
            userId: bot.userId,
            botId: bot._id,
            pair,
            side: "sell",
            quantity: soldQty,
            price,
            quoteQty: gross,
            pnl,
            status: "filled",
            isPaper: false,
            meta: { orderId: order.id, reason: closeTradeMetaReason },
          });
          await bumpUserStats(user._id, pnl, pnl > 0);
          await replicateTradeForFollowers({
            traderId: user._id,
            traderUser: user,
            sourceTradeDoc: tr,
            pair,
            side: "sell",
            quantity: soldQty,
            price,
            quoteQty: gross,
          });
        } else {
          const meta = await fetchBinanceSpotMarket(ukey, usec, pair);
          if (!meta) {
            throw new Error("Pereche spot indisponibilă.");
          }
          {
            const legs = [];
            let soldSum = 0;
            let weightedCost = 0;
            let remainingWant = open.qty;
            const maxLegs = 6;

            while (remainingWant > 1e-14 && legs.length < maxLegs) {
              let orderLeg;
              try {
                orderLeg = await placeMarketSellSpotClamped({
                  apiKey: ukey,
                  secret: usec,
                  symbol: pair,
                  amountBase: remainingWant,
                });
              } catch (err) {
                if (isDustOrMinNotionalError(err)) break;
                throw err;
              }
              const f = Number(orderLeg.filled ?? 0);
              if (!Number.isFinite(f) || f <= 0) break;
              const pxLeg = Number(orderLeg.average || orderLeg.price || price);
              legs.push({ orderId: orderLeg.id, filled: f, price: pxLeg });
              soldSum += f;
              weightedCost += f * pxLeg;
              remainingWant = Math.max(0, open.qty - soldSum);
              if (remainingWant <= 1e-12) break;
            }

            if (soldSum > 0) {
              const avgSell = weightedCost / soldSum;
              const gross = weightedCost;
              const feeEst = gross * 0.001;
              const pnl = gross - feeEst - soldSum * open.avgEntry;
              const tr = await Trade.create({
                userId: bot.userId,
                botId: bot._id,
                pair,
                side: "sell",
                quantity: soldSum,
                price: avgSell,
                quoteQty: gross,
                pnl,
                status: "filled",
                isPaper: false,
                meta: {
                  reason: closeTradeMetaReason,
                  orderId: legs[0]?.orderId,
                  sellLegs: legs.length > 1 ? legs : undefined,
                },
              });
              await bumpUserStats(user._id, pnl, pnl > 0);
              await replicateTradeForFollowers({
                traderId: user._id,
                traderUser: user,
                sourceTradeDoc: tr,
                pair,
                side: "sell",
                quantity: soldSum,
                price: avgSell,
                quoteQty: gross,
              });
            } else {
              await Trade.create({
                userId: bot.userId,
                botId: bot._id,
                pair,
                side: "sell",
                quantity: open.qty,
                price,
                status: "failed",
                isPaper: false,
                errorMessage:
                  "Închidere la stop: cantitate sub LOT_SIZE min notional (praf) — eliberează restul din Binance.",
                meta: { reason: closeTradeMetaReason },
              });
            }
          }
        }
        bot.positionState = emptyPositionState();
      } catch (e) {
        await Trade.create({
          userId: bot.userId,
          botId: bot._id,
          pair,
          side: "sell",
          quantity: open.qty,
          price,
          status: "failed",
          isPaper: false,
          errorMessage: String(e?.message || e),
        });
        return {
          ok: false,
          error: `Ordin sell eșuat: ${e instanceof Error ? e.message : String(e)}`,
          status: 502,
        };
      }
    }

    if (!preserveStatusAfterClose) {
      bot.status = "stopped";
    }
    await bot.save();
    return {
      ok: true,
      bot: serializeBot(bot),
      action: preserveStatusAfterClose ? "closed_market_preserved" : "closed_market",
    };
  }

  return { ok: false, error: "Opțiune invalidă.", status: 400 };
}

/**
 * Închide poziția la piață fără a opri botul (status active/paused rămâne).
 * Folosit de modulul AI Pilot.
 */
export async function closeBotOpenPositionMarketOnly({ userId, botId }) {
  return stopBotWithDisposition({
    userId,
    botId,
    disposition: "close_market",
    preserveStatusAfterClose: true,
    closeTradeMetaReason: "ai_pilot",
  });
}

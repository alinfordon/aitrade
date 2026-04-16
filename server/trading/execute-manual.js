import mongoose from "mongoose";
import { connectDB } from "@/models/db";
import User from "@/models/User";
import Trade from "@/models/Trade";
import Bot from "@/models/Bot";
import { decryptSecret } from "@/lib/security/crypto";
import { getPrice, placeMarketSellSpotClamped, placeOrder } from "@/lib/binance/service";
import { createExchange, withRetries, syncServerTime } from "@/lib/binance/client";
import { DEFAULT_QUOTE_ASSET, getManualPaperQuoteBalance, normSpotPair } from "@/lib/market-defaults";
import { mapBinanceUserMessageAsync, isBinanceMarketClosedError } from "@/lib/binance/map-exchange-error";

function parsePair(pair) {
  const [base, quote] = String(pair).split("/");
  return { base, quote: quote || DEFAULT_QUOTE_ASSET };
}

function getBook(user) {
  const raw = user.manualSpotBook;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { ...raw };
  }
  return {};
}

async function updateUserBook(userId, book) {
  await User.findByIdAndUpdate(userId, { manualSpotBook: book });
}

async function bumpUserStats(userId, pnl, win) {
  await User.findByIdAndUpdate(userId, {
    $inc: {
      "stats.totalProfit": pnl,
      "stats.totalTrades": 1,
      ...(win ? { "stats.winTrades": 1 } : {}),
    },
  });
}

/** Pentru AI Pilot: leagă tranzacția manuală de botul de pe aceeași pereche (control în UI). */
async function resolvePilotLinkedBotId(userId, pair, preferredBotId) {
  const pNorm = normSpotPair(pair);
  if (preferredBotId && mongoose.isValidObjectId(String(preferredBotId))) {
    const bot = await Bot.findOne({ _id: preferredBotId, userId }).select("_id pair").lean();
    if (bot && normSpotPair(bot.pair) === pNorm) return bot._id;
  }
  const candidates = await Bot.find({ userId }).select("_id pair").lean();
  for (const b of candidates) {
    if (normSpotPair(b.pair) === pNorm) return b._id;
  }
  return null;
}

export function isDustOrMinNotionalError(e) {
  const code = e && typeof e === "object" && e.code;
  if (["BELOW_MIN_NOTIONAL", "BELOW_MIN_AMOUNT", "DUST_AMOUNT"].includes(String(code))) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return (
    /NOTIONAL|dust|prea mică|minimul Binance|După rotunjire|LOT_SIZE|minimum amount precision|amount precision|Filter failure/i.test(
      msg
    )
  );
}

/**
 * Spot manual (market). `spendQuote` în moneda cotei (implicit USDC); `amountBase` = mărime bază.
 * `fullExit`: pentru închidere live — repetă vânzări până se acoperă rotunjirile Binance; curăță praf rămas în carte.
 * `associateBotForControl`: doar AI Pilot — pune `botId` pe Trade (botul de pe pereche sau `pilotBotId`).
 */
export async function executeManualTrade({
  userId,
  pair,
  side,
  mode,
  amountBase,
  spendQuote,
  fullExit = false,
  associateBotForControl = false,
  pilotBotId = null,
}) {
  await connectDB();
  const user = await User.findById(userId);
  if (!user) {
    return { ok: false, error: "User not found" };
  }

  pair = normSpotPair(pair);

  let linkedBotId = null;
  if (associateBotForControl) {
    linkedBotId = await resolvePilotLinkedBotId(userId, pair, pilotBotId);
  }

  const s = String(side).toLowerCase() === "sell" ? "sell" : "buy";
  const paper = mode === "paper";
  let price;
  try {
    price = await getPrice(pair);
  } catch (e) {
    if (e && typeof e === "object" && e.code === "MARKET_NOT_FOUND") {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        error: `${msg} Folosește o pereche Spot USDC listată pe Binance.`,
      };
    }
    return { ok: false, error: await mapBinanceUserMessageAsync(e) };
  }
  if (!Number.isFinite(price) || price <= 0) {
    return {
      ok: false,
      error: `Preț indisponibil pentru ${pair}. Verifică perechea pe Binance Spot.`,
    };
  }

  let qty;
  let quoteQty;
  let avgPx = price;

  if (s === "buy") {
    if (spendQuote != null && spendQuote > 0) {
      quoteQty = spendQuote;
      qty = spendQuote / price;
    } else if (amountBase != null && amountBase > 0) {
      qty = amountBase;
      quoteQty = qty * price;
    } else {
      return { ok: false, error: `Provide spendQuote (${DEFAULT_QUOTE_ASSET}) or amountBase for buy` };
    }
  } else {
    if (amountBase == null || amountBase <= 0) {
      return { ok: false, error: "Provide amountBase for sell" };
    }
    qty = amountBase;
    quoteQty = qty * price;
  }

  const book = getBook(user);

  if (paper) {
    const { quote: qAsset } = parsePair(pair);
    if (qAsset !== DEFAULT_QUOTE_ASSET) {
      return {
        ok: false,
        error: `Paper: folosește perechi cu ${DEFAULT_QUOTE_ASSET} (ex. BTC/${DEFAULT_QUOTE_ASSET}). Pentru ${qAsset} alege modul Real.`,
      };
    }
    let paperQuoteBal = getManualPaperQuoteBalance(user);
    if (s === "buy") {
      const fee = quoteQty * 0.001;
      const total = quoteQty + fee;
      if (paperQuoteBal < total) {
        return {
          ok: false,
          error: `Insufficient paper ${DEFAULT_QUOTE_ASSET} (reset paper balance în Trading)`,
        };
      }
      paperQuoteBal -= total;
      const b = book[pair] || { qty: 0, avg: 0, paper: true };
      const newQty = b.qty + qty;
      const newAvg = newQty > 0 ? (b.qty * b.avg + quoteQty) / newQty : price;
      book[pair] = { qty: newQty, avg: newAvg, paper: true };
      user.manualPaperQuoteBalance = paperQuoteBal;
      user.manualSpotBook = book;
      await user.save();

      const tr = await Trade.create({
        userId,
        botId: linkedBotId,
        pair,
        side: s,
        quantity: qty,
        price: avgPx,
        quoteQty,
        fee,
        pnl: 0,
        status: "simulated",
        isPaper: true,
        tradeSource: "manual",
        meta: { paper: true, ...(associateBotForControl ? { aiPilotControl: true } : {}) },
      });
      return { ok: true, trade: tr };
    }

    const b = book[pair] || { qty: 0, avg: 0, paper: true };
    if (b.qty + 1e-12 < qty) {
      return { ok: false, error: `Insufficient paper ${parsePair(pair).base} (open: ${b.qty})` };
    }
    const pnl = qty * (price - b.avg) - quoteQty * 0.001;
    const newQty = b.qty - qty;
    book[pair] =
      newQty > 1e-12
        ? { qty: newQty, avg: b.avg, paper: true }
        : { qty: 0, avg: 0, paper: true };
    paperQuoteBal += quoteQty * (1 - 0.001);
    user.manualPaperQuoteBalance = paperQuoteBal;
    user.manualSpotBook = book;
    await user.save();

    const tr = await Trade.create({
      userId,
      botId: linkedBotId,
      pair,
      side: "sell",
      quantity: qty,
      price,
      quoteQty,
      fee: quoteQty * 0.001,
      pnl,
      status: "simulated",
      isPaper: true,
      tradeSource: "manual",
      meta: { paper: true, ...(associateBotForControl ? { aiPilotControl: true } : {}) },
    });
    await bumpUserStats(userId, pnl, pnl > 0);
    return { ok: true, trade: tr };
  }

  const apiKey = decryptSecret(user.apiKeyEncrypted || "");
  const secret = decryptSecret(user.apiSecretEncrypted || "");
  if (!apiKey || !secret) {
    return { ok: false, error: "Add Binance API keys in Settings for live trading" };
  }

  try {
    let order;
    const ex = createExchange({ apiKey, secret });
    await syncServerTime(ex);
    await withRetries(() => ex.loadMarkets());
    await syncServerTime(ex);

    // Fail-fast pentru buy real: evităm să trimitem ordin când nu există fonduri.
    // Economisește call-uri la Binance și evită trade-uri „failed” înregistrate.
    if (s === "buy") {
      try {
        const bal = await withRetries(() => ex.fetchBalance(), { exchange: ex });
        const { quote: qAsset } = parsePair(pair);
        const freeObj = bal?.free || bal || {};
        const freeQ = Number(freeObj?.[qAsset] ?? freeObj?.USDC ?? 0) || 0;
        const want = Number(spendQuote != null && spendQuote > 0 ? spendQuote : quoteQty);
        // Lăsăm un buffer mic pentru fees/slippage (market order).
        const needed = want * 1.005;
        if (!Number.isFinite(freeQ) || freeQ < Math.max(2, needed)) {
          return {
            ok: false,
            error: `Fonduri ${qAsset} insuficiente: disponibil ${freeQ.toFixed(2)} ${qAsset}, necesar ~${needed.toFixed(2)} ${qAsset}.`,
          };
        }
      } catch {
        /* Dacă eșuează fetchBalance, lăsăm ordinul să încerce normal (fail-open). */
      }
    }

    if (s === "buy" && spendQuote != null && spendQuote > 0) {
      if (typeof ex.createMarketBuyOrderWithCost === "function") {
        order = await withRetries(() => ex.createMarketBuyOrderWithCost(pair, spendQuote), {
          exchange: ex,
        });
      } else {
        order = await withRetries(
          () =>
            ex.createOrder(pair, "market", "buy", spendQuote, undefined, {
              quoteOrderQty: spendQuote,
            }),
          { exchange: ex }
        );
      }
    } else if (s === "buy") {
      order = await placeOrder({
        apiKey,
        secret,
        symbol: pair,
        side: "buy",
        amount: qty,
        orderType: "market",
      });
    } else {
      const bPre = book[pair] || { qty: 0, avg: 0, paper: false };
      const bookQty = Number(bPre.qty) || 0;
      const treatFullExit =
        Boolean(fullExit) || (bookQty > 0 && qty >= bookQty * (1 - 1e-8));

      if (treatFullExit) {
        const legs = [];
        let soldSum = 0;
        let weightedCost = 0;
        let remainingWant = qty;
        const maxLegs = 6;

        while (remainingWant > 1e-14 && legs.length < maxLegs) {
          let orderLeg;
          try {
            orderLeg = await placeMarketSellSpotClamped({
              apiKey,
              secret,
              symbol: pair,
              amountBase: remainingWant,
            });
          } catch (e) {
            if (soldSum > 0 && isDustOrMinNotionalError(e)) break;
            throw e;
          }
          const f = Number(orderLeg.filled ?? 0);
          if (!Number.isFinite(f) || f <= 0) break;
          const pxLeg = Number(orderLeg.average || orderLeg.price || price);
          legs.push({ orderId: orderLeg.id, filled: f, price: pxLeg });
          soldSum += f;
          weightedCost += f * pxLeg;
          remainingWant = Math.max(0, qty - soldSum);
          if (remainingWant <= 1e-12) break;
        }

        const b = book[pair] || { qty: 0, avg: 0, paper: false };
        let newQty = Math.max(0, b.qty - soldSum);
        let pxMark = price;
        try {
          pxMark = await getPrice(pair);
        } catch {
          /* păstrăm price din început */
        }
        const notionRest = newQty * (Number.isFinite(pxMark) && pxMark > 0 ? pxMark : price);
        if (
          newQty <= 1e-10 ||
          newQty < b.qty * 1e-5 ||
          (b.qty > 0 && newQty / b.qty < 1e-5) ||
          notionRest < 0.35
        ) {
          newQty = 0;
        }

        book[pair] =
          newQty > 1e-12
            ? { qty: newQty, avg: b.avg, paper: false }
            : { qty: 0, avg: 0, paper: false };
        await updateUserBook(userId, book);

        const avgSell = soldSum > 0 ? weightedCost / soldSum : price;
        const pnl = soldSum * (avgSell - b.avg);
        const tr = await Trade.create({
          userId,
          botId: linkedBotId,
          pair,
          side: "sell",
          quantity: soldSum,
          price: avgSell,
          quoteQty: weightedCost,
          pnl,
          status: "filled",
          isPaper: false,
          tradeSource: "manual",
          meta: {
            orderId: legs[0]?.orderId,
            sellLegs: legs.length > 1 ? legs : undefined,
            fullExit: true,
            ...(associateBotForControl ? { aiPilotControl: true } : {}),
          },
        });
        await bumpUserStats(userId, pnl, pnl > 0);
        return { ok: true, trade: tr };
      }

      order = await placeMarketSellSpotClamped({
        apiKey,
        secret,
        symbol: pair,
        amountBase: qty,
      });
    }

    const filled = Number(order.filled ?? qty);
    const avg = Number(order.average || order.price || price);
    const cost = Number(order.cost ?? filled * avg);
    let pnl = 0;

    if (s === "buy") {
      const b = book[pair] || { qty: 0, avg: 0, paper: false };
      const newQty = b.qty + filled;
      const newAvg = newQty > 0 ? (b.qty * b.avg + cost) / newQty : avg;
      book[pair] = { qty: newQty, avg: newAvg, paper: false };
      await updateUserBook(userId, book);

      const tr = await Trade.create({
        userId,
        botId: linkedBotId,
        pair,
        side: "buy",
        quantity: filled,
        price: avg,
        quoteQty: cost,
        status: "filled",
        isPaper: false,
        tradeSource: "manual",
        meta: { orderId: order.id, ...(associateBotForControl ? { aiPilotControl: true } : {}) },
      });
      return { ok: true, trade: tr };
    }

    const b = book[pair] || { qty: 0, avg: 0, paper: false };
    pnl = filled * (avg - b.avg);
    const newQty = Math.max(0, b.qty - filled);
    book[pair] =
      newQty > 1e-12
        ? { qty: newQty, avg: b.avg, paper: false }
        : { qty: 0, avg: 0, paper: false };
    await updateUserBook(userId, book);

    const tr = await Trade.create({
      userId,
      botId: linkedBotId,
      pair,
      side: "sell",
      quantity: filled,
      price: avg,
      quoteQty: filled * avg,
      pnl,
      status: "filled",
      isPaper: false,
      tradeSource: "manual",
      meta: { orderId: order.id, ...(associateBotForControl ? { aiPilotControl: true } : {}) },
    });
    await bumpUserStats(userId, pnl, pnl > 0);
    return { ok: true, trade: tr };
  } catch (e) {
    if (isBinanceMarketClosedError(e)) {
      return { ok: false, error: await mapBinanceUserMessageAsync(e) };
    }
    const msg = e instanceof Error ? e.message : String(e);
    await Trade.create({
      userId,
      botId: linkedBotId,
      pair,
      side: s,
      quantity: qty,
      price,
      quoteQty,
      status: "failed",
      isPaper: false,
      tradeSource: "manual",
      errorMessage: msg,
      meta: associateBotForControl ? { aiPilotControl: true } : {},
    });
    return { ok: false, error: await mapBinanceUserMessageAsync(e) };
  }
}

import { Follow, User, Trade } from "@/models";
import { decryptSecret } from "@/lib/security/crypto";
import { placeMarketSellSpotClamped, placeOrder, getBalance } from "@/lib/binance/service";
import { connectDB } from "@/models/db";
import { DEFAULT_QUOTE_ASSET } from "@/lib/market-defaults";

/**
 * After a trader's live trade, mirror a proportional order for each active follower.
 * Raport proporțional pe soldul liber al cotei (implicit USDC, extras din pereche).
 */
export async function replicateTradeForFollowers({
  traderId,
  traderUser,
  sourceTradeDoc,
  pair,
  side,
  quantity,
  price,
  quoteQty,
}) {
  await connectDB();
  const follows = await Follow.find({ traderId, active: true }).lean();
  if (!follows.length) return;

  const quote = pair.includes("/") ? pair.split("/")[1] : DEFAULT_QUOTE_ASSET;
  const quoteFree = (bal) => {
    const f = bal?.free || bal;
    return Number(f?.[quote] ?? f?.USDC ?? 0) || 0;
  };

  let traderQuoteBal = 0;
  try {
    const tKey = decryptSecret(traderUser.apiKeyEncrypted || "");
    const tSec = decryptSecret(traderUser.apiSecretEncrypted || "");
    if (!tKey || !tSec) return;
    const tb = await getBalance(tKey, tSec);
    traderQuoteBal = quoteFree(tb);
  } catch {
    return;
  }
  if (traderQuoteBal <= 0) return;

  for (const f of follows) {
    const follower = await User.findById(f.followerId);
    if (!follower) continue;
    const fk = decryptSecret(follower.apiKeyEncrypted || "");
    const fs = decryptSecret(follower.apiSecretEncrypted || "");
    if (!fk || !fs) continue;

    let followerQuoteBal = 0;
    try {
      const fb = await getBalance(fk, fs);
      followerQuoteBal = quoteFree(fb);
    } catch {
      continue;
    }
    if (followerQuoteBal <= 0) continue;

    let ratio = followerQuoteBal / traderQuoteBal;
    if (ratio > 1) ratio = 1;
    if (f.scalingMode === "fixed") ratio = Math.min(ratio, 0.25);

    const followerQuote = quoteQty * ratio;
    const followerQty = (quantity * ratio).toFixed(8);

    try {
      const qtyNum = Number(followerQty);
      const order =
        side === "sell"
          ? await placeMarketSellSpotClamped({
              apiKey: fk,
              secret: fs,
              symbol: pair,
              amountBase: qtyNum,
            })
          : await placeOrder({
              apiKey: fk,
              secret: fs,
              symbol: pair,
              side,
              amount: qtyNum,
              price: undefined,
              orderType: "market",
              futures: false,
            });

      const filledFollow = Number(order.filled ?? qtyNum);
      const quoteRecorded =
        side === "sell" ? filledFollow * Number(price) : followerQuote;
      await Trade.create({
        userId: follower._id,
        botId: null,
        pair,
        side,
        quantity: filledFollow,
        price: Number(price),
        quoteQty: quoteRecorded,
        status: "filled",
        isPaper: false,
        traderId,
        copiedFromTradeId: sourceTradeDoc._id,
        tradeSource: "copy",
        meta: { orderId: order.id, scaledRatio: ratio },
      });

      const costBasis = followerQuote;
      const pnlEst = side === "sell" ? 0 : -costBasis * 0.001;
      follower.stats = follower.stats || {};
      follower.stats.totalTrades = (follower.stats.totalTrades || 0) + 1;
      follower.stats.totalProfit = (follower.stats.totalProfit || 0) + pnlEst;
      await follower.save();
    } catch (e) {
      await Trade.create({
        userId: follower._id,
        pair,
        side,
        quantity: Number(followerQty),
        price: Number(price),
        quoteQty: followerQuote,
        status: "failed",
        isPaper: false,
        traderId,
        copiedFromTradeId: sourceTradeDoc._id,
        tradeSource: "copy",
        errorMessage: String(e?.message || e),
      });
    }
  }
}

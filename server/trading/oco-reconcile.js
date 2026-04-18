/**
 * Reconciliere periodică între starea din DB (`user.liveProtections[pair].oco`)
 * și starea reală a ordinelor pe Binance.
 *
 * Cazuri gestionate:
 *  - OCO finalizat pe Binance (SL sau TP lovit): citim fill-urile, scădem qty
 *    din `manualSpotBook[pair]`, creăm un `Trade { status: "filled", meta.source: "oco_binance" }`
 *    cu pnl calculat, bump la stats user, curățăm `.oco` din liveProtections.
 *  - OCO anulat manual pe Binance (sau orderListId invalid): ștergem doar
 *    referința `.oco`, fără Trade.
 *  - OCO încă activ (EXECUTING): nu facem nimic.
 *
 * Rulează la 10–15 min via `/api/cron/reconcile-oco` și înainte de orice
 * decizie majoră a pilotului care citește qty din carte.
 */
import { connectDB } from "@/models/db";
import User from "@/models/User";
import Trade from "@/models/Trade";
import { decryptSecret } from "@/lib/security/crypto";
import { getPrice } from "@/lib/binance/service";
import { normSpotPair } from "@/lib/market-defaults";
import { fetchOcoFillDetails, fetchOcoStatus } from "@/server/trading/binance-oco";

function getBook(user) {
  const raw = user?.manualSpotBook;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return { ...raw };
  return {};
}

function getProt(user) {
  const raw = user?.liveProtections;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return { ...raw };
  return {};
}

async function reconcileUserOnce(userId) {
  const user = await User.findById(userId);
  if (!user) return { ok: false, error: "user_not_found" };

  const apiKey = decryptSecret(user.apiKeyEncrypted || "");
  const secret = decryptSecret(user.apiSecretEncrypted || "");
  if (!apiKey || !secret) return { ok: true, skipped: true, reason: "no_api_keys" };

  const prot = getProt(user);
  const entries = Object.entries(prot).filter(
    ([, v]) =>
      v &&
      typeof v === "object" &&
      v.oco &&
      typeof v.oco === "object" &&
      v.oco.orderListId
  );
  if (!entries.length) return { ok: true, skipped: true, reason: "no_oco_refs" };

  const events = [];

  for (const [pairKey, meta] of entries) {
    const pair = normSpotPair(pairKey);
    const oco = meta.oco;
    let st;
    try {
      st = await fetchOcoStatus({
        apiKey,
        secret,
        pair,
        orderListId: oco.orderListId,
      });
    } catch (e) {
      events.push({
        pair,
        action: "status_error",
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    if (st.error) {
      events.push({ pair, action: "status_error", error: st.error });
      continue;
    }
    if (!st.gone) {
      events.push({ pair, action: "still_active", status: st.status || null });
      continue;
    }

    /** 2. OCO nu mai e activ: cerem detaliile fill-ului. */
    let fill = null;
    try {
      fill = await fetchOcoFillDetails({
        apiKey,
        secret,
        pair,
        stopOrderId: oco.stopOrderId,
        limitOrderId: oco.limitOrderId,
      });
    } catch (e) {
      events.push({
        pair,
        action: "fill_error",
        error: e instanceof Error ? e.message : String(e),
      });
    }

    const filledQty = Number(fill?.filledQty ?? 0);
    const avgPrice = Number(fill?.avgPrice ?? 0);
    const trigger = fill?.trigger || null;

    const fresh = await User.findById(userId);
    const book = getBook(fresh);
    const protLive = getProt(fresh);

    if (filledQty > 1e-10) {
      const b = book[pair] || { qty: 0, avg: 0, paper: false };
      const newQty = Math.max(0, Number(b.qty || 0) - filledQty);
      const avgCost = Number(b.avg || 0);
      const pnl = filledQty * ((avgPrice || 0) - avgCost);

      book[pair] =
        newQty > 1e-12
          ? { qty: newQty, avg: avgCost, paper: false }
          : { qty: 0, avg: 0, paper: false };
      fresh.set("manualSpotBook", book);

      if (protLive[pair]) {
        const cur = { ...protLive[pair] };
        delete cur.oco;
        if (Object.keys(cur).length === 0) delete protLive[pair];
        else protLive[pair] = cur;
        fresh.set("liveProtections", protLive);
      }

      fresh.stats = fresh.stats || {};
      fresh.stats.totalProfit = Number(fresh.stats.totalProfit || 0) + pnl;
      fresh.stats.totalTrades = Number(fresh.stats.totalTrades || 0) + 1;
      if (pnl > 0) fresh.stats.winTrades = Number(fresh.stats.winTrades || 0) + 1;

      await fresh.save();

      let fallbackPrice = avgPrice;
      if (!(Number.isFinite(fallbackPrice) && fallbackPrice > 0)) {
        try {
          const p = await getPrice(pair);
          if (Number.isFinite(p) && p > 0) fallbackPrice = p;
        } catch {
          /* ignore */
        }
      }

      const tr = await Trade.create({
        userId,
        pair,
        side: "sell",
        quantity: filledQty,
        price: Number.isFinite(fallbackPrice) && fallbackPrice > 0 ? fallbackPrice : avgCost || 1,
        quoteQty: filledQty * (Number.isFinite(fallbackPrice) ? fallbackPrice : 0),
        pnl,
        status: "filled",
        isPaper: false,
        tradeSource: "manual",
        meta: {
          source: "oco_binance",
          trigger,
          orderListId: oco.orderListId,
          stopOrderId: oco.stopOrderId,
          limitOrderId: oco.limitOrderId,
          reconciledAt: new Date().toISOString(),
        },
      });
      events.push({
        pair,
        action: "oco_filled_synced",
        trigger,
        filledQty,
        avgPrice,
        pnl,
        tradeId: String(tr._id),
        newBookQty: Number(book[pair]?.qty || 0),
      });
    } else {
      /** OCO dispărut, dar fără fill detectabil → cancel manual pe Binance. Curățăm referința. */
      if (protLive[pair]) {
        const cur = { ...protLive[pair] };
        delete cur.oco;
        if (Object.keys(cur).length === 0) delete protLive[pair];
        else protLive[pair] = cur;
        fresh.set("liveProtections", protLive);
        await fresh.save();
      }
      events.push({
        pair,
        action: "oco_cancelled_externally",
        status: st.status || null,
      });
    }
  }

  return { ok: true, pairsChecked: entries.length, events };
}

/**
 * @param {{ limit?: number }} opts
 */
export async function runOcoReconcileBatch(opts = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 5000);
  await connectDB();
  const users = await User.find({ liveProtections: { $exists: true, $ne: {} } })
    .limit(limit)
    .select("_id")
    .lean();
  const results = [];
  for (const u of users) {
    try {
      const r = await reconcileUserOnce(String(u._id));
      results.push({ userId: String(u._id), ...r });
    } catch (e) {
      results.push({
        userId: String(u._id),
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}

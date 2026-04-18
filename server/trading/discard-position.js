import { connectDB } from "@/models/db";
import User from "@/models/User";
import Trade from "@/models/Trade";
import { decryptSecret } from "@/lib/security/crypto";
import {
  fetchBinanceSpotMarket,
  getPrice,
  spotMaxSellableBaseFromFree,
} from "@/lib/binance/service";
import { normSpotPair } from "@/lib/market-defaults";
import { cancelLiveProtectionOco } from "@/server/trading/live-protection-sync";

/**
 * Verifică dacă o cantitate dintr-o pereche spot reală este efectiv „praf”
 * (nevandabilă pe Binance după LOT_SIZE / minQty / MIN_NOTIONAL). Pentru
 * perechi paper răspunsul e mereu `dust: false` — nu există restricții reale.
 *
 * Returnează `{ checked: boolean, dust: boolean, sellable: number | null, reason?: string }`.
 */
export async function verifyRealDust({ apiKey, secret, pair, qty, price = null }) {
  if (!apiKey || !secret) {
    return { checked: false, dust: false, sellable: null, reason: "no_api_keys" };
  }
  try {
    const mkt = await fetchBinanceSpotMarket(apiKey, secret, pair);
    if (!mkt) {
      return { checked: false, dust: false, sellable: null, reason: "market_not_found" };
    }
    let px = Number(price);
    if (!Number.isFinite(px) || px <= 0) {
      try {
        px = await getPrice(pair);
      } catch {
        px = 0;
      }
    }
    const sellable = spotMaxSellableBaseFromFree(qty, mkt.market, Number.isFinite(px) ? px : null);
    return {
      checked: true,
      dust: Number.isFinite(sellable) && sellable <= 0,
      sellable: Number.isFinite(sellable) ? sellable : 0,
    };
  } catch (e) {
    return {
      checked: false,
      dust: false,
      sellable: null,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Elimină o poziție din `manualSpotBook` (și `liveProtections[pair]`) fără a
 * plasa ordin pe Binance și creează un `Trade` cu `status: "cancelled"` pentru
 * audit. Folosit atât de `/api/live/discard`, cât și ca auto-cleanup în
 * pilot-engine când se detectează praf.
 *
 * @param {{
 *   userId: string,
 *   pair: string,
 *   force?: boolean,
 *   verifyDust?: boolean,
 *   source?: string, // "user_manual" | "auto_dust_cleanup" | ...
 *   reason?: string,
 * }} args
 */
export async function discardManualPosition({
  userId,
  pair: rawPair,
  force = false,
  verifyDust = true,
  source = "user_manual",
  reason = "",
}) {
  await connectDB();
  const pair = normSpotPair(rawPair);
  const user = await User.findById(userId);
  if (!user) return { ok: false, error: "User not found" };

  const book =
    user.manualSpotBook && typeof user.manualSpotBook === "object" && !Array.isArray(user.manualSpotBook)
      ? { ...user.manualSpotBook }
      : {};
  const pos = book[pair];
  const qty = Number(pos?.qty ?? 0);
  if (!pos || !Number.isFinite(qty) || qty <= 1e-12) {
    return { ok: false, error: "Nu există o poziție deschisă în carte pentru această pereche." };
  }

  const isPaper = pos.paper === true;
  const avgEntry = Number(pos.avg ?? pos.avgEntry ?? 0);

  let dustInfo = { checked: false, dust: false, sellable: null };
  if (!isPaper && verifyDust && !force) {
    const apiKey = decryptSecret(user.apiKeyEncrypted || "");
    const secret = decryptSecret(user.apiSecretEncrypted || "");
    if (!apiKey || !secret) {
      return {
        ok: false,
        error:
          "Fără chei API Binance nu pot verifica dacă e praf. Confirmă cu „force” dacă vrei să elimini oricum.",
        code: "no_api_keys",
      };
    }
    dustInfo = await verifyRealDust({ apiKey, secret, pair, qty });
    if (!dustInfo.checked) {
      return {
        ok: false,
        error:
          "Nu am putut verifica piața Binance. Reîncearcă sau confirmă cu „force”. " +
          (dustInfo.reason || ""),
        code: "verify_failed",
      };
    }
    if (!dustInfo.dust) {
      return {
        ok: false,
        error:
          "Poziția NU e praf — Binance acceptă încă vânzarea. Folosește „Închide poziția” pentru market sell.",
        code: "not_dust",
        sellableBase: dustInfo.sellable,
      };
    }
  }

  /**
   * Dacă pe Binance există un OCO activ pe perechea asta, îl anulăm mai întâi
   * (altfel cantitatea rămâne blocată pe exchange). Fail-open dacă nu reușim:
   * discard-ul rămâne valid în app, iar userul poate anula manual pe Binance.
   */
  if (!isPaper) {
    try {
      await cancelLiveProtectionOco({ userId, pair });
    } catch {
      /* ignorăm — discard-ul continuă */
    }
  }

  const freshUser = await User.findById(userId);
  const book2 =
    freshUser?.manualSpotBook && typeof freshUser.manualSpotBook === "object" && !Array.isArray(freshUser.manualSpotBook)
      ? { ...freshUser.manualSpotBook }
      : { ...book };
  delete book2[pair];
  freshUser.set("manualSpotBook", book2);

  if (
    freshUser.liveProtections &&
    typeof freshUser.liveProtections === "object" &&
    !Array.isArray(freshUser.liveProtections)
  ) {
    const lp = { ...freshUser.liveProtections };
    if (pair in lp) {
      delete lp[pair];
      freshUser.set("liveProtections", lp);
    }
  }
  await freshUser.save();

  let price = avgEntry > 0 ? avgEntry : 0;
  try {
    const p = await getPrice(pair);
    if (Number.isFinite(p) && p > 0) price = p;
  } catch {
    /* păstrăm avg / 0 */
  }

  const resolvedReason = reason || (force ? "user_force" : dustInfo.dust ? "dust_confirmed" : "manual");
  const trade = await Trade.create({
    userId,
    pair,
    side: "sell",
    quantity: qty,
    price: price > 0 ? price : avgEntry || 1,
    quoteQty: qty * (price > 0 ? price : avgEntry || 0),
    pnl: 0,
    status: "cancelled",
    isPaper,
    tradeSource: "manual",
    errorMessage:
      "Poziție praf eliminată din carte (fără vânzare pe Binance). Orice sold real rămâne în cont.",
    meta: {
      discard: true,
      source,
      reason: resolvedReason,
      qty,
      avgEntry,
      ...(dustInfo.sellable != null ? { sellableBase: dustInfo.sellable } : {}),
    },
  });

  return { ok: true, trade, dust: dustInfo.dust === true };
}

/**
 * Sincronizează `liveProtections[pair].oco` cu starea reală de pe Binance.
 *
 * Reguli:
 * - Pozițiile paper: nu se plasează OCO (nu există ordin real pe exchange).
 * - Fără chei API: nu se plasează OCO; cron-ul la 1 min rămâne fallback.
 * - Ambele SL și TP prezente + qty > 0: plasează OCO. Dacă diferă prețurile
 *   sau cantitatea de cele memorate, se anulează vechiul OCO și se re-plasează.
 * - SL sau TP lipsește (sau clear): se anulează OCO existent; fără replacement.
 *
 * Folosit din 3 locuri:
 *  - POST /api/live/protect (save/clear)
 *  - executeManualTrade (după buy real, pentru re-creare pe noua qty)
 *  - /api/cron/reconcile-oco (curățare referințe moarte)
 */
import User from "@/models/User";
import { connectDB } from "@/models/db";
import { decryptSecret } from "@/lib/security/crypto";
import { normSpotPair } from "@/lib/market-defaults";
import {
  placeSpotOcoSell,
  cancelSpotOco,
  fetchOcoStatus,
} from "@/server/trading/binance-oco";

function getBook(user) {
  const raw = user?.manualSpotBook;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  return {};
}

function getProt(user) {
  const raw = user?.liveProtections;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  return {};
}

/** Comparare cu toleranță relativă 0.05% (suficient pentru tickSize clamp). */
function approxEqual(a, b, rel = 0.0005) {
  if (a == null || b == null) return false;
  const av = Number(a);
  const bv = Number(b);
  if (!Number.isFinite(av) || !Number.isFinite(bv)) return false;
  if (av === 0 && bv === 0) return true;
  const base = Math.max(Math.abs(av), Math.abs(bv));
  return Math.abs(av - bv) / base <= rel;
}

/**
 * @param {{
 *   userId: string,
 *   pair: string,
 *   reason?: string,
 *   forceReplace?: boolean,
 * }} args
 */
export async function syncLiveProtectionOco({ userId, pair: rawPair, reason = "", forceReplace = false }) {
  await connectDB();
  const user = await User.findById(userId);
  if (!user) return { ok: false, error: "user_not_found" };

  const pair = normSpotPair(rawPair);
  const book = getBook(user);
  const prot = getProt(user);
  const pos = book[pair];
  const qty = Number(pos?.qty ?? 0);
  const isPaper = Boolean(pos?.paper);
  const p = prot[pair] || {};
  const sl = p.stopLoss != null && Number.isFinite(Number(p.stopLoss)) ? Number(p.stopLoss) : null;
  const tp = p.takeProfit != null && Number.isFinite(Number(p.takeProfit)) ? Number(p.takeProfit) : null;
  const existingOco = p.oco && typeof p.oco === "object" ? p.oco : null;

  const apiKey = decryptSecret(user.apiKeyEncrypted || "");
  const secret = decryptSecret(user.apiSecretEncrypted || "");
  const hasKeys = Boolean(apiKey && secret);

  const wantOco = !isPaper && hasKeys && sl != null && tp != null && qty > 1e-12;

  const writeProt = async (next) => {
    const lp = { ...getProt(user) };
    if (next == null) {
      delete lp[pair];
    } else {
      lp[pair] = next;
    }
    user.set("liveProtections", lp);
    await user.save();
  };

  /** 1. Dacă nu vrem OCO dar există unul → cancel + curăță. */
  if (!wantOco) {
    if (existingOco?.orderListId && hasKeys) {
      const res = await cancelSpotOco({
        apiKey,
        secret,
        pair,
        orderListId: existingOco.orderListId,
      });
      const newProt = { ...p };
      delete newProt.oco;
      if (Object.keys(newProt).length === 0) {
        await writeProt(null);
      } else {
        await writeProt(newProt);
      }
      return {
        ok: true,
        action: "cancelled",
        reason: reason || "no_oco_needed",
        cancel: res,
      };
    }
    return { ok: true, action: "noop", reason: reason || "no_oco_needed" };
  }

  /** 2. Există deja OCO și parametrii (qty + prețuri) se potrivesc → verificăm că e încă activ. */
  if (
    !forceReplace &&
    existingOco?.orderListId &&
    approxEqual(existingOco.placedQty, qty) &&
    approxEqual(existingOco.stopPrice, sl) &&
    approxEqual(existingOco.limitPrice, tp)
  ) {
    const st = await fetchOcoStatus({
      apiKey,
      secret,
      pair,
      orderListId: existingOco.orderListId,
    });
    if (!st.gone) {
      return { ok: true, action: "kept", status: st.status || null };
    }
  }

  /** 3. Cancel vechiul (dacă există) + plasează OCO nou. */
  let cancelInfo = null;
  if (existingOco?.orderListId) {
    cancelInfo = await cancelSpotOco({
      apiKey,
      secret,
      pair,
      orderListId: existingOco.orderListId,
    });
  }

  try {
    const placed = await placeSpotOcoSell({
      apiKey,
      secret,
      pair,
      qty,
      stopLoss: sl,
      takeProfit: tp,
    });
    const next = {
      ...p,
      oco: {
        orderListId: placed.orderListId,
        stopOrderId: placed.stopOrderId,
        limitOrderId: placed.limitOrderId,
        placedQty: placed.placedQty,
        stopPrice: placed.stopPrice,
        stopLimitPrice: placed.stopLimitPrice,
        limitPrice: placed.limitPrice,
        placedAt: new Date().toISOString(),
        lastError: null,
      },
    };
    await writeProt(next);
    return {
      ok: true,
      action: existingOco?.orderListId ? "replaced" : "placed",
      cancel: cancelInfo,
      oco: next.oco,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const next = { ...p };
    delete next.oco;
    next.ocoLastError = { code: e?.code || "OCO_PLACE_FAILED", message: msg, at: new Date().toISOString() };
    await writeProt(next);
    return {
      ok: false,
      action: "failed",
      cancel: cancelInfo,
      error: msg,
      code: e?.code || "OCO_PLACE_FAILED",
    };
  }
}

/**
 * Anulează OCO-ul asociat unei perechi (dacă există), fără a schimba alte
 * câmpuri din `liveProtections[pair]`. Folosit înainte de market sell ca să
 * deblochezi qty pe Binance.
 */
export async function cancelLiveProtectionOco({ userId, pair: rawPair }) {
  await connectDB();
  const user = await User.findById(userId);
  if (!user) return { ok: false, error: "user_not_found" };

  const pair = normSpotPair(rawPair);
  const prot = getProt(user);
  const p = prot[pair];
  const existingOco = p?.oco && typeof p.oco === "object" ? p.oco : null;
  if (!existingOco?.orderListId) return { ok: true, action: "noop" };

  const apiKey = decryptSecret(user.apiKeyEncrypted || "");
  const secret = decryptSecret(user.apiSecretEncrypted || "");
  if (!apiKey || !secret) return { ok: false, error: "no_api_keys" };

  const res = await cancelSpotOco({
    apiKey,
    secret,
    pair,
    orderListId: existingOco.orderListId,
  });

  const fresh = await User.findById(userId);
  if (fresh) {
    const lp = { ...getProt(fresh) };
    const cur = lp[pair];
    if (cur && typeof cur === "object") {
      const { oco: _dropped, ...rest } = cur;
      if (Object.keys(rest).length === 0) {
        delete lp[pair];
      } else {
        lp[pair] = rest;
      }
      fresh.set("liveProtections", lp);
      await fresh.save();
    }
  }

  return { ok: res.ok, action: "cancelled", cancel: res };
}

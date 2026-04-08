import { connectDB } from "@/models/db";
import User from "@/models/User";
import { Bot } from "@/models";
import { fetchBinanceUsdcGainers } from "@/lib/market/discover-data";
import { getPrice } from "@/lib/binance/service";
import { runAutopilotDecide } from "@/lib/ai/autopilot-decide";
import { tryActivateBot } from "@/server/bots/try-activate-bot";
import { closeBotOpenPositionMarketOnly } from "@/server/trading/stop-bot";
import { executeManualTrade } from "@/server/trading/execute-manual";
import { createPilotStrategyAndBot } from "@/server/ai/pilot-create-bot";
import { readPilotOpen } from "@/server/ai/pilot-read-open";

function normPair(p) {
  return String(p || "")
    .trim()
    .toUpperCase()
    .replace(/-/g, "/");
}

function getManualBook(user) {
  const raw = user?.manualSpotBook;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  return {};
}

function countOpenManualPairs(book) {
  let n = 0;
  for (const v of Object.values(book)) {
    const q = Number(v?.qty ?? 0);
    if (Number.isFinite(q) && q > 1e-12) n++;
  }
  return n;
}

function manualPayloadFromUser(user) {
  const book = getManualBook(user);
  return Object.entries(book)
    .map(([pereche, v]) => {
      const q = Number(v?.qty ?? 0);
      if (!Number.isFinite(q) || q <= 1e-12) return null;
      return {
        pereche: normPair(pereche),
        cantitateBaza: q,
        pretMediu: Number(v?.avg ?? 0),
        paper: Boolean(v?.paper),
      };
    })
    .filter(Boolean);
}

function normalizeBotAction(a) {
  const s = String(a || "")
    .toLowerCase()
    .trim();
  if (s === "activeaza" || s === "activează") return "activeaza";
  if (s === "pauza") return "pauza";
  if (s === "inchide_pozitie" || s === "închide_pozitie" || s === "inchide_poziție") {
    return "inchide_pozitie";
  }
  if (s === "mentine") return "mentine";
  return "mentine";
}

function normalizeManualAction(a) {
  const s = String(a || "").toLowerCase();
  if (s === "cumpara" || s === "cumpără") return "cumpara";
  if (s === "vinde") return "vinde";
  return null;
}

function findPilotBotIdOnPair(pilotBots, pairKey) {
  const p = normPair(pairKey);
  for (const b of pilotBots) {
    if (normPair(b.pair) === p) return String(b._id);
  }
  return null;
}

/**
 * @param {string} userId
 */
export async function runAiPilotForUser(userId) {
  await connectDB();
  let user = await User.findById(userId);
  if (!user?.aiPilot?.enabled) {
    return { skipped: true, reason: "disabled" };
  }
  if (user.subscriptionPlan !== "pro" && user.subscriptionPlan !== "elite") {
    return { skipped: true, reason: "plan" };
  }

  const cfg = user.aiPilot;
  const intervalMin = Number(cfg.intervalMinutes) || 15;
  const last = cfg.lastRunAt ? new Date(cfg.lastRunAt).getTime() : 0;
  const minMs = intervalMin * 60_000;
  if (last && Date.now() - last < minMs) {
    return { skipped: true, reason: "throttle", nextInMs: minMs - (Date.now() - last) };
  }

  const allowedIds = Array.isArray(cfg.botIds) ? cfg.botIds.map((id) => String(id)) : [];
  const manualEnabled = Boolean(cfg.manualTradingEnabled);
  const createBotEnabled = Boolean(cfg.createBotFromAnalysis);
  const maxTradesPerRun = Math.min(20, Math.max(1, Number(cfg.maxTradesPerRun) || 3));
  const maxOpenManual = Math.min(20, Math.max(1, Number(cfg.maxOpenManualPositions) || 3));
  const maxUsdc = Math.max(2, Number(cfg.maxUsdcPerTrade) || 150);
  const orderMode = cfg.pilotOrderMode === "real" ? "real" : "paper";
  const maxPilotBots = Math.min(20, Math.max(1, Number(cfg.maxPilotBots) || 5));

  if (!allowedIds.length && !manualEnabled && !createBotEnabled) {
    user.aiPilot.lastRunAt = new Date();
    user.aiPilot.lastError =
      "Selectează boți în pilot sau activează tranzacțiile manuale / crearea de bot din analiză.";
    user.aiPilot.lastSummary = "";
    await user.save();
    return { ok: false, error: "no_pilot_scope" };
  }

  const allUserBots = await Bot.find({ userId }).select("pair").lean();
  let perechiBotiExistente = [...new Set(allUserBots.map((b) => normPair(b.pair)))];

  let bots = [];
  if (allowedIds.length) {
    bots = await Bot.find({ userId, _id: { $in: allowedIds } })
      .populate("strategyId", "name")
      .lean();
  }

  let gainersSlice = [];
  try {
    const g = await fetchBinanceUsdcGainers({ limit: 28, minQuoteVolume: 60_000 });
    gainersSlice = g.map((x) => ({
      pereche: x.pair,
      pct24h: x.pct24h,
      volQuote: x.quoteVolume,
      pret: x.lastPrice,
    }));
  } catch {
    gainersSlice = [];
  }
  const gainerPairSet = new Set(gainersSlice.map((x) => normPair(x.pereche)));

  user = await User.findById(userId);
  const book = getManualBook(user);
  const manualOpenCount = countOpenManualPairs(book);
  const manualPayload = manualPayloadFromUser(user);

  const botsPayload = [];
  for (const b of bots) {
    const po = readPilotOpen(b);
    let price = null;
    let pctFromEntry = null;
    try {
      price = await getPrice(b.pair);
      if (po.has && po.avgEntry > 0 && price > 0) {
        pctFromEntry = ((price - po.avgEntry) / po.avgEntry) * 100;
      }
    } catch {
      price = null;
    }
    botsPayload.push({
      botId: String(b._id),
      pereche: b.pair,
      mod: b.mode,
      statusCurent: b.status,
      strategie: b.strategyId?.name || "",
      arePozitie: po.has,
      cantitateBaza: po.has ? po.qty : 0,
      pretMediuIntrare: po.has ? po.avgEntry : null,
      pretPiata: price,
      pctProcentDeLaIntrare: pctFromEntry,
    });
  }

  const limite = {
    maxActiuniManualSiBotNouInTotal: maxTradesPerRun,
    pozitiiManualeCurente: manualOpenCount,
    maxPozitiiManualeSimultane: maxOpenManual,
    tranzactiiManualPermise: manualEnabled,
    creareBotPermisa: createBotEnabled,
    maxBoțiPilotSimultan: maxPilotBots,
  };

  async function refreshUser() {
    user = await User.findById(userId);
    return user;
  }

  let ai;
  try {
    ai = await runAutopilotDecide({
      gainersSlice,
      botsPayload,
      manualPayload,
      limite,
      perechiBotiExistente,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    user.aiPilot.lastRunAt = new Date();
    user.aiPilot.lastError = msg;
    await user.save();
    return { ok: false, error: msg };
  }

  const rezumat = String(ai.rezumat || "");
  let actionsUsed = 0;
  const applied = [];

  const rawManual = Array.isArray(ai.manual) ? ai.manual : [];
  const manualSells = [];
  const manualBuys = [];
  for (const m of rawManual) {
    const act = normalizeManualAction(m?.actiune);
    if (!act) continue;
    if (act === "vinde") manualSells.push(m);
    else manualBuys.push(m);
  }

  let manualBlocked = false;
  if (manualEnabled && orderMode === "real") {
    const u = await refreshUser();
    if (!u?.apiKeyEncrypted || !u?.apiSecretEncrypted) {
      manualBlocked = true;
      applied.push({ tip: "manual", actiune: "skip", motiv: "Chei API lipsă pentru mod real." });
    }
  }

  /** --- Faza 1: vânzări manuale --- */
  for (const m of manualSells) {
    if (!manualEnabled || manualBlocked || actionsUsed >= maxTradesPerRun) break;
    const pair = normPair(m.pereche);
    await refreshUser();
    const b = getManualBook(user)[pair];
    const qty = Number(b?.qty ?? 0);
    if (!Number.isFinite(qty) || qty <= 1e-12) {
      applied.push({ tip: "manual_vinde", pair, ok: false, detail: "fara_pozitie" });
      continue;
    }
    const pilotBotIdForSell = findPilotBotIdOnPair(bots, pair);

    const r = await executeManualTrade({
      userId,
      pair,
      side: "sell",
      mode: orderMode,
      amountBase: qty,
      fullExit: true,
      associateBotForControl: true,
      ...(pilotBotIdForSell ? { pilotBotId: pilotBotIdForSell } : {}),
    });
    actionsUsed++;
    applied.push({
      tip: "manual_vinde",
      pair,
      ok: r.ok,
      detail: r.error || "ok",
      motiv: String(m.motiv || ""),
    });
  }

  /** --- Faza 2: decizii boți existenți --- */
  const decisionsIn = Array.isArray(ai.decizii) ? ai.decizii : [];
  const byId = new Map(decisionsIn.map((d) => [String(d.botId), d]));

  for (const b of bots) {
    const id = String(b._id);
    const dec = byId.get(id);
    const act = dec ? normalizeBotAction(dec.actiune) : "mentine";
    const motiv = dec ? String(dec.motiv || "") : "implicit";

    if (act === "inchide_pozitie") {
      const po = readPilotOpen(b);
      if (po.has) {
        const r = await closeBotOpenPositionMarketOnly({ userId, botId: id });
        applied.push({
          botId: id,
          actiune: "inchide_pozitie",
          ok: r.ok,
          detail: r.error || r.action,
          motiv,
        });
        if (r.ok) {
          await Bot.findByIdAndUpdate(id, { status: "paused" });
        }
      } else {
        applied.push({ botId: id, actiune: "inchide_pozitie", ok: true, detail: "fara_pozitie", motiv });
      }
      continue;
    }

    if (act === "pauza") {
      if (b.status === "active") {
        await Bot.findByIdAndUpdate(id, { status: "paused" });
      }
      applied.push({ botId: id, actiune: "pauza", ok: true, motiv });
      continue;
    }

    if (act === "activeaza") {
      const r = await tryActivateBot({
        userId,
        botId: id,
        subscriptionPlan: user.subscriptionPlan || "free",
      });
      applied.push({
        botId: id,
        actiune: "activeaza",
        ok: r.ok,
        detail: r.error || "activ",
        motiv,
      });
      continue;
    }

    applied.push({ botId: id, actiune: "mentine", ok: true, motiv });
  }

  /**
   * Înainte de cumpărări manuale: dacă AI propune bot nou pe aceeași pereche,
   * botul există în DB și tranzacțiile manuale pot fi legate de `botId`.
   */
  let pilotCreatedBotId = null;
  let pilotCreatedPair = null;
  if (createBotEnabled && actionsUsed < maxTradesPerRun && ai.botNou && typeof ai.botNou === "object") {
    const bn = ai.botNou;
    const pairBn = normPair(bn.pereche);
    const goal = String(bn.obiectivStrategie || "").trim();
    if (pairBn && goal.length >= 8 && !perechiBotiExistente.includes(pairBn)) {
      const riskRaw = String(bn.risc || "balanced").toLowerCase();
      const risk =
        riskRaw === "conservative" || riskRaw === "aggressive" ? riskRaw : "balanced";
      const r = await createPilotStrategyAndBot({
        userId,
        subscriptionPlan: user.subscriptionPlan || "free",
        pair: pairBn,
        goal,
        riskStyle: risk,
        strategyName: bn.numeStrategie,
        activate: Boolean(bn.pornesteActiv),
        mode: orderMode,
        maxPilotBots,
        gainerPairSet,
      });
      actionsUsed++;
      if (Array.isArray(r.pilotEvicted)) {
        for (const ev of r.pilotEvicted) {
          applied.push({
            tip: "pilot_eliminat",
            pair: ev.pair,
            botId: ev.botId,
            ok: true,
            detail: "fara_pozitie_deschisa",
          });
        }
      }
      if (r.ok) {
        perechiBotiExistente.push(pairBn);
        pilotCreatedPair = pairBn;
        pilotCreatedBotId = r.bot?._id ? String(r.bot._id) : null;
      }
      applied.push({
        tip: "bot_nou",
        pair: pairBn,
        ok: r.ok,
        detail: r.error || (r.activated ? "creat_si_activ" : "creat"),
        activateError: r.activateError,
      });
    } else {
      applied.push({
        tip: "bot_nou",
        ok: false,
        detail: "pereche_invalida_sau_goal_scurt_sau_bot_existent",
      });
    }
  }

  /** --- Faza 3: cumpărări manuale --- */
  for (const m of manualBuys) {
    if (!manualEnabled || manualBlocked || actionsUsed >= maxTradesPerRun) break;
    const pair = normPair(m.pereche);
    if (!pair.endsWith("/USDC")) {
      applied.push({ tip: "manual_cumpara", pair, ok: false, detail: "doar_USDC" });
      continue;
    }

    await refreshUser();
    const bNow = getManualBook(user)[pair];
    const existingQty = Number(bNow?.qty ?? 0);
    const openPairs = countOpenManualPairs(getManualBook(user));

    if (!(existingQty > 1e-12) && openPairs >= maxOpenManual) {
      applied.push({ tip: "manual_cumpara", pair, ok: false, detail: "max_pozitii_manuale" });
      continue;
    }

    if (!(existingQty > 1e-12) && !gainerPairSet.has(pair)) {
      applied.push({ tip: "manual_cumpara", pair, ok: false, detail: "pereche_nu_e_in_top" });
      continue;
    }

    let spend = Number(m.sumaUsdc);
    if (!Number.isFinite(spend) || spend <= 0) spend = maxUsdc;
    spend = Math.min(spend, maxUsdc);
    if (spend < 2) {
      applied.push({ tip: "manual_cumpara", pair, ok: false, detail: "suma_prea_mica" });
      continue;
    }

    const pilotBotIdForBuy =
      pilotCreatedBotId && pilotCreatedPair && normPair(pair) === normPair(pilotCreatedPair)
        ? pilotCreatedBotId
        : findPilotBotIdOnPair(bots, pair);

    const r = await executeManualTrade({
      userId,
      pair,
      side: "buy",
      mode: orderMode,
      spendQuote: spend,
      associateBotForControl: true,
      ...(pilotBotIdForBuy ? { pilotBotId: pilotBotIdForBuy } : {}),
    });
    actionsUsed++;
    applied.push({
      tip: "manual_cumpara",
      pair,
      ok: r.ok,
      detail: r.error || "ok",
      spendQuote: spend,
      motiv: String(m.motiv || ""),
    });
  }

  user = await User.findById(userId);
  user.aiPilot.lastRunAt = new Date();
  user.aiPilot.lastSummary = rezumat.slice(0, 4000);
  user.aiPilot.lastError = "";
  await user.save();

  return {
    ok: true,
    rezumat,
    applied,
    gainersSlice: gainersSlice.length,
    actionsUsed,
  };
}

/**
 * @param {{ limit?: number }} opts
 */
export async function runAiPilotBatch(opts = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 30);
  await connectDB();
  const users = await User.find({
    "aiPilot.enabled": true,
    subscriptionPlan: { $in: ["pro", "elite"] },
  })
    .limit(limit)
    .select("_id")
    .lean();
  const results = [];
  for (const u of users) {
    try {
      const r = await runAiPilotForUser(String(u._id));
      results.push({ userId: String(u._id), ...r });
    } catch (e) {
      results.push({
        userId: String(u._id),
        ok: false,
        error: String(e?.message || e),
      });
    }
  }
  return results;
}

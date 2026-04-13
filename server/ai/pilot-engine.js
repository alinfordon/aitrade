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
import { runAutopilotManualLiveSellsDecide } from "@/lib/ai/autopilot-manual-live-decide";
import { buildAiRuntime } from "@/lib/ai/ai-preferences";
import { runLivePositionProtectAnalysis } from "@/lib/ai/live-position-analyze";
import Trade from "@/models/Trade";

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

/** Poziții manuale Spot reale (carte Live), fără paper. */
function liveManualPositionsFromUser(user) {
  return manualPayloadFromUser(user).filter((p) => !p.paper);
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

async function enrichAiPilotBuyWithStrategy({
  userId,
  pair,
  buyTradeId,
  motiv = "",
  aiRuntime,
}) {
  const user = await User.findById(userId);
  if (!user) return { ok: false, reason: "no_user" };
  const book = getManualBook(user);
  const row = book[pair];
  const qty = Number(row?.qty ?? 0);
  const avgEntry = Number(row?.avg ?? row?.avgEntry ?? 0);
  if (!Number.isFinite(qty) || qty <= 1e-12 || !Number.isFinite(avgEntry) || avgEntry <= 0) {
    return { ok: false, reason: "no_open_position" };
  }

  let markPrice = null;
  try {
    const px = await getPrice(pair);
    markPrice = Number.isFinite(px) && px > 0 ? px : null;
  } catch {
    markPrice = null;
  }

  let analysis;
  try {
    analysis = await runLivePositionProtectAnalysis({
      pair,
      avgEntry,
      qty,
      markPrice,
      aiRuntime,
    });
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }

  const live =
    user.liveProtections && typeof user.liveProtections === "object" && !Array.isArray(user.liveProtections)
      ? { ...user.liveProtections }
      : {};
  live[pair] = {
    ...(live[pair] && typeof live[pair] === "object" ? live[pair] : {}),
    stopLoss: analysis.stopLoss,
    takeProfit: analysis.takeProfit,
    aiPilotStrategy: {
      notaExecutive: analysis.notaExecutive,
      analizaTehnica: analysis.analizaTehnica,
      analizaFinanciara: analysis.analizaFinanciara,
      avertismente: analysis.avertismente,
      indicatoriPeGrafic: analysis.indicatoriPeGrafic,
      chartOverlaySpecs: analysis.chartOverlaySpecs,
      source: "ai-pilot-buy",
      savedAt: new Date().toISOString(),
    },
  };
  user.liveProtections = live;
  await user.save();

  if (buyTradeId) {
    const tr = await Trade.findById(buyTradeId);
    if (tr) {
      const meta = tr.meta && typeof tr.meta === "object" ? { ...tr.meta } : {};
      meta.aiPilotControl = true;
      meta.aiPilotStrategy = {
        motiv,
        source: "ai-pilot-buy",
        stopLoss: analysis.stopLoss,
        takeProfit: analysis.takeProfit,
        notaExecutive: analysis.notaExecutive,
        analizaTehnica: analysis.analizaTehnica,
        analizaFinanciara: analysis.analizaFinanciara,
        avertismente: analysis.avertismente,
        indicatoriPeGrafic: analysis.indicatoriPeGrafic,
        chartOverlaySpecs: analysis.chartOverlaySpecs,
      };
      tr.meta = meta;
      await tr.save();
    }
  }

  return { ok: true, analysis };
}

async function runManualLiveProtectionsTick({ userId, liveRows, bots }) {
  let user = await User.findById(userId);
  if (!user) return { applied: [] };
  const prot =
    user.liveProtections && typeof user.liveProtections === "object" && !Array.isArray(user.liveProtections)
      ? user.liveProtections
      : {};
  const applied = [];
  const aiPilotPairs = await readAiPilotPairSetByUser(user._id);
  if (!aiPilotPairs.size) return { applied };

  for (const row of liveRows) {
    const pair = normPair(row.pereche);
    if (!aiPilotPairs.has(pair)) continue;
    const p = prot[pair];
    if (!p || typeof p !== "object") continue;
    const stopLoss =
      p.stopLoss != null && Number.isFinite(Number(p.stopLoss)) ? Number(p.stopLoss) : null;
    const takeProfit =
      p.takeProfit != null && Number.isFinite(Number(p.takeProfit)) ? Number(p.takeProfit) : null;
    if (stopLoss == null && takeProfit == null) continue;

    let price = null;
    try {
      const px = await getPrice(pair);
      price = Number.isFinite(px) && px > 0 ? px : null;
    } catch {
      price = null;
    }
    if (price == null) continue;

    const hitSl = stopLoss != null && price <= stopLoss;
    const hitTp = takeProfit != null && price >= takeProfit;
    if (!hitSl && !hitTp) continue;

    user = await User.findById(userId);
    const b = getManualBook(user)[pair];
    const qty = Number(b?.qty ?? 0);
    const isPaper = Boolean(b?.paper);
    if (isPaper || !Number.isFinite(qty) || qty <= 1e-12) {
      applied.push({ tip: "manual_protect", pair, ok: false, detail: "fara_pozitie_live" });
      continue;
    }

    const pilotBotIdForSell = findPilotBotIdOnPair(bots, pair);
    const r = await executeManualTrade({
      userId,
      pair,
      side: "sell",
      mode: "real",
      amountBase: qty,
      fullExit: true,
      associateBotForControl: true,
      ...(pilotBotIdForSell ? { pilotBotId: pilotBotIdForSell } : {}),
    });
    applied.push({
      tip: "manual_protect",
      pair,
      ok: r.ok,
      detail: r.error || (hitSl ? "stop_loss_hit" : "take_profit_hit"),
      trigger: hitSl ? "sl" : "tp",
      price,
    });
  }

  if (applied.some((x) => x.ok)) {
    const uAfter = await User.findById(userId);
    if (uAfter) {
      const live =
        uAfter.liveProtections &&
        typeof uAfter.liveProtections === "object" &&
        !Array.isArray(uAfter.liveProtections)
          ? { ...uAfter.liveProtections }
          : {};
      for (const a of applied) {
        if (a.ok) delete live[a.pair];
      }
      uAfter.liveProtections = live;
      await uAfter.save();
    }
  }

  return { applied };
}

async function readAiPilotPairSetByUser(userObjectId) {
  const pairSet = new Set();
  const rows = await Trade.aggregate([
    {
      $match: {
        userId: userObjectId,
        tradeSource: "manual",
        side: "buy",
        status: { $in: ["filled", "simulated"] },
      },
    },
    { $sort: { createdAt: -1 } },
    { $group: { _id: "$pair", meta: { $first: "$meta" } } },
  ]);
  for (const row of rows) {
    if (row?.meta && typeof row.meta === "object" && row.meta.aiPilotControl) {
      pairSet.add(normPair(row._id));
    }
  }
  return pairSet;
}

const MAX_MANUAL_LIVE_AI_SELLS_PER_RUN = 5;

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

  const aiRuntime = buildAiRuntime(user);
  let ai;
  try {
    ai = await runAutopilotDecide({
      gainersSlice,
      botsPayload,
      manualPayload,
      limite,
      perechiBotiExistente,
      aiRuntime,
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
    if (r.ok && r.trade?._id) {
      const enrich = await enrichAiPilotBuyWithStrategy({
        userId,
        pair,
        buyTradeId: String(r.trade._id),
        motiv: String(m.motiv || ""),
        aiRuntime,
      });
      if (!enrich.ok) {
        applied.push({
          tip: "manual_cumpara_ai_strategy",
          pair,
          ok: false,
          detail: enrich.reason || "save_strategy_failed",
        });
      }
    }
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

/**
 * Cron dedicat: doar poziții manuale Live + decizii AI de vânzare (nu atinge lastRunAt al pilotului principal).
 * @param {string} userId
 */
export async function runAiPilotManualLiveForUser(userId) {
  await connectDB();
  let user = await User.findById(userId);
  if (!user?.aiPilot?.enabled) {
    return { skipped: true, reason: "disabled" };
  }
  if (!user.aiPilot.manualLiveAiEnabled) {
    return { skipped: true, reason: "manual_live_off" };
  }
  if (user.subscriptionPlan !== "pro" && user.subscriptionPlan !== "elite") {
    return { skipped: true, reason: "plan" };
  }
  if (!user.aiPilot.manualTradingEnabled) {
    return { skipped: true, reason: "manual_trading_off" };
  }
  if (user.aiPilot.pilotOrderMode !== "real") {
    return { skipped: true, reason: "not_real_mode" };
  }

  const cfg = user.aiPilot;
  const intervalMin = Math.min(30, Math.max(1, Number(cfg.manualLiveIntervalMinutes) || 5));
  const last = cfg.lastManualLiveRunAt ? new Date(cfg.lastManualLiveRunAt).getTime() : 0;
  const minMs = intervalMin * 60_000;
  if (last && Date.now() - last < minMs) {
    return { skipped: true, reason: "throttle", nextInMs: minMs - (Date.now() - last) };
  }

  user = await User.findById(userId);
  let liveRows = liveManualPositionsFromUser(user);
  if (!liveRows.length) {
    return { skipped: true, reason: "no_live_manual" };
  }

  const allowedIds = Array.isArray(cfg.botIds) ? cfg.botIds.map((id) => String(id)) : [];
  let bots = [];
  if (allowedIds.length) {
    bots = await Bot.find({ userId, _id: { $in: allowedIds } }).lean();
  }

  if (!user?.apiKeyEncrypted || !user?.apiSecretEncrypted) {
    user.aiPilot.lastManualLiveRunAt = new Date();
    user.aiPilot.lastManualLiveError = "Chei API lipsă pentru mod real.";
    user.aiPilot.lastManualLiveSummary = "";
    await user.save();
    return { ok: false, error: "no_api_keys" };
  }

  const protections = await runManualLiveProtectionsTick({ userId, liveRows, bots });
  const sellsDone = protections.applied.filter((x) => x.ok).length;
  const rezumat =
    sellsDone > 0
      ? "Cron la minut: TP/SL executat pe perechi AI Pilot cu strategie salvată."
      : "Cron la minut: monitorizare TP/SL pe perechi AI Pilot (fără semnal AI nou).";

  user = await User.findById(userId);
  user.aiPilot.lastManualLiveRunAt = new Date();
  user.aiPilot.lastManualLiveSummary = rezumat;
  user.aiPilot.lastManualLiveError = "";
  await user.save();

  return {
    ok: true,
    rezumat,
    applied: protections.applied || [],
    sellsDone,
    positionsChecked: liveRows.length,
  };
}

/**
 * @param {{ limit?: number }} opts
 */
export async function runAiPilotManualLiveBatch(opts = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 12, 1), 30);
  await connectDB();
  const users = await User.find({
    "aiPilot.enabled": true,
    "aiPilot.manualLiveAiEnabled": true,
    "aiPilot.manualTradingEnabled": true,
    "aiPilot.pilotOrderMode": "real",
    subscriptionPlan: { $in: ["pro", "elite"] },
  })
    .limit(limit)
    .select("_id")
    .lean();
  const results = [];
  for (const u of users) {
    try {
      const r = await runAiPilotManualLiveForUser(String(u._id));
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

/**
 * Cron separat (recomandat la 5 minute): AI analizează pozițiile pilot live și poate propune vânzări.
 * Nu înlocuiește cron-ul la minut pentru TP/SL, ci îl completează.
 * @param {string} userId
 */
export async function runAiPilotManualLiveAiForUser(userId) {
  await connectDB();
  let user = await User.findById(userId);
  if (!user?.aiPilot?.enabled) return { skipped: true, reason: "disabled" };
  if (!user.aiPilot.manualLiveAiEnabled) return { skipped: true, reason: "manual_live_off" };
  if (user.subscriptionPlan !== "pro" && user.subscriptionPlan !== "elite") {
    return { skipped: true, reason: "plan" };
  }
  if (!user.aiPilot.manualTradingEnabled) return { skipped: true, reason: "manual_trading_off" };
  if (user.aiPilot.pilotOrderMode !== "real") return { skipped: true, reason: "not_real_mode" };
  if (!user?.apiKeyEncrypted || !user?.apiSecretEncrypted) return { skipped: true, reason: "no_api_keys" };

  const liveRowsAll = liveManualPositionsFromUser(user);
  if (!liveRowsAll.length) return { skipped: true, reason: "no_live_manual" };
  const aiPilotPairs = await readAiPilotPairSetByUser(user._id);
  const liveRows = liveRowsAll.filter((r) => aiPilotPairs.has(normPair(r.pereche)));
  if (!liveRows.length) return { skipped: true, reason: "no_pilot_live_pairs" };

  const cfg = user.aiPilot;
  const allowedIds = Array.isArray(cfg.botIds) ? cfg.botIds.map((id) => String(id)) : [];
  let bots = [];
  if (allowedIds.length) {
    bots = await Bot.find({ userId, _id: { $in: allowedIds } }).lean();
  }

  const pozitii = [];
  for (const row of liveRows) {
    let pretPiata = null;
    let pctDeLaIntrare = null;
    try {
      pretPiata = await getPrice(row.pereche);
      const avg = Number(row.pretMediu) || 0;
      if (avg > 0 && pretPiata > 0) {
        pctDeLaIntrare = ((pretPiata - avg) / avg) * 100;
      }
    } catch {
      pretPiata = null;
    }
    pozitii.push({
      pereche: row.pereche,
      cantitateBaza: row.cantitateBaza,
      pretMediu: row.pretMediu,
      pretPiata,
      pctDeLaIntrare,
    });
  }

  const aiRuntime = buildAiRuntime(user);
  let ai;
  try {
    ai = await runAutopilotManualLiveSellsDecide({ pozitii, aiRuntime });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const rezumat = String(ai.rezumat || "");
  const rawVinde = Array.isArray(ai.vinde) ? ai.vinde : [];
  const allowedPairs = new Set(liveRows.map((r) => normPair(r.pereche)));
  const applied = [];
  let sellsDone = 0;

  for (const item of rawVinde) {
    if (sellsDone >= MAX_MANUAL_LIVE_AI_SELLS_PER_RUN) break;
    const pair = normPair(item?.pereche);
    if (!pair || !allowedPairs.has(pair)) {
      applied.push({ tip: "manual_vinde_live_ai", pair: pair || "?", ok: false, detail: "pereche_invalida" });
      continue;
    }
    user = await User.findById(userId);
    const b = getManualBook(user)[pair];
    const qty = Number(b?.qty ?? 0);
    const isPaper = Boolean(b?.paper);
    if (isPaper || !Number.isFinite(qty) || qty <= 1e-12) {
      applied.push({ tip: "manual_vinde_live_ai", pair, ok: false, detail: "fara_pozitie_live" });
      continue;
    }

    const pilotBotIdForSell = findPilotBotIdOnPair(bots, pair);
    const r = await executeManualTrade({
      userId,
      pair,
      side: "sell",
      mode: "real",
      amountBase: qty,
      fullExit: true,
      associateBotForControl: true,
      ...(pilotBotIdForSell ? { pilotBotId: pilotBotIdForSell } : {}),
    });
    sellsDone++;
    applied.push({
      tip: "manual_vinde_live_ai",
      pair,
      ok: r.ok,
      detail: r.error || "ok",
      motiv: String(item?.motiv || ""),
    });
  }

  return {
    ok: true,
    rezumat,
    applied,
    sellsDone,
    positionsChecked: liveRows.length,
  };
}

/**
 * @param {{ limit?: number }} opts
 */
export async function runAiPilotManualLiveAiBatch(opts = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 12, 1), 30);
  await connectDB();
  const users = await User.find({
    "aiPilot.enabled": true,
    "aiPilot.manualLiveAiEnabled": true,
    "aiPilot.manualTradingEnabled": true,
    "aiPilot.pilotOrderMode": "real",
    subscriptionPlan: { $in: ["pro", "elite"] },
  })
    .limit(limit)
    .select("_id")
    .lean();
  const results = [];
  for (const u of users) {
    try {
      const r = await runAiPilotManualLiveAiForUser(String(u._id));
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

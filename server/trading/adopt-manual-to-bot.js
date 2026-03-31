import { connectDB } from "@/models/db";
import User from "@/models/User";
import Bot from "@/models/Bot";
import Trade from "@/models/Trade";
import { maxBotsForPlan } from "@/lib/plans";

function getBook(user) {
  const raw = user.manualSpotBook;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { ...raw };
  }
  return {};
}

async function inferLedgerPaper(userId, pair) {
  const t = await Trade.findOne({ userId, pair, tradeSource: "manual" })
    .sort({ createdAt: -1 })
    .select("isPaper")
    .lean();
  if (!t) return undefined;
  return Boolean(t.isPaper);
}

/**
 * Mută poziția din manualSpotBook în bot (paper sau real), șterge intrarea manuală,
 * golește liveProtections pentru pereche, poziția e gestionată de bot-runner (SL/TP %, semnale ieșire).
 */
export async function adoptManualToBot({ userId, botId, subscriptionPlan }) {
  await connectDB();
  const bot = await Bot.findOne({ _id: botId, userId });
  if (!bot) {
    return { ok: false, error: "Bot inexistent.", status: 404 };
  }
  if (bot.futuresEnabled) {
    return {
      ok: false,
      error: "Doar boturile spot pot prelua o poziție manuală.",
      status: 400,
    };
  }

  const pair = bot.pair;
  const user = await User.findById(userId);
  if (!user) {
    return { ok: false, error: "User not found", status: 404 };
  }

  const book = getBook(user);
  const row = book[pair];
  const qty = Number(row?.qty ?? 0);
  const avg = Number(row?.avg ?? 0);
  if (!Number.isFinite(qty) || qty <= 1e-12) {
    return {
      ok: false,
      error: `Nu ai poziție manuală pe ${pair}.`,
      status: 400,
    };
  }
  if (!Number.isFinite(avg) || avg <= 0) {
    return { ok: false, error: "Medie de intrare invalidă în carte.", status: 400 };
  }

  const botPaper = bot.mode === "paper";
  let ledgerPaper = row.paper;
  if (ledgerPaper === undefined) {
    ledgerPaper = await inferLedgerPaper(userId, pair);
  }
  if (ledgerPaper === undefined) {
    ledgerPaper = true;
  }
  if (Boolean(ledgerPaper) !== botPaper) {
    return {
      ok: false,
      error:
        "Modul botului (paper / real) trebuie să corespundă cu poziția manuală. Folosește un bot cu același mod.",
      status: 400,
    };
  }

  const paperState = bot.paperState || {};
  const posState = bot.positionState || {};
  if (botPaper && paperState.open) {
    return {
      ok: false,
      error: "Botul are deja o poziție paper deschisă.",
      status: 400,
    };
  }
  if (!botPaper && posState.open) {
    return {
      ok: false,
      error: "Botul are deja o poziție reală deschisă.",
      status: 400,
    };
  }

  if (!botPaper) {
    if (!user.apiKeyEncrypted || !user.apiSecretEncrypted) {
      return {
        ok: false,
        error: "Adaugă chei API Binance în Setări pentru bot real.",
        status: 400,
      };
    }
  }

  const max = maxBotsForPlan(subscriptionPlan);
  if (bot.status !== "active" && Number.isFinite(max)) {
    const activeCount = await Bot.countDocuments({ userId, status: "active" });
    if (activeCount >= max) {
      return {
        ok: false,
        error: `Limită boturi active pentru plan (${max}).`,
        status: 403,
      };
    }
  }

  if (botPaper) {
    bot.paperState = {
      quoteBalance: Number(paperState.quoteBalance ?? 10000),
      baseBalance: qty,
      avgEntry: avg,
      open: true,
    };
    bot.positionState = { open: false, side: "buy", entryPrice: 0, quantity: 0 };
  } else {
    bot.positionState = {
      open: true,
      side: "buy",
      entryPrice: avg,
      quantity: qty,
      openedAt: new Date(),
    };
  }

  delete book[pair];
  user.manualSpotBook = book;

  const liveProt =
    user.liveProtections && typeof user.liveProtections === "object" && !Array.isArray(user.liveProtections)
      ? { ...user.liveProtections }
      : {};
  delete liveProt[pair];
  user.liveProtections = liveProt;

  bot.status = "active";
  await user.save();
  await bot.save();

  return { ok: true, bot };
}

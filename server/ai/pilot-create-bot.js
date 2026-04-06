import { connectDB } from "@/models/db";
import { Bot, Strategy } from "@/models";
import { maxBotsForPlan } from "@/lib/plans";
import { generateStrategyFromUserGoal } from "@/lib/ai/strategy-from-prompt";
import { tryActivateBot } from "@/server/bots/try-activate-bot";

/**
 * Generează strategie (Gemini) și creează bot asociat. Perechea trebuie să fie liberă (fără alt bot user).
 */
export async function createPilotStrategyAndBot(args) {
  const {
    userId,
    subscriptionPlan,
    pair,
    goal,
    riskStyle = "balanced",
    strategyName,
    activate = false,
    mode = "paper",
  } = args;

  await connectDB();
  const max = maxBotsForPlan(subscriptionPlan);
  const count = await Bot.countDocuments({ userId });
  if (Number.isFinite(max) && count >= max) {
    return { ok: false, error: "Plan bot limit reached.", status: 403 };
  }

  const taken = await Bot.findOne({ userId, pair }).select("_id").lean();
  if (taken) {
    return { ok: false, error: "A bot already exists for this pair.", status: 409 };
  }

  let gen;
  try {
    gen = await generateStrategyFromUserGoal({
      goal,
      pair,
      riskStyle,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), status: 400 };
  }

  const displayName = (strategyName && String(strategyName).trim()) || gen.name;
  const strat = await Strategy.create({
    userId,
    name: `${displayName} (Pilot)`.slice(0, 120),
    definition: gen.definition,
    source: "pilot",
  });

  const bot = await Bot.create({
    userId,
    strategyId: strat._id,
    pair,
    mode,
    status: "stopped",
    risk: {
      stopLossPct: 2,
      takeProfitPct: 3,
      maxDailyLossPct: 5,
      positionSizePct: 10,
    },
    paperState: {
      quoteBalance: 10000,
      baseBalance: 0,
      avgEntry: 0,
      open: false,
    },
  });

  if (activate) {
    const act = await tryActivateBot({
      userId,
      botId: String(bot._id),
      subscriptionPlan,
    });
    if (!act.ok) {
      return {
        ok: true,
        strategy: strat,
        bot,
        activateError: act.error,
        activated: false,
      };
    }
    return { ok: true, strategy: strat, bot: act.bot, activated: true };
  }

  return { ok: true, strategy: strat, bot, activated: false };
}

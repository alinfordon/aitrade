import { connectDB } from "@/models/db";
import { Bot, User } from "@/models";
import { maxBotsForPlan } from "@/lib/plans";

/**
 * @param {{ userId: string, botId: string, subscriptionPlan: string }}
 */
export async function tryActivateBot({ userId, botId, subscriptionPlan }) {
  await connectDB();
  const max = maxBotsForPlan(subscriptionPlan);
  const activeCount = await Bot.countDocuments({
    userId,
    status: "active",
  });
  if (Number.isFinite(max) && activeCount >= max) {
    return {
      ok: false,
      error: `Active bot limit reached for your plan (${max}).`,
      status: 403,
    };
  }

  const bot = await Bot.findOne({ _id: botId, userId });
  if (!bot) {
    return { ok: false, error: "Not found", status: 404 };
  }

  if (bot.mode === "real") {
    const user = await User.findById(userId);
    if (!user?.apiKeyEncrypted || !user?.apiSecretEncrypted) {
      return {
        ok: false,
        error: "Add Binance API keys under Settings before live trading.",
        status: 400,
      };
    }
  }

  bot.status = "active";
  await bot.save();
  return { ok: true, bot };
}

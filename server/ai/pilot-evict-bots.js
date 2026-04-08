import { connectDB } from "@/models/db";
import { Bot, Strategy } from "@/models";
import { removeBotsFromAiPilot } from "@/server/bots/remove-bots-from-ai-pilot";
import { readPilotOpen } from "@/server/ai/pilot-read-open";

function normPair(p) {
  return String(p || "")
    .trim()
    .toUpperCase()
    .replace(/-/g, "/");
}

/**
 * Înainte de a crea un bot nou din pilot, asigură loc: șterge boți cu strategie `pilot`
 * fără poziție deschisă (paper/real) până rămân cel mult `maxPilotBots - 1` astfel de boți.
 *
 * Nu atinge boți cu poziție sau strategii non-pilot. Poziția deschisă = singura formă de
 * „tranzacție activă” urmărită aici (nu există status „open” pe modelul Trade).
 *
 * @param {{ userId: string, maxPilotBots: number, gainerPairSet: Set<string> }} args
 * @returns {Promise<{ ok: boolean, evicted: { botId: string, pair: string }[], error?: string }>}
 */
export async function evictPilotBotsForNewCreation(args) {
  const { userId, gainerPairSet } = args;
  const maxPilotBots = Math.max(1, Math.min(20, Math.floor(Number(args.maxPilotBots) || 1)));
  const targetBeforeCreate = maxPilotBots - 1;

  await connectDB();

  const pilotBots = await Bot.find({ userId })
    .populate("strategyId", "source")
    .select("pair status updatedAt mode paperState positionState strategyId")
    .lean();

  const sourced = pilotBots.filter((b) => b.strategyId && String(b.strategyId.source) === "pilot");
  if (sourced.length <= targetBeforeCreate) {
    return { ok: true, evicted: [] };
  }

  let needRemove = sourced.length - targetBeforeCreate;
  const evicted = [];

  const candidates = [];
  for (const b of sourced) {
    const po = readPilotOpen(b);
    if (po.has) continue;
    const p = normPair(b.pair);
    const inGainers = gainerPairSet.has(p);
    const activeRank = b.status === "active" ? 1 : 0;
    const t = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    candidates.push({
      b,
      sortKey: [inGainers ? 1 : 0, activeRank, t],
    });
  }

  candidates.sort((a, b) => {
    for (let i = 0; i < a.sortKey.length; i++) {
      if (a.sortKey[i] !== b.sortKey[i]) return a.sortKey[i] - b.sortKey[i];
    }
    return 0;
  });

  for (const { b } of candidates) {
    if (needRemove <= 0) break;
    const stratId = b.strategyId?._id ?? b.strategyId;
    const botId = String(b._id);

    await Bot.deleteOne({ _id: b._id, userId });
    await removeBotsFromAiPilot(userId, botId);

    if (stratId) {
      await Strategy.deleteOne({
        _id: stratId,
        userId,
        source: "pilot",
      });
    }

    evicted.push({ botId, pair: String(b.pair) });
    needRemove--;
  }

  const still = sourced.length - evicted.length;
  if (still > targetBeforeCreate) {
    return {
      ok: false,
      evicted,
      error:
        "Plafon boți pilot atins: nu s-a putut elibera un loc — toți boții pilot rămași au poziție deschisă (sau expunere) pe bot. Închide poziția (ex. „închide poziție” în rundă sau manual) apoi reîncearcă.",
    };
  }

  return { ok: true, evicted };
}

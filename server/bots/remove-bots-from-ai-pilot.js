import mongoose from "mongoose";
import User from "@/models/User";

/**
 * Scoate ID-urile de bot din `user.aiPilot.botIds` după ștergerea botului/boților.
 */
export async function removeBotsFromAiPilot(userId, botIdOrIds) {
  const raw = Array.isArray(botIdOrIds) ? botIdOrIds : [botIdOrIds];
  const ids = raw
    .filter(Boolean)
    .map((id) => {
      const s = String(id);
      return mongoose.isValidObjectId(s) ? new mongoose.Types.ObjectId(s) : null;
    })
    .filter(Boolean);
  if (!ids.length) return;

  const uid =
    userId instanceof mongoose.Types.ObjectId
      ? userId
      : new mongoose.Types.ObjectId(String(userId));

  await User.updateOne({ _id: uid }, { $pullAll: { "aiPilot.botIds": ids } });
}

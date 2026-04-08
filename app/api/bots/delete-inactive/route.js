import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/models/db";
import Bot from "@/models/Bot";
import { requireAuth } from "@/lib/api-helpers";
import { removeBotsFromAiPilot } from "@/server/bots/remove-bots-from-ai-pilot";

export const dynamic = "force-dynamic";

/**
 * Șterge toți boții utilizatorului care nu sunt activi (stopped / paused).
 * Actualizează și `aiPilot.botIds`.
 */
export async function POST() {
  const { session, error } = await requireAuth();
  if (error) return error;

  await connectDB();
  const uid = new mongoose.Types.ObjectId(String(session.userId));

  const toRemove = await Bot.find({
    userId: uid,
    status: { $in: ["stopped", "paused"] },
  })
    .select("_id")
    .lean();
  const ids = toRemove.map((b) => b._id);

  const r = await Bot.deleteMany({
    userId: uid,
    status: { $in: ["stopped", "paused"] },
  });

  if (ids.length) {
    await removeBotsFromAiPilot(session.userId, ids);
  }

  return NextResponse.json({
    ok: true,
    deletedCount: r.deletedCount ?? 0,
  });
}

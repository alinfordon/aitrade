import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import Strategy from "@/models/Strategy";
import Bot from "@/models/Bot";
import { requireAuth } from "@/lib/api-helpers";

/**
 * DELETE all strategies with source "pilot" for the current user.
 * Strategies referenced by at least one of the user's bots are skipped.
 */
export async function DELETE() {
  const { session, error } = await requireAuth();
  if (error) return error;
  await connectDB();

  const pilotList = await Strategy.find({ userId: session.userId, source: "pilot" }).select("_id").lean();
  if (!pilotList.length) {
    return NextResponse.json({ deletedCount: 0, skippedInUse: 0 });
  }

  const pilotIds = pilotList.map((p) => p._id);
  const usedIds = await Bot.find({ userId: session.userId, strategyId: { $in: pilotIds } })
    .distinct("strategyId");
  const used = new Set(usedIds.map((id) => String(id)));
  const toDelete = pilotIds.filter((id) => !used.has(String(id)));

  if (!toDelete.length) {
    return NextResponse.json({
      deletedCount: 0,
      skippedInUse: pilotIds.length,
      message:
        "Nicio strategie pilot ștearsă: toate sunt legate de boti. Oprește sau șterge botii respectivi mai întâi.",
    });
  }

  const r = await Strategy.deleteMany({ _id: { $in: toDelete }, userId: session.userId });
  return NextResponse.json({
    deletedCount: r.deletedCount,
    skippedInUse: pilotIds.length - toDelete.length,
  });
}

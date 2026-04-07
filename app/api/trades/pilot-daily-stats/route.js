import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/models/db";
import Trade from "@/models/Trade";
import { requireAuth } from "@/lib/api-helpers";
import { respondIfMongoMissing } from "@/lib/mongo-env";

export const dynamic = "force-dynamic";

/**
 * Agregă PnL pentru tranzacțiile marcate de AI Pilot într-un interval [from, to).
 * Clientul trimite marginile zilei locale ca ISO (ex. midnight local → toISOString).
 */
export async function GET(request) {
  const missing = respondIfMongoMissing();
  if (missing) return missing;

  const { session, error } = await requireAuth();
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const fromRaw = searchParams.get("from");
  const toRaw = searchParams.get("to");
  if (!fromRaw || !toRaw) {
    return NextResponse.json(
      { error: "Parametrii from și to (ISO 8601) sunt obligatorii." },
      { status: 400 }
    );
  }

  const dFrom = new Date(fromRaw);
  const dTo = new Date(toRaw);
  if (!Number.isFinite(dFrom.getTime()) || !Number.isFinite(dTo.getTime())) {
    return NextResponse.json({ error: "Date invalide." }, { status: 400 });
  }
  if (dTo <= dFrom) {
    return NextResponse.json({ error: "to trebuie să fie după from." }, { status: 400 });
  }

  await connectDB();
  const oid = new mongoose.Types.ObjectId(session.userId);

  const [totals] = await Trade.aggregate([
    {
      $match: {
        userId: oid,
        "meta.aiPilotControl": true,
        createdAt: { $gte: dFrom, $lt: dTo },
      },
    },
    {
      $group: {
        _id: null,
        totalPnl: { $sum: { $ifNull: ["$pnl", 0] } },
        tradeCount: { $sum: 1 },
        wins: { $sum: { $cond: [{ $gt: [{ $ifNull: ["$pnl", 0] }, 0] }, 1, 0] } },
        losses: { $sum: { $cond: [{ $lt: [{ $ifNull: ["$pnl", 0] }, 0] }, 1, 0] } },
        neutral: {
          $sum: {
            $cond: [{ $eq: [{ $ifNull: ["$pnl", 0] }, 0] }, 1, 0],
          },
        },
      },
    },
  ]);

  return NextResponse.json({
    from: dFrom.toISOString(),
    to: dTo.toISOString(),
    summary: {
      totalPnl: totals?.totalPnl != null ? Number(totals.totalPnl) : 0,
      tradeCount: totals?.tradeCount != null ? Number(totals.tradeCount) : 0,
      wins: totals?.wins != null ? Number(totals.wins) : 0,
      losses: totals?.losses != null ? Number(totals.losses) : 0,
      neutral: totals?.neutral != null ? Number(totals.neutral) : 0,
    },
  });
}

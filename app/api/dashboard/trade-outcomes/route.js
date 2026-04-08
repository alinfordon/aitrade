import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/models/db";
import Trade from "@/models/Trade";
import { requireAuth } from "@/lib/api-helpers";
import { respondIfMongoMissing } from "@/lib/mongo-env";

export const dynamic = "force-dynamic";

function utcYmd(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function utcYm(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Agregări win/loss/neutral pe zi (30 zile UTC) și lună (12 luni UTC).
 * Aceleași criterii ca win rate în live-stats: live (`isPaper: false`), `pnl` setat.
 */
export async function GET() {
  const missing = respondIfMongoMissing();
  if (missing) return missing;

  const { session, error } = await requireAuth();
  if (error) return error;

  await connectDB();
  const oid = new mongoose.Types.ObjectId(session.userId);
  const now = new Date();

  const dayCutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29, 0, 0, 0, 0));
  const monthCutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1, 0, 0, 0, 0));

  const [byDay, byMonth] = await Promise.all([
    Trade.aggregate([
      {
        $match: {
          userId: oid,
          isPaper: false,
          pnl: { $exists: true, $ne: null },
          createdAt: { $gte: dayCutoff },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" },
          },
          wins: { $sum: { $cond: [{ $gt: ["$pnl", 0] }, 1, 0] } },
          losses: { $sum: { $cond: [{ $lt: ["$pnl", 0] }, 1, 0] } },
          neutral: { $sum: { $cond: [{ $eq: ["$pnl", 0] }, 1, 0] } },
        },
      },
    ]),
    Trade.aggregate([
      {
        $match: {
          userId: oid,
          isPaper: false,
          pnl: { $exists: true, $ne: null },
          createdAt: { $gte: monthCutoff },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m", date: "$createdAt", timezone: "UTC" },
          },
          wins: { $sum: { $cond: [{ $gt: ["$pnl", 0] }, 1, 0] } },
          losses: { $sum: { $cond: [{ $lt: ["$pnl", 0] }, 1, 0] } },
          neutral: { $sum: { $cond: [{ $eq: ["$pnl", 0] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const dayMap = new Map(
    byDay.map((r) => [
      r._id,
      {
        wins: Number(r.wins) || 0,
        losses: Number(r.losses) || 0,
        neutral: Number(r.neutral) || 0,
      },
    ])
  );

  const monthMap = new Map(
    byMonth.map((r) => [
      r._id,
      {
        wins: Number(r.wins) || 0,
        losses: Number(r.losses) || 0,
        neutral: Number(r.neutral) || 0,
      },
    ])
  );

  const dailyBuckets = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i, 12, 0, 0, 0));
    const key = utcYmd(d);
    const cur = dayMap.get(key) || { wins: 0, losses: 0, neutral: 0 };
    dailyBuckets.push({
      key,
      label: d.toLocaleDateString("ro-RO", { day: "numeric", month: "short", timeZone: "UTC" }),
      labelFull: `${key} UTC`,
      wins: cur.wins,
      losses: cur.losses,
      neutral: cur.neutral,
      total: cur.wins + cur.losses + cur.neutral,
    });
  }

  const monthlyBuckets = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1, 12, 0, 0, 0));
    const key = utcYm(d);
    const cur = monthMap.get(key) || { wins: 0, losses: 0, neutral: 0 };
    monthlyBuckets.push({
      key,
      label: d.toLocaleDateString("ro-RO", { month: "short", year: "numeric", timeZone: "UTC" }),
      labelFull: `${key} (UTC)`,
      wins: cur.wins,
      losses: cur.losses,
      neutral: cur.neutral,
      total: cur.wins + cur.losses + cur.neutral,
    });
  }

  return NextResponse.json({
    disclaimer:
      "Doar tranzacții live cu PnL înregistrat (excl. paper/simulate și fără PnL). Câștig = PnL > 0, pierdere = PnL < 0, egal = PnL 0.",
    timezoneNote:
      "Zilele sunt trase la miezul nopții UTC, ca și celelalte statistici live din dashboard.",
    daily: { days: 30, buckets: dailyBuckets },
    monthly: { months: 12, buckets: monthlyBuckets },
  });
}

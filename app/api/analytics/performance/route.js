import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import Trade from "@/models/Trade";
import { requireAuth } from "@/lib/api-helpers";
import { respondIfMongoMissing } from "@/lib/mongo-env";
import { buildPerformanceReport } from "@/server/analytics/performance-report";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const missing = respondIfMongoMissing();
  if (missing) return missing;

  const { session, error } = await requireAuth();
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source") || "all";
  const paper = searchParams.get("paper") || "all";
  const pair = searchParams.get("pair");
  const limit = Math.min(Number(searchParams.get("limit") || 3000), 5000);

  const filter = { userId: session.userId, status: { $in: ["filled", "simulated"] } };
  if (pair) filter.pair = pair;
  if (source === "bot") {
    filter.$or = [{ tradeSource: "bot" }, { tradeSource: { $exists: false } }];
  } else if (source !== "all") {
    filter.tradeSource = source;
  }
  if (paper === "paper") filter.isPaper = true;
  if (paper === "real") filter.isPaper = false;

  await connectDB();
  const trades = await Trade.find(filter).sort({ createdAt: 1 }).limit(limit).lean();

  const report = buildPerformanceReport(
    trades.map((t) => ({
      pair: t.pair,
      side: t.side,
      quantity: t.quantity,
      price: t.price,
      pnl: t.pnl,
      createdAt: t.createdAt,
      tradeSource: t.tradeSource,
      isPaper: t.isPaper,
    }))
  );

  return NextResponse.json({
    filter: { source, paper, pair: pair || null },
    ...report,
  });
}

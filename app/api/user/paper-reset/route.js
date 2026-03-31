import { NextResponse } from "next/server";
import User from "@/models/User";
import { requireAuth } from "@/lib/api-helpers";
import { respondIfMongoMissing } from "@/lib/mongo-env";
import { connectDB } from "@/models/db";
import { DEFAULT_QUOTE_ASSET } from "@/lib/market-defaults";

export async function POST() {
  const missing = respondIfMongoMissing();
  if (missing) return missing;

  const { session, error } = await requireAuth();
  if (error) return error;

  await connectDB();
  await User.findByIdAndUpdate(session.userId, {
    manualPaperQuoteBalance: 10000,
    manualSpotBook: {},
  });
  return NextResponse.json({
    ok: true,
    manualPaperQuoteBalance: 10000,
    quoteAsset: DEFAULT_QUOTE_ASSET,
  });
}

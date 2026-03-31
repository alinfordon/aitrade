import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import User from "@/models/User";
import { requireAuth } from "@/lib/api-helpers";
import { DEFAULT_QUOTE_ASSET, getManualPaperQuoteBalance } from "@/lib/market-defaults";

export async function GET() {
  const { session, error } = await requireAuth();
  if (error) return error;
  await connectDB();
  const user = await User.findById(session.userId).lean();
  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    user: {
      id: String(user._id),
      email: user.email,
      displayName: user.displayName || "",
      subscriptionPlan: user.subscriptionPlan,
      planExpiresAt:
        user.planExpiresAt != null ? new Date(user.planExpiresAt).toISOString() : null,
      role: user.role,
      hasApiKeys: Boolean(user.apiKeyEncrypted && user.apiSecretEncrypted),
      stats: user.stats || {},
      manualPaperQuoteBalance: getManualPaperQuoteBalance(user),
      manualPaperQuoteAsset: DEFAULT_QUOTE_ASSET,
    },
  });
}

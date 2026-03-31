import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { respondIfMongoMissing } from "@/lib/mongo-env";
import { adoptManualToBot } from "@/server/trading/adopt-manual-to-bot";

export const dynamic = "force-dynamic";

export async function POST(_, { params }) {
  const missing = respondIfMongoMissing();
  if (missing) return missing;

  const { session, error } = await requireAuth();
  if (error) return error;

  const r = await adoptManualToBot({
    userId: session.userId,
    botId: params.id,
    subscriptionPlan: session.subscriptionPlan,
  });
  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: r.status ?? 400 });
  }
  return NextResponse.json({ ok: true, bot: r.bot });
}

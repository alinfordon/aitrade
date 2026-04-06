import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { tryActivateBot } from "@/server/bots/try-activate-bot";

export async function POST(_, { params }) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const r = await tryActivateBot({
    userId: session.userId,
    botId: params.id,
    subscriptionPlan: session.subscriptionPlan,
  });

  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: r.status ?? 400 });
  }

  return NextResponse.json({ bot: r.bot });
}

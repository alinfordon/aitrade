import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-helpers";
import { respondIfMongoMissing } from "@/lib/mongo-env";
import { stopBotWithDisposition } from "@/server/trading/stop-bot";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  disposition: z.enum(["close_market", "manual"]).optional(),
});

export async function POST(request, { params }) {
  const missing = respondIfMongoMissing();
  if (missing) return missing;

  const { session, error } = await requireAuth();
  if (error) return error;

  let raw = {};
  try {
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      raw = await request.json();
    }
  } catch {
    raw = {};
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const r = await stopBotWithDisposition({
    userId: session.userId,
    botId: params.id,
    disposition: parsed.data.disposition,
  });

  if (r.needsDisposition) {
    return NextResponse.json(
      { error: r.error, needsDisposition: true },
      { status: 400 }
    );
  }

  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: r.status ?? 400 });
  }

  return NextResponse.json({ bot: r.bot, action: r.action ?? null });
}

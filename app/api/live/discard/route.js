import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { respondIfMongoMissing } from "@/lib/mongo-env";
import { liveDiscardSchema } from "@/lib/validations/schemas";
import { discardManualPosition } from "@/server/trading/discard-position";

export const dynamic = "force-dynamic";

/**
 * Elimină o poziție din `manualSpotBook` fără a încerca vânzarea pe exchange.
 * Destinat „prafului” care nu respectă LOT_SIZE / MIN_NOTIONAL pe Binance și a
 * cărui existență în carte face ca AI Pilot / SL-TP să genereze tranzacții
 * `failed` repetate. Curăță și `liveProtections[pair]` și salvează un
 * `Trade { status: "cancelled" }` ca audit.
 */
export async function POST(request) {
  const missing = respondIfMongoMissing();
  if (missing) return missing;

  const { session, error } = await requireAuth();
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalid" }, { status: 400 });
  }

  const parsed = liveDiscardSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join(" · ") },
      { status: 400 }
    );
  }

  const { pair, force } = parsed.data;

  const result = await discardManualPosition({
    userId: session.userId,
    pair,
    force: Boolean(force),
    verifyDust: true,
    source: "user_manual",
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        ...(result.code ? { code: result.code } : {}),
        ...(result.sellableBase != null ? { sellableBase: result.sellableBase } : {}),
      },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, trade: result.trade, dust: result.dust });
}

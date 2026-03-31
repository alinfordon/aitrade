import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { manualTradeSchema } from "@/lib/validations/schemas";
import { respondIfMongoMissing } from "@/lib/mongo-env";
import { executeManualTrade } from "@/server/trading/execute-manual";

export const dynamic = "force-dynamic";

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

  const parsed = manualTradeSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join(" · ");
    return NextResponse.json(
      { error: msg || "Date invalide", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { side, mode, pair, amountBase, spendQuote } = parsed.data;
  if (side === "sell" && (amountBase == null || amountBase <= 0)) {
    return NextResponse.json({ error: "Pentru vânzare setează amountBase (cantitate în moneda de bază)." }, { status: 400 });
  }
  if (side === "buy" && (spendQuote == null || spendQuote <= 0) && (amountBase == null || amountBase <= 0)) {
    return NextResponse.json(
      { error: "Pentru cumpărare setează spendQuote (USDC pentru paper) sau amountBase." },
      { status: 400 }
    );
  }

  const result = await executeManualTrade({
    userId: session.userId,
    pair,
    side,
    mode,
    amountBase,
    spendQuote,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ trade: result.trade });
}

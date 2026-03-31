import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import User from "@/models/User";
import { requireAuth } from "@/lib/api-helpers";
import { respondIfMongoMissing } from "@/lib/mongo-env";
import { liveCloseSchema } from "@/lib/validations/schemas";
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

  const parsed = liveCloseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join(" · ") },
      { status: 400 }
    );
  }

  const { pair, mode } = parsed.data;

  await connectDB();
  const user = await User.findById(session.userId).lean();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const book =
    user.manualSpotBook && typeof user.manualSpotBook === "object" && !Array.isArray(user.manualSpotBook)
      ? user.manualSpotBook
      : {};
  const pos = book[pair];
  /** Întreaga poziție în moneda de bază — market sell realizează și profitul latent (valoarea la prețul pieței). */
  const qty = Number(pos?.qty ?? 0);
  if (!Number.isFinite(qty) || qty <= 1e-12) {
    return NextResponse.json(
      { error: "Nu există cantitate deschisă în carte pentru această pereche." },
      { status: 400 }
    );
  }

  const result = await executeManualTrade({
    userId: session.userId,
    pair,
    side: "sell",
    mode,
    amountBase: qty,
    fullExit: true,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const uAfter = await User.findById(session.userId);
  if (uAfter?.liveProtections && typeof uAfter.liveProtections === "object" && !Array.isArray(uAfter.liveProtections)) {
    const lp = { ...uAfter.liveProtections };
    delete lp[pair];
    uAfter.set("liveProtections", lp);
    await uAfter.save();
  }

  return NextResponse.json({ ok: true, trade: result.trade });
}

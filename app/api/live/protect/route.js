import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import User from "@/models/User";
import { requireAuth } from "@/lib/api-helpers";
import { respondIfMongoMissing } from "@/lib/mongo-env";
import { liveProtectSchema } from "@/lib/validations/schemas";

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

  const parsed = liveProtectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join(" · ") },
      { status: 400 }
    );
  }

  const { pair, stopLoss, takeProfit, clear } = parsed.data;

  await connectDB();
  const user = await User.findById(session.userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const live =
    user.liveProtections && typeof user.liveProtections === "object" && !Array.isArray(user.liveProtections)
      ? { ...user.liveProtections }
      : {};

  if (clear) {
    delete live[pair];
    user.liveProtections = live;
    await user.save();
    return NextResponse.json({ ok: true, liveProtections: live });
  }

  const cur = { ...(live[pair] && typeof live[pair] === "object" ? live[pair] : {}) };
  if (stopLoss !== undefined) {
    if (stopLoss === null) delete cur.stopLoss;
    else cur.stopLoss = stopLoss;
  }
  if (takeProfit !== undefined) {
    if (takeProfit === null) delete cur.takeProfit;
    else cur.takeProfit = takeProfit;
  }

  if (Object.keys(cur).length === 0) delete live[pair];
  else live[pair] = cur;

  user.liveProtections = live;
  await user.save();

  return NextResponse.json({ ok: true, pair, protection: live[pair] || null, liveProtections: live });
}

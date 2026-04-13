import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { connectDB } from "@/models/db";
import User from "@/models/User";
import { canUseAiPilot } from "@/lib/plans";
import { runAiPilotForUser } from "@/server/ai/pilot-engine";

export const dynamic = "force-dynamic";

export async function POST() {
  const { session, error } = await requireAuth();
  if (error) return error;

  if (!canUseAiPilot(session.subscriptionPlan)) {
    return NextResponse.json(
      { error: "AI Pilot este disponibil pe planurile Pro și Elite." },
      { status: 403 }
    );
  }

  await connectDB();
  const user = await User.findById(session.userId).select("aiPilot.enabled").lean();
  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!user?.aiPilot?.enabled) {
    return NextResponse.json(
      { error: "AI Pilot este inactiv în setări. Activează-l înainte de rulare manuală." },
      { status: 409 }
    );
  }

  try {
    const result = await runAiPilotForUser(String(session.userId), { force: true });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

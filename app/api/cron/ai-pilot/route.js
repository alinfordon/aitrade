import { NextResponse } from "next/server";
import { verifyCron } from "@/lib/api-helpers";
import { runAiPilotBatch } from "@/server/ai/pilot-engine";

/**
 * Declanșare: același secret ca la /api/cron/run-bots (Bearer CRON_SECRET).
 * Recomandat: EasyCron sau Vercel cron la fiecare 15 minute.
 * Motorul respectă `aiPilot.intervalMinutes` per utilizator (implicit 15).
 */
export async function GET(request) {
  if (!verifyCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await runAiPilotBatch({ limit: 12 });
  return NextResponse.json({ ok: true, results });
}

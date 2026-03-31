import { NextResponse } from "next/server";
import { verifyCron } from "@/lib/api-helpers";
import { runActiveBotsBatch } from "@/server/engine/bot-runner";
import { getSession } from "@/lib/auth/session";

/**
 * Manual or alternate trigger (POST). Cron uses /api/cron/run-bots (GET).
 * Accepts CRON_SECRET Bearer **or** admin session.
 */
export async function POST(request) {
  const cronOk = verifyCron(request);
  const session = await getSession();
  const adminOk = session?.role === "admin";

  if (!cronOk && !adminOk) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = 25;
  const results = await runActiveBotsBatch(limit);
  return NextResponse.json({ ok: true, processed: results.length, results });
}

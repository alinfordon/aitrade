import { NextResponse } from "next/server";
import { verifyCron } from "@/lib/api-helpers";
import { runActiveBotsBatch } from "@/server/engine/bot-runner";

/**
 * Declanșare: EasyCron (recomandat 1 min) — vezi `docs/easycron.md`.
 * Header: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request) {
  if (!verifyCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const results = await runActiveBotsBatch(20);
  return NextResponse.json({ ok: true, processed: results.length, results });
}

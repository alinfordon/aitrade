import { NextResponse } from "next/server";
import { z } from "zod";
import { generateAutoStrategy } from "@/lib/ai/auto-strategy";
import { requireAuth } from "@/lib/api-helpers";
import { DEFAULT_SPOT_PAIR } from "@/lib/market-defaults";

const bodySchema = z.object({
  pair: z.string().min(3).max(32).default(DEFAULT_SPOT_PAIR),
  safeMode: z.boolean().default(false),
});

/** Generează strategie rule-based în memorie (fără DB) — pentru draft + îngo. */
export async function POST(request) {
  const { error } = await requireAuth();
  if (error) return error;

  let json = {};
  try {
    json = await request.json();
  } catch {
    /* body opțional */
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const gen = generateAutoStrategy({
    pair: parsed.data.pair,
    safeMode: parsed.data.safeMode,
  });
  return NextResponse.json(gen);
}

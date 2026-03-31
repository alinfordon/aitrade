import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import Strategy from "@/models/Strategy";
import { requireAuth } from "@/lib/api-helpers";
import { generateAutoStrategy } from "@/lib/ai/auto-strategy";
import { z } from "zod";
import { DEFAULT_SPOT_PAIR } from "@/lib/market-defaults";

const bodySchema = z.object({
  pair: z.string().default(DEFAULT_SPOT_PAIR),
  safeMode: z.boolean().default(false),
});

export async function POST(request, { params }) {
  const { session, error } = await requireAuth();
  if (error) return error;

  let json = {};
  try {
    json = await request.json();
  } catch {
    /* optional body */
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await connectDB();
  const existing = await Strategy.findOne({ _id: params.id, userId: session.userId });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const gen = generateAutoStrategy({
    pair: parsed.data.pair,
    safeMode: parsed.data.safeMode,
  });
  existing.name = gen.name;
  existing.definition = gen.definition;
  existing.source = "auto";
  existing.safeMode = parsed.data.safeMode;
  await existing.save();
  return NextResponse.json({ strategy: existing, suggestedRisk: gen.risk });
}

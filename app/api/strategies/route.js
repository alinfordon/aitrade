import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import Strategy from "@/models/Strategy";
import { createStrategySchema } from "@/lib/validations/schemas";
import { requireAuth } from "@/lib/api-helpers";
import { allExamples } from "@/lib/strategies/examples";

export async function GET() {
  const { session, error } = await requireAuth();
  if (error) return error;
  await connectDB();
  const strategies = await Strategy.find({ userId: session.userId }).sort({ updatedAt: -1 }).lean();
  return NextResponse.json({ strategies, examples: allExamples });
}

export async function POST(request) {
  const { session, error } = await requireAuth();
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createStrategySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await connectDB();
  const s = await Strategy.create({
    userId: session.userId,
    name: parsed.data.name,
    definition: parsed.data.definition,
    safeMode: parsed.data.safeMode || false,
    source: "user",
  });
  return NextResponse.json({ strategy: s });
}

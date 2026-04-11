import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, rateLimitOrThrow } from "@/lib/api-helpers";
import { connectDB } from "@/models/db";
import User from "@/models/User";
import { generateStrategyFromUserGoal } from "@/lib/ai/strategy-from-prompt";
import { DEFAULT_SPOT_PAIR } from "@/lib/market-defaults";
import { buildAiRuntime } from "@/lib/ai/ai-preferences";

const bodySchema = z.object({
  goal: z.string().min(8).max(4000),
  pair: z.string().min(3).max(32).optional(),
  riskStyle: z.enum(["conservative", "balanced", "aggressive"]).optional(),
});

export async function POST(request) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const rl = await rateLimitOrThrow(String(session.userId), "ai-strategy-prompt");
  if (rl) return rl;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await connectDB();
  const user = await User.findById(session.userId)
    .select(
      "aiSettings aiGeminiApiKeyEncrypted aiGeminiModel aiAnthropicApiKeyEncrypted aiAnthropicModel aiOllamaBaseUrl aiOllamaModel"
    )
    .lean();
  const aiRuntime = buildAiRuntime(user);

  try {
    const pair = parsed.data.pair?.trim() || DEFAULT_SPOT_PAIR;
    const result = await generateStrategyFromUserGoal({
      goal: parsed.data.goal,
      pair,
      riskStyle: parsed.data.riskStyle ?? "balanced",
      aiRuntime,
    });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Eroare generare";
    const status = /lipsește|GEMINI_API_KEY|ANTHROPIC_API_KEY|Ollama:/i.test(msg) ? 503 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

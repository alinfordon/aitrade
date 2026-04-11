import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import User from "@/models/User";
import { requireAuth } from "@/lib/api-helpers";
import { respondIfMongoMissing } from "@/lib/mongo-env";
import { aiUserSettingsSchema } from "@/lib/validations/schemas";
import { encryptSecret } from "@/lib/security/crypto";
import { buildAiRuntime, isAiProviderConfigured, prefsFromUser } from "@/lib/ai/ai-preferences";

export const dynamic = "force-dynamic";

function serverFlags() {
  return {
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
    anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
    ollamaEnvConfigured: Boolean(
      process.env.OLLAMA_BASE_URL?.trim() || process.env.OLLAMA_MODEL?.trim()
    ),
  };
}

export async function GET() {
  const missing = respondIfMongoMissing();
  if (missing) return missing;

  const { session, error } = await requireAuth();
  if (error) return error;

  await connectDB();
  const user = await User.findById(session.userId).lean();
  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const prefs = prefsFromUser(user);
  return NextResponse.json({
    settings: {
      provider: prefs.provider,
      claudeAgentic: prefs.claudeAgentic,
      geminiModel: String(user.aiGeminiModel || ""),
      anthropicModel: String(user.aiAnthropicModel || ""),
      ollamaBaseUrl: String(user.aiOllamaBaseUrl || ""),
      ollamaModel: String(user.aiOllamaModel || ""),
    },
    keyStatus: {
      hasUserGeminiKey: Boolean(user.aiGeminiApiKeyEncrypted),
      hasUserAnthropicKey: Boolean(user.aiAnthropicApiKeyEncrypted),
    },
    server: serverFlags(),
    selectedProviderConfigured: isAiProviderConfigured(user),
  });
}

export async function PATCH(request) {
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

  const parsed = aiUserSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join(" · ") },
      { status: 400 }
    );
  }

  await connectDB();
  const patch = parsed.data;
  const $set = {};
  if (patch.provider != null) $set["aiSettings.provider"] = patch.provider;
  if (patch.claudeAgentic != null) $set["aiSettings.claudeAgentic"] = patch.claudeAgentic;

  if (patch.geminiApiKey !== undefined) {
    if (patch.geminiApiKey.trim()) {
      try {
        $set.aiGeminiApiKeyEncrypted = encryptSecret(patch.geminiApiKey.trim());
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Criptare eșuată";
        return NextResponse.json({ error: msg }, { status: 500 });
      }
    } else {
      $set.aiGeminiApiKeyEncrypted = "";
    }
  }

  if (patch.anthropicApiKey !== undefined) {
    if (patch.anthropicApiKey.trim()) {
      try {
        $set.aiAnthropicApiKeyEncrypted = encryptSecret(patch.anthropicApiKey.trim());
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Criptare eșuată";
        return NextResponse.json({ error: msg }, { status: 500 });
      }
    } else {
      $set.aiAnthropicApiKeyEncrypted = "";
    }
  }

  if (patch.geminiModel !== undefined) {
    $set.aiGeminiModel = String(patch.geminiModel || "").trim().slice(0, 128);
  }
  if (patch.anthropicModel !== undefined) {
    $set.aiAnthropicModel = String(patch.anthropicModel || "").trim().slice(0, 128);
  }

  if (patch.ollamaBaseUrl !== undefined) {
    $set.aiOllamaBaseUrl = String(patch.ollamaBaseUrl || "").trim().slice(0, 512);
  }
  if (patch.ollamaModel !== undefined) {
    $set.aiOllamaModel = String(patch.ollamaModel || "").trim().slice(0, 128);
  }

  if (!Object.keys($set).length) {
    return NextResponse.json({ error: "Nimic de actualizat" }, { status: 400 });
  }

  const user = await User.findByIdAndUpdate(session.userId, { $set }, { new: true }).lean();
  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const prefs = prefsFromUser(user);
  return NextResponse.json({
    ok: true,
    settings: {
      provider: prefs.provider,
      claudeAgentic: prefs.claudeAgentic,
      geminiModel: String(user.aiGeminiModel || ""),
      anthropicModel: String(user.aiAnthropicModel || ""),
      ollamaBaseUrl: String(user.aiOllamaBaseUrl || ""),
      ollamaModel: String(user.aiOllamaModel || ""),
    },
    keyStatus: {
      hasUserGeminiKey: Boolean(user.aiGeminiApiKeyEncrypted),
      hasUserAnthropicKey: Boolean(user.aiAnthropicApiKeyEncrypted),
    },
    server: serverFlags(),
    selectedProviderConfigured: isAiProviderConfigured(user),
  });
}

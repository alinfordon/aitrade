/**
 * Preferințe AI per utilizator + rezolvare chei / URL Ollama (user → env).
 */

import { decryptSecret } from "@/lib/security/crypto";
import { normalizeOllamaBaseUrl } from "@/lib/ai/ollama";

/**
 * @param {Record<string, unknown> | null | undefined} user
 * @returns {{ provider: "gemini" | "claude" | "ollama", claudeAgentic: boolean }}
 */
export function prefsFromUser(user) {
  const raw = user && typeof user === "object" && user.aiSettings && typeof user.aiSettings === "object" ? user.aiSettings : {};
  const p = String(raw.provider || "").toLowerCase();
  if (p === "claude") return { provider: "claude", claudeAgentic: Boolean(raw.claudeAgentic) };
  if (p === "ollama") return { provider: "ollama", claudeAgentic: Boolean(raw.claudeAgentic) };
  return { provider: "gemini", claudeAgentic: Boolean(raw.claudeAgentic) };
}

function decryptUserKey(blob) {
  if (!blob || typeof blob !== "string") return "";
  try {
    return decryptSecret(blob).trim();
  } catch {
    return "";
  }
}

/**
 * Chei, modele, Ollama: întâi utilizator, apoi env.
 * @param {Record<string, unknown> | null | undefined} user
 */
export function resolveAiCredentials(user) {
  const userGemini = user && typeof user === "object" ? decryptUserKey(user.aiGeminiApiKeyEncrypted) : "";
  const userAnthropic = user && typeof user === "object" ? decryptUserKey(user.aiAnthropicApiKeyEncrypted) : "";
  const geminiKey = userGemini || process.env.GEMINI_API_KEY?.trim() || "";
  const anthropicKey = userAnthropic || process.env.ANTHROPIC_API_KEY?.trim() || "";
  const envGem = process.env.GEMINI_API_MODEL || process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const envCl = process.env.ANTHROPIC_MODEL || process.env.ANTHROPIC_API_MODEL || "claude-3-5-sonnet-20241022";
  const geminiModel =
    user && typeof user === "object" && String(user.aiGeminiModel || "").trim()
      ? String(user.aiGeminiModel).trim().slice(0, 128)
      : String(envGem).trim();
  const anthropicModel =
    user && typeof user === "object" && String(user.aiAnthropicModel || "").trim()
      ? String(user.aiAnthropicModel).trim().slice(0, 128)
      : String(envCl).trim();

  const envOllamaBase = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  const userOllamaBase =
    user && typeof user === "object" && String(user.aiOllamaBaseUrl || "").trim()
      ? String(user.aiOllamaBaseUrl).trim().slice(0, 512)
      : "";
  const ollamaBaseUrl =
    normalizeOllamaBaseUrl(userOllamaBase) ||
    normalizeOllamaBaseUrl(envOllamaBase) ||
    normalizeOllamaBaseUrl("http://127.0.0.1:11434") ||
    "";

  const envOllamaModel = process.env.OLLAMA_MODEL || "llama3.2";
  const ollamaModel =
    user && typeof user === "object" && String(user.aiOllamaModel || "").trim()
      ? String(user.aiOllamaModel).trim().slice(0, 128)
      : String(envOllamaModel).trim();

  const userOllamaKey = user && typeof user === "object" ? decryptUserKey(user.aiOllamaApiKeyEncrypted) : "";
  const ollamaApiKey = userOllamaKey || String(process.env.OLLAMA_API_KEY || "").trim();

  return {
    geminiKey,
    geminiModel,
    anthropicKey,
    anthropicModel,
    ollamaBaseUrl,
    ollamaModel,
    ollamaApiKey,
  };
}

/**
 * @param {Record<string, unknown> | null | undefined} user
 * @returns {{ provider: "gemini" | "claude" | "ollama", claudeAgentic: boolean, credentials: ReturnType<typeof resolveAiCredentials> }}
 */
export function buildAiRuntime(user) {
  return {
    ...prefsFromUser(user),
    credentials: resolveAiCredentials(user),
  };
}

/**
 * @param {Record<string, unknown> | null | undefined} user
 */
export function isAiProviderConfigured(user) {
  const p = prefsFromUser(user).provider;
  const c = resolveAiCredentials(user);
  if (p === "claude") return Boolean(c.anthropicKey);
  if (p === "ollama") return Boolean(c.ollamaBaseUrl && c.ollamaModel);
  return Boolean(c.geminiKey);
}

/** @param {"gemini" | "claude" | "ollama"} provider */
export function missingProviderKeyMessage(provider) {
  if (provider === "claude") {
    return "Nu există cheie Anthropic: completează în Setări (cheie proprie) sau setează ANTHROPIC_API_KEY pe server.";
  }
  if (provider === "ollama") {
    return "Ollama: setează URL de bază și model în Setări sau OLLAMA_BASE_URL + OLLAMA_MODEL pe server (modelul trebuie tras local: ollama pull …). Pentru Ollama Cloud / proxy cu Bearer, adaugă și cheia (Setări sau OLLAMA_API_KEY).";
  }
  return "Nu există cheie Gemini: completează în Setări (cheie proprie) sau setează GEMINI_API_KEY pe server.";
}

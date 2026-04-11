import { geminiGenerateText } from "@/lib/ai/gemini";
import { claudeGenerateText } from "@/lib/ai/claude";
import { ollamaGenerateText } from "@/lib/ai/ollama";

/**
 * @param {string} prompt
 * @param {{ jsonMode?: boolean, temperature?: number, maxOutputTokens?: number }} opts
 * @param {{
 *   provider?: "gemini" | "claude" | "ollama",
 *   claudeAgentic?: boolean,
 *   credentials?: {
 *     geminiKey: string,
 *     geminiModel: string,
 *     anthropicKey: string,
 *     anthropicModel: string,
 *     ollamaBaseUrl: string,
 *     ollamaModel: string,
 *   },
 * } | null | undefined} aiRuntime
 */
export async function generateAiText(prompt, opts = {}, aiRuntime) {
  const p = aiRuntime?.provider;
  const provider = p === "claude" ? "claude" : p === "ollama" ? "ollama" : "gemini";
  const creds = aiRuntime?.credentials || {
    geminiKey: "",
    geminiModel: "",
    anthropicKey: "",
    anthropicModel: "",
    ollamaBaseUrl: "",
    ollamaModel: "",
  };

  if (provider === "claude") {
    return claudeGenerateText(
      prompt,
      {
        ...opts,
        agentic: Boolean(aiRuntime?.claudeAgentic),
      },
      { apiKey: creds.anthropicKey, model: creds.anthropicModel }
    );
  }

  if (provider === "ollama") {
    return ollamaGenerateText(prompt, opts, {
      baseUrl: creds.ollamaBaseUrl,
      model: creds.ollamaModel,
    });
  }

  return geminiGenerateText(prompt, opts, { apiKey: creds.geminiKey, model: creds.geminiModel });
}

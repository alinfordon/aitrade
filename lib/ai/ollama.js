/**
 * Ollama HTTP API (local sau rețea), fără SDK.
 * @see https://github.com/ollama/ollama/blob/main/docs/api.md
 */

const DEFAULT_BASE = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "llama3.2";
const FETCH_TIMEOUT_MS = 120_000;

/**
 * @param {string} raw
 * @returns {string} URL normalizat sau "" dacă invalid
 */
export function normalizeOllamaBaseUrl(raw) {
  const s = String(raw || "")
    .trim()
    .replace(/\/+$/, "");
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) return "";
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return s;
  } catch {
    return "";
  }
}

/**
 * @param {string} prompt
 * @param {{ jsonMode?: boolean, temperature?: number, maxOutputTokens?: number }} opts
 * @param {{ baseUrl?: string, model?: string }} creds
 * @returns {Promise<string>}
 */
export async function ollamaGenerateText(prompt, opts = {}, creds = {}) {
  const baseRaw =
    typeof creds.baseUrl === "string" && creds.baseUrl.trim()
      ? creds.baseUrl.trim()
      : process.env.OLLAMA_BASE_URL || DEFAULT_BASE;
  const baseUrl = normalizeOllamaBaseUrl(baseRaw) || normalizeOllamaBaseUrl(DEFAULT_BASE);
  if (!baseUrl) {
    throw new Error("Ollama: URL de bază invalid (folosește http:// sau https://).");
  }

  const model =
    typeof creds.model === "string" && creds.model.trim()
      ? creds.model.trim()
      : String(process.env.OLLAMA_MODEL || DEFAULT_MODEL).trim();
  if (!model) {
    throw new Error("Ollama: numele modelului lipsește.");
  }

  const messages = [];
  if (opts.jsonMode) {
    messages.push({
      role: "system",
      content:
        "Răspunde DOAR cu JSON valid, fără blocuri markdown ```, fără text înainte sau după obiectul JSON.",
    });
  }
  messages.push({ role: "user", content: prompt });

  const numPredict = Math.min(Math.max(Number(opts.maxOutputTokens) || 4096, 256), 65536);
  const url = `${baseUrl}/api/chat`;
  const body = {
    model,
    messages,
    stream: false,
    options: {
      temperature: opts.temperature ?? 0.5,
      num_predict: numPredict,
    },
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let r;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "AbortError") {
      throw new Error(`Ollama: timeout după ${FETCH_TIMEOUT_MS / 1000}s la ${url}`);
    }
    throw new Error(`Ollama: rețea sau URL inaccesibil (${e instanceof Error ? e.message : String(e)})`);
  } finally {
    clearTimeout(timer);
  }

  const raw = await r.text();
  if (!r.ok) {
    let ollamaMsg = "";
    try {
      const ej = JSON.parse(raw);
      if (ej && typeof ej.error === "string") ollamaMsg = ej.error.trim();
    } catch {
      /* rămâne gol */
    }
    const detail = ollamaMsg || raw.slice(0, 400);

    if (r.status === 404 && /model.*not found|not found/i.test(detail)) {
      throw new Error(
        `Ollama: modelul «${model}» nu există pe acest server Ollama. ` +
          `Verifică numele exact cu «ollama list» sau instalează cu «ollama pull ${model}». ` +
          `Dacă pull eșuează, numele din bibliotecă poate fi altul (ex. qwen2.5:7b în loc de variante inexistente).`
      );
    }

    throw new Error(`Ollama API ${r.status}: ${detail.slice(0, 600)}`);
  }

  let j;
  try {
    j = JSON.parse(raw);
  } catch {
    throw new Error("Ollama: răspuns JSON invalid");
  }

  const text = j?.message?.content != null ? String(j.message.content) : "";
  if (!text.trim()) {
    throw new Error("Ollama: răspuns gol");
  }
  return text.trim();
}

/**
 * Apeluri Google Generative Language API (Gemini), fără SDK suplimentar.
 */

function getModelId() {
  const m = process.env.GEMINI_API_MODEL || process.env.GEMINI_MODEL || "gemini-2.0-flash";
  return String(m).trim();
}

function getApiKey() {
  const k = process.env.GEMINI_API_KEY;
  return k ? String(k).trim() : "";
}

/**
 * @param {string} prompt
 * @param {{ jsonMode?: boolean, temperature?: number, maxOutputTokens?: number }} opts
 * @param {{ apiKey?: string, model?: string }} creds — cheie/model din utilizator (BYOK); altfel env.
 * @returns {Promise<string>}
 */
export async function geminiGenerateText(prompt, opts = {}, creds = {}) {
  const key =
    typeof creds.apiKey === "string" && creds.apiKey.trim() ? creds.apiKey.trim() : getApiKey();
  if (!key) {
    throw new Error("GEMINI_API_KEY lipsește din variabilele de mediu.");
  }
  const model =
    typeof creds.model === "string" && creds.model.trim() ? creds.model.trim() : getModelId();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(key)}`;

  const generationConfig = {
    temperature: opts.temperature ?? 0.6,
    maxOutputTokens: opts.maxOutputTokens ?? 8192,
  };
  if (opts.jsonMode) {
    generationConfig.responseMimeType = "application/json";
  }

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig,
    }),
  });

  const raw = await r.text();
  if (!r.ok) {
    throw new Error(`Gemini API ${r.status}: ${raw.slice(0, 800)}`);
  }

  let j;
  try {
    j = JSON.parse(raw);
  } catch {
    throw new Error("Gemini: răspuns JSON invalid");
  }

  const block = j?.promptFeedback?.blockReason;
  if (block) {
    throw new Error(`Gemini: conținut blocat (${block})`);
  }

  const parts = j?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts) ? parts.map((p) => p.text || "").join("") : "";
  if (!text.trim()) {
    const finish = j?.candidates?.[0]?.finishReason;
    throw new Error(`Gemini: răspuns gol${finish ? ` (${finish})` : ""}`);
  }
  return text.trim();
}

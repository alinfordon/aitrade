/**
 * Anthropic Messages API (Claude), fără SDK — aceeași idee ca lib/ai/gemini.js.
 */

function getModelId() {
  const m = process.env.ANTHROPIC_MODEL || process.env.ANTHROPIC_API_MODEL || "claude-3-5-sonnet-20241022";
  return String(m).trim();
}

function getApiKey() {
  const k = process.env.ANTHROPIC_API_KEY;
  return k ? String(k).trim() : "";
}

/**
 * @param {string} prompt
 * @param {{ jsonMode?: boolean, temperature?: number, maxOutputTokens?: number, agentic?: boolean }} opts
 * `agentic`: instrucțiuni suplimentare pentru raționament înainte de răspuns (fără tool loop Anthropic).
 * @param {{ apiKey?: string, model?: string }} creds — BYOK; altfel env.
 * @returns {Promise<string>}
 */
export async function claudeGenerateText(prompt, opts = {}, creds = {}) {
  const key =
    typeof creds.apiKey === "string" && creds.apiKey.trim() ? creds.apiKey.trim() : getApiKey();
  if (!key) {
    throw new Error("ANTHROPIC_API_KEY lipsește din variabilele de mediu.");
  }
  const model =
    typeof creds.model === "string" && creds.model.trim() ? creds.model.trim() : getModelId();
  const temperature = opts.temperature ?? 0.6;
  const want = Number(opts.maxOutputTokens) || 8192;
  const maxTokens = Math.min(Math.max(want, 256), 16384);

  const systemParts = [];
  if (opts.jsonMode) {
    systemParts.push(
      "Răspunde DOAR cu JSON valid, fără blocuri markdown ```, fără text înainte sau după obiectul JSON."
    );
  }
  if (opts.agentic) {
    systemParts.push(
      "Mod agentic: analizează implicațiile și variantele înainte de concluzie; răspunsul final trebuie să respecte integral cerințele din mesajul utilizatorului (inclusiv format JSON dacă e cerut)."
    );
  }

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      ...(systemParts.length ? { system: systemParts.join("\n\n") } : {}),
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const raw = await r.text();
  if (!r.ok) {
    throw new Error(`Claude API ${r.status}: ${raw.slice(0, 800)}`);
  }

  let j;
  try {
    j = JSON.parse(raw);
  } catch {
    throw new Error("Claude: răspuns JSON invalid");
  }

  const blocks = j?.content;
  const text = Array.isArray(blocks)
    ? blocks
        .filter((b) => b && b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("")
    : "";
  if (!text.trim()) {
    const stop = j?.stop_reason;
    throw new Error(`Claude: răspuns gol${stop ? ` (${stop})` : ""}`);
  }
  return text.trim();
}

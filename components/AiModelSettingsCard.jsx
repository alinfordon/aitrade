"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

function normalizeProvider(p) {
  if (p === "claude") return "claude";
  if (p === "ollama") return "ollama";
  return "gemini";
}

export function AiModelSettingsCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [provider, setProvider] = useState("gemini");
  const [claudeAgentic, setClaudeAgentic] = useState(false);
  const [geminiModel, setGeminiModel] = useState("");
  const [anthropicModel, setAnthropicModel] = useState("");
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState("");
  const [ollamaModel, setOllamaModel] = useState("");
  const [geminiKeyInput, setGeminiKeyInput] = useState("");
  const [anthropicKeyInput, setAnthropicKeyInput] = useState("");
  const geminiKeyTouched = useRef(false);
  const anthropicKeyTouched = useRef(false);
  const [server, setServer] = useState({
    geminiConfigured: false,
    anthropicConfigured: false,
    ollamaEnvConfigured: false,
  });
  const [keyStatus, setKeyStatus] = useState({ hasUserGeminiKey: false, hasUserAnthropicKey: false });
  const [selectedOk, setSelectedOk] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/user/ai-settings");
      const j = await r.json();
      if (!r.ok) {
        throw new Error(typeof j.error === "string" ? j.error : "Eroare");
      }
      const s = j.settings || {};
      setProvider(normalizeProvider(s.provider));
      setClaudeAgentic(Boolean(s.claudeAgentic));
      setGeminiModel(String(s.geminiModel || ""));
      setAnthropicModel(String(s.anthropicModel || ""));
      setOllamaBaseUrl(String(s.ollamaBaseUrl || ""));
      setOllamaModel(String(s.ollamaModel || ""));
      setGeminiKeyInput("");
      setAnthropicKeyInput("");
      geminiKeyTouched.current = false;
      anthropicKeyTouched.current = false;
      setServer(
        j.server || {
          geminiConfigured: false,
          anthropicConfigured: false,
          ollamaEnvConfigured: false,
        }
      );
      setKeyStatus(j.keyStatus || { hasUserGeminiKey: false, hasUserAnthropicKey: false });
      setSelectedOk(Boolean(j.selectedProviderConfigured));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Setări AI");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        provider,
        claudeAgentic: provider === "claude" ? claudeAgentic : false,
        geminiModel: geminiModel.trim(),
        anthropicModel: anthropicModel.trim(),
        ollamaBaseUrl: ollamaBaseUrl.trim(),
        ollamaModel: ollamaModel.trim(),
      };
      if (geminiKeyTouched.current) {
        body.geminiApiKey = geminiKeyInput;
      }
      if (anthropicKeyTouched.current) {
        body.anthropicApiKey = anthropicKeyInput;
      }

      const r = await fetch("/api/user/ai-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error(typeof j.error === "string" ? j.error : "Salvare eșuată");
        return;
      }
      setServer(
        j.server || {
          geminiConfigured: false,
          anthropicConfigured: false,
          ollamaEnvConfigured: false,
        }
      );
      setKeyStatus(j.keyStatus || keyStatus);
      setSelectedOk(Boolean(j.selectedProviderConfigured));
      setGeminiKeyInput("");
      setAnthropicKeyInput("");
      geminiKeyTouched.current = false;
      anthropicKeyTouched.current = false;
      toast.success("Setări AI salvate");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Model AI & chei proprii (BYOK)</CardTitle>
        <CardDescription>
          Gemini / Anthropic cu chei criptate (AES-256-GCM, același{" "}
          <code className="rounded bg-muted px-1 text-xs">ENCRYPTION_KEY</code> ca la Binance).{" "}
          <strong className="font-medium text-foreground">Ollama</strong>: URL + model în clar; inferența rulează pe
          mașina/rețeaua unde e API-ul Ollama (de ex. <code className="rounded bg-muted px-1 text-xs">localhost:11434</code>
          ). Pe hosting public (ex. Vercel) trebuie URL Ollama accesibil din internet (VPN, tunnel, server dedicat).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Se încarcă…</p>
        ) : (
          <form className="max-w-lg space-y-5" onSubmit={save}>
            <div className="rounded-md border border-border/80 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              <p>
                Env server — Gemini: {server.geminiConfigured ? "da" : "nu"} · Anthropic:{" "}
                {server.anthropicConfigured ? "da" : "nu"} · Ollama (OLLAMA_*):{" "}
                {server.ollamaEnvConfigured ? "parțial/setat" : "nu"}
              </p>
              <p className="mt-1">
                Chei în cont — Gemini: {keyStatus.hasUserGeminiKey ? "salvată" : "—"} · Anthropic:{" "}
                {keyStatus.hasUserAnthropicKey ? "salvată" : "—"}
              </p>
              {!selectedOk && (
                <p className="mt-2 text-amber-600 dark:text-amber-400">
                  {provider === "ollama"
                    ? "Ollama: URL de bază (http/https) și numele modelului trebuie să fie valide, iar serviciul Ollama trebuie să răspundă de pe serverul aplicației."
                    : "Furnizorul selectat nu are cheie disponibilă (nici în cont, nici în env) — analizele vor eșua."}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Furnizor folosit la analize</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={provider}
                onChange={(e) => setProvider(normalizeProvider(e.target.value))}
              >
                <option value="gemini">Google Gemini</option>
                <option value="claude">Anthropic Claude</option>
                <option value="ollama">Ollama (local / propriu)</option>
              </select>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={claudeAgentic}
                disabled={provider !== "claude"}
                onChange={(e) => setClaudeAgentic(e.target.checked)}
                className="h-4 w-4 rounded border-input disabled:opacity-50"
              />
              Mod agentic Claude (raționament extins înainte de răspuns)
            </label>

            <div className="space-y-2 border-t border-border/60 pt-4">
              <p className="text-xs font-medium text-muted-foreground">Google Gemini</p>
              <div className="space-y-2">
                <Label>API key (opțional)</Label>
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder={keyStatus.hasUserGeminiKey ? "•••• lăsat gol la salvare = păstrezi cheia" : "sk-…"}
                  value={geminiKeyInput}
                  onChange={(e) => {
                    geminiKeyTouched.current = true;
                    setGeminiKeyInput(e.target.value);
                  }}
                />
                <p className="text-[11px] text-muted-foreground">
                  Pentru a șterge cheia salvată: golește câmpul și apasă Salvează (după ce ai modificat câmpul).
                </p>
              </div>
              <div className="space-y-2">
                <Label>ID model (opțional)</Label>
                <Input
                  value={geminiModel}
                  onChange={(e) => setGeminiModel(e.target.value)}
                  placeholder="ex. gemini-2.0-flash — gol = din env"
                  className="font-mono text-xs"
                />
              </div>
            </div>

            <div className="space-y-2 border-t border-border/60 pt-4">
              <p className="text-xs font-medium text-muted-foreground">Anthropic Claude</p>
              <div className="space-y-2">
                <Label>API key (opțional)</Label>
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder={keyStatus.hasUserAnthropicKey ? "•••• lăsat gol = păstrezi" : "sk-ant-…"}
                  value={anthropicKeyInput}
                  onChange={(e) => {
                    anthropicKeyTouched.current = true;
                    setAnthropicKeyInput(e.target.value);
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>ID model (opțional)</Label>
                <Input
                  value={anthropicModel}
                  onChange={(e) => setAnthropicModel(e.target.value)}
                  placeholder="ex. claude-3-5-sonnet-20241022 — gol = din env"
                  className="font-mono text-xs"
                />
              </div>
            </div>

            <div className="space-y-2 border-t border-border/60 pt-4">
              <p className="text-xs font-medium text-muted-foreground">Ollama</p>
              <div className="space-y-2">
                <Label>URL de bază API</Label>
                <Input
                  value={ollamaBaseUrl}
                  onChange={(e) => setOllamaBaseUrl(e.target.value)}
                  placeholder="http://127.0.0.1:11434 — gol = OLLAMA_BASE_URL sau implicit"
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-2">
                <Label>Model</Label>
                <Input
                  value={ollamaModel}
                  onChange={(e) => setOllamaModel(e.target.value)}
                  placeholder="ex. llama3.2 — gol = OLLAMA_MODEL sau llama3.2"
                  className="font-mono text-xs"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Asigură-te că modelul e tras: <code className="rounded bg-muted px-1">ollama pull &lt;nume&gt;</code>
              </p>
            </div>

            <Button type="submit" disabled={saving}>
              {saving ? "Se salvează…" : "Salvează"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { PageHeader } from "@/components/shell/PageHeader";
import "@/app/(shell)/discover/discover-dashboard.css";

function fmtPct(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = n.toFixed(2);
  return n >= 0 ? `+${s}%` : `${s}%`;
}

function fmtPrice(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  return n.toPrecision(4);
}

function fmtVol(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

const PROVIDER_LABEL = {
  gemini: "Gemini",
  claude: "Claude",
  ollama: "Ollama",
};

/** @param {{provider?: string, model?: string} | null | undefined} info */
function formatAiBadge(info) {
  const provider = info?.provider && PROVIDER_LABEL[info.provider] ? PROVIDER_LABEL[info.provider] : null;
  const model = typeof info?.model === "string" ? info.model.trim() : "";
  if (provider && model) return `${provider} · ${model}`;
  if (provider) return provider;
  if (model) return model;
  return "AI";
}

export default function DiscoverPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiPayload, setAiPayload] = useState(null);
  const [aiError, setAiError] = useState(null);
  /** Provider+model selectate în /settings, încărcate o dată la montare (actualizate după fiecare analiză). */
  const [aiInfo, setAiInfo] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/market/discover");
        const j = await r.json();
        if (!r.ok) {
          toast.error(j.error || "Nu s-au putut încărca datele");
          return;
        }
        setData(j);
        if (j.errors?.length) {
          toast.message(j.errors.join(" · "));
        }
      } catch {
        toast.error("Eroare rețea");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/user/ai-settings");
        if (!r.ok) return;
        const j = await r.json();
        const s = j?.settings;
        if (!s || cancelled) return;
        const model =
          s.provider === "claude"
            ? s.anthropicModel
            : s.provider === "ollama"
              ? s.ollamaModel
              : s.geminiModel;
        setAiInfo({ provider: s.provider, model: String(model || "") });
      } catch {
        /** Ignorăm: badge-ul cade pe fallback „AI”. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function runAiAnalyze() {
    setAiLoading(true);
    setAiError(null);
    try {
      const r = await fetch("/api/market/discover/analyze", { method: "POST" });
      const j = await r.json();
      if (!r.ok) {
        setAiPayload(null);
        setAiError(j.error || "Eroare analiză AI");
        if (r.status === 429 && j.retryAfterSec) {
          toast.error(`Limită cereri — încearcă în ~${j.retryAfterSec}s`);
        } else {
          toast.error(j.error || "Analiză indisponibilă");
        }
        return;
      }
      setAiPayload(j);
      if (j?.meta?.provider) {
        setAiInfo({ provider: j.meta.provider, model: String(j.meta.model || "") });
      }
      toast.success("Analiză AI generată");
    } catch {
      setAiError("Eroare rețea");
      toast.error("Eroare rețea");
    } finally {
      setAiLoading(false);
    }
  }

  const disc = data?.disclaimer;
  const analysis = aiPayload?.analysis;

  return (
    <div className="discover-dashboard space-y-8">
      <header className="discover-hero">
        <div className="discover-hero-inner">
          <PageHeader
            title="Descoperă piața"
            description="Creșteri spot Binance (USDC), tendințe CoinGecko și analiză AI educativă — toate într-un singur loc."
          />
        </div>
      </header>

      <Card className="discover-ai-card">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <span>Analiză AI</span>
              <Badge
                variant="outline"
                className="border-sky-400/40 font-mono text-[10px] font-normal text-sky-200"
                title={
                  aiInfo?.provider
                    ? `Provider: ${PROVIDER_LABEL[aiInfo.provider] || aiInfo.provider}${
                        aiInfo?.model ? ` · Model: ${aiInfo.model}` : ""
                      }`
                    : "Configurează providerul AI în Setări"
                }
              >
                {formatAiBadge(aiInfo)}
              </Badge>
            </CardTitle>
            <CardDescription>
              Sinteză educativă: tendință de piață, limitări analiză tehnică din datele disponibile, riscuri și
              idei de urmărit — nu înlocuiește consiliere financiară.
            </CardDescription>
          </div>
          <Button type="button" onClick={() => runAiAnalyze()} disabled={aiLoading}>
            {aiLoading ? "Generează…" : "Generează analiza"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {aiError && <p className="text-sm text-destructive">{aiError}</p>}
          {!analysis && !aiError && !aiLoading && (
            <p className="text-sm text-muted-foreground">
              Folosește butonul pentru o analiză nouă pe baza listelor de mai jos (date reîmprospătate la cerere).
            </p>
          )}
          {analysis && (
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">Tendință generală:</span>
                <Badge variant="outline" className="font-normal capitalize">
                  {analysis.tendintaGenerala || "—"}
                </Badge>
                {aiPayload?.meta?.generatedAt && (
                  <span className="text-xs text-muted-foreground">
                    generat {new Date(aiPayload.meta.generatedAt).toLocaleString("ro-RO")}
                  </span>
                )}
              </div>
              {analysis.rezumatPiata && (
                <div>
                  <div className="mb-1 font-medium text-foreground">Rezumat piață</div>
                  <p className="leading-relaxed text-muted-foreground">{analysis.rezumatPiata}</p>
                </div>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                {analysis.analizaTehnica && (
                  <div className="rounded-lg border border-border/80 bg-background/60 p-3">
                    <div className="mb-1.5 text-sm font-medium">Analiză tehnică (din date limitate)</div>
                    <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                      {analysis.analizaTehnica}
                    </p>
                  </div>
                )}
                {analysis.analizaFinanciara && (
                  <div className="rounded-lg border border-border/80 bg-background/60 p-3">
                    <div className="mb-1.5 text-sm font-medium">Analiză financiară / risc</div>
                    <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                      {analysis.analizaFinanciara}
                    </p>
                  </div>
                )}
              </div>
              {Array.isArray(analysis.recomandari) && analysis.recomandari.length > 0 && (
                <div>
                  <div className="mb-2 font-medium">Recomandări orientative</div>
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="discover-row-hover w-full text-left text-sm">
                      <thead className="bg-muted/60 text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2">Simbol</th>
                          <th className="px-3 py-2">Pereche</th>
                          <th className="px-3 py-2">Acțiune</th>
                          <th className="px-3 py-2">Orizont</th>
                          <th className="px-3 py-2">Risc</th>
                          <th className="px-3 py-2">Motiv</th>
                          <th className="px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {analysis.recomandari.map((rec, idx) => {
                          const pair =
                            rec.pereche || (rec.simbol ? `${String(rec.simbol).toUpperCase()}/USDC` : null);
                          const act = String(rec.actiune || "").toLowerCase();
                          return (
                            <tr key={idx} className="border-t border-border/60">
                              <td className="px-3 py-2 font-medium">{rec.simbol || "—"}</td>
                              <td className="px-3 py-2 font-mono text-xs">{rec.pereche || "—"}</td>
                              <td className="px-3 py-2">
                                <Badge
                                  variant="outline"
                                  className={
                                    act.includes("evit")
                                      ? "border-red-500/50 text-red-700 dark:text-red-400"
                                      : act.includes("cumpar")
                                        ? "border-emerald-500/50 text-emerald-700 dark:text-emerald-400"
                                        : "font-normal"
                                  }
                                >
                                  {rec.actiune || "—"}
                                </Badge>
                              </td>
                              <td className="px-3 py-2">{rec.horizon || "—"}</td>
                              <td className="px-3 py-2">{rec.risc || "—"}</td>
                              <td className="max-w-[240px] px-3 py-2 text-muted-foreground">
                                {rec.motiv || "—"}
                              </td>
                              <td className="px-2 py-2">
                                {pair && pair.includes("/") ? (
                                  <Button variant="ghost" size="sm" className="h-8" asChild>
                                    <Link href={`/trading?pair=${encodeURIComponent(pair)}&from=discover`}>
                                      Trading
                                    </Link>
                                  </Button>
                                ) : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {Array.isArray(analysis.avertismente) && analysis.avertismente.length > 0 && (
                <ul className="list-inside list-disc space-y-1 text-amber-800 dark:text-amber-200/90">
                  {analysis.avertismente.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="discover-card-shell">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <span>În creștere (24h)</span>
              {!loading && (
                <Badge variant="secondary" className="font-normal">
                  {data?.gainers?.length ?? 0}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>{disc?.gainers}</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Se încarcă…</p>
            ) : (
              <div className="max-h-[520px] overflow-auto rounded-md border border-border/70">
                <table className="discover-row-hover w-full text-left text-sm">
                  <thead className="sticky top-0 bg-muted/70 backdrop-blur">
                    <tr className="text-muted-foreground">
                      <th className="px-3 py-2">Pereche</th>
                      <th className="px-3 py-2">Preț</th>
                      <th className="px-3 py-2">24h</th>
                      <th className="px-3 py-2">Vol USDC</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.gainers || []).length ? (
                      data.gainers.map((row) => (
                        <tr key={row.symbol} className="border-t border-border/60">
                          <td className="px-3 py-1.5 font-medium">{row.pair}</td>
                          <td className="px-3 py-1.5 font-mono">{fmtPrice(row.lastPrice)}</td>
                          <td
                            className={`px-3 py-1.5 font-mono ${
                              row.pct24h >= 0
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-red-600 dark:text-red-400"
                            }`}
                          >
                            {fmtPct(row.pct24h)}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-muted-foreground">
                            {fmtVol(row.quoteVolume)}
                          </td>
                          <td className="px-2 py-1.5">
                            <Button variant="ghost" size="sm" className="h-8 px-2" asChild>
                              <Link href={`/trading?pair=${encodeURIComponent(row.pair)}&from=discover`}>
                                Trading
                              </Link>
                            </Button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                          Nu sunt date. Verifică conexiunea sau mesajul de mai sus.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="discover-card-shell">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <span>În tendință & proiecte căutate</span>
              {!loading && (
                <Badge variant="secondary" className="font-normal">
                  {data?.trending?.length ?? 0}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>{disc?.trending}</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Se încarcă…</p>
            ) : (
              <div className="max-h-[520px] space-y-2 overflow-auto pr-1">
                {(data?.trending || []).length ? (
                  data.trending.map((c) => {
                    const spotPair = c.spotPair || null;
                    return (
                      <div
                        key={c.id}
                        className="flex items-center gap-3 rounded-lg border border-border/70 bg-card/40 px-3 py-2 transition-colors hover:border-sky-500/25 hover:bg-card/60"
                      >
                        {c.thumb ? (
                          <Image
                            src={c.thumb}
                            alt=""
                            width={36}
                            height={36}
                            className="h-9 w-9 rounded-full"
                            unoptimized
                          />
                        ) : (
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-xs">
                            ?
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{c.name}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {c.symbol}
                            {c.marketCapRank != null ? ` · rank #${c.marketCapRank}` : ""}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          {c.priceUsd != null && (
                            <div className="font-mono text-sm">${fmtPrice(c.priceUsd)}</div>
                          )}
                          {c.pct24hUsd != null && (
                            <div
                              className={
                                c.pct24hUsd >= 0
                                  ? "font-mono text-xs text-emerald-600 dark:text-emerald-400"
                                  : "font-mono text-xs text-red-600 dark:text-red-400"
                              }
                            >
                              {fmtPct(c.pct24hUsd)}
                            </div>
                          )}
                        </div>
                        {spotPair ? (
                          <Button variant="outline" size="sm" className="shrink-0" asChild>
                            <Link href={`/trading?pair=${encodeURIComponent(spotPair)}&from=discover`}>
                              Încearcă
                            </Link>
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            disabled
                            title="Nu există pereche USDC pe Binance Spot pentru acest simbol"
                          >
                            Spot n/a
                          </Button>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Nu s-au putut încărca tendințele CoinGecko.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        Nu este sfat financiar. Criptomonedele sunt volatile; tendințele CoinGecko reflectă interesul pieței, nu
        garanții de preț.
      </p>
    </div>
  );
}

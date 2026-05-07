"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSpotWallet } from "@/components/SpotWalletProvider";
import { BinanceConnectionBadge } from "@/components/BinanceConnectionBadge";
import { pickDustCandidatesForUsdc } from "@/lib/wallet/dust-usdc";
import { AlertCircle, ArrowRightLeft, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const DEFAULT_MAX_USD = 1;

function summarizeResponse(j) {
  const s = j.summary || {};
  const sold = Number(s.sold) || 0;
  const failed = Number(s.failed) || 0;
  return { sold, failed };
}

/**
 * Vinde la piață, pe Binance Spot, disponibilul fiecărui activ cu valoare estimată
 * sub `DEFAULT_MAX_USD` într-o pereche `BASE/USDC`.
 *
 * @param {{ className?: string; maxUsd?: number }} [props]
 */
export function ConvertDustToUsdcCard({ className, maxUsd = DEFAULT_MAX_USD } = {}) {
  const { wallet, loadWallet } = useSpotWallet();
  /** „all” = bulk; altfel simbol monedă */
  const [busyKey, setBusyKey] = useState(null);
  const [banner, setBanner] = useState({ kind: "idle", message: "" });
  const dismissTimerRef = useRef(null);

  const cap = Number.isFinite(Number(maxUsd)) && Number(maxUsd) > 0 ? Number(maxUsd) : DEFAULT_MAX_USD;

  const candidates = useMemo(() => {
    if (!wallet?.real?.connected || !Array.isArray(wallet.real.balances)) return [];
    return pickDustCandidatesForUsdc(wallet.real.balances, { maxUsd: cap, skipBnb: true });
  }, [wallet?.real?.connected, wallet?.real?.balances, cap]);

  const hasKeys = wallet?.hasApiKeys;
  const err = wallet?.real?.error;

  function clearDismissTimer() {
    if (dismissTimerRef.current != null) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }

  function scheduleBannerDismiss() {
    clearDismissTimer();
    dismissTimerRef.current = window.setTimeout(() => {
      setBanner({ kind: "idle", message: "" });
      dismissTimerRef.current = null;
    }, 5200);
  }

  useEffect(() => () => clearDismissTimer(), []);

  async function refreshWallet() {
    await loadWallet({ silent: true, force: true });
  }

  async function convertOne(currency) {
    clearDismissTimer();
    setBanner({
      kind: "loading",
      message: `Se convertește ${currency} în USDC…`,
    });
    setBusyKey(currency);
    try {
      const r = await fetch("/api/wallet/convert-dust-usdc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxUsd: cap, includeBnb: false, currency }),
      });
      const j = await r.json();
      if (!r.ok) {
        setBanner({
          kind: "error",
          message: typeof j.error === "string" ? j.error : "Conversie eșuată.",
        });
        scheduleBannerDismiss();
        return;
      }
      const { sold, failed } = summarizeResponse(j);
      const row = Array.isArray(j.results) ? j.results.find((x) => x.currency === currency) : null;
      if (sold > 0 && row?.ok) {
        setBanner({
          kind: "success",
          message: `${currency} a fost convertit în USDC (Binance Convert).`,
        });
      } else if (failed > 0 && row && !row.ok) {
        setBanner({
          kind: "error",
          message:
            typeof row.error === "string" ? `${currency}: ${row.error}` : `Eșec la conversia ${currency}.`,
        });
      } else {
        setBanner({
          kind: "error",
          message: "Răspuns neașteptat — verifică soldul pe Binance.",
        });
      }
      scheduleBannerDismiss();
      await refreshWallet();
    } catch {
      setBanner({ kind: "error", message: "Eroare de rețea. Încearcă din nou." });
      scheduleBannerDismiss();
    } finally {
      setBusyKey(null);
    }
  }

  async function convertAll() {
    if (!candidates.length) return;
    clearDismissTimer();
    setBanner({
      kind: "loading",
      message: `Se convertește praf în USDC (${candidates.length} monede)…`,
    });
    setBusyKey("all");
    try {
      const r = await fetch("/api/wallet/convert-dust-usdc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxUsd: cap, includeBnb: false }),
      });
      const j = await r.json();
      if (!r.ok) {
        setBanner({
          kind: "error",
          message: typeof j.error === "string" ? j.error : "Conversie eșuată.",
        });
        scheduleBannerDismiss();
        return;
      }
      const { sold, failed } = summarizeResponse(j);
      if (sold > 0) {
        setBanner({
          kind: "success",
          message:
            failed > 0
              ? `${sold} monedă(i) convertite în USDC (Binance Convert). ${failed} au eșuat — verifică dacă moneda e suportată în Convert și drepturile cheii API.`
              : `${sold} monedă(i) convertite în USDC (Binance Convert).`,
        });
      } else if (failed > 0) {
        setBanner({
          kind: "error",
          message:
            "Nicio conversie reușită — moneda poate lipsi din Binance Convert sau cheia API nu are permisiunea Convert.",
        });
      } else {
        setBanner({ kind: "success", message: "Nimic de convertit în această rulare." });
      }
      scheduleBannerDismiss();
      await refreshWallet();
    } catch {
      setBanner({ kind: "error", message: "Eroare de rețea. Încearcă din nou." });
      scheduleBannerDismiss();
    } finally {
      setBusyKey(null);
    }
  }

  const bulkBusy = busyKey === "all";
  const anyBusy = busyKey != null;

  return (
    <Card className={cn("border-white/[0.08] bg-card/50 backdrop-blur-md", className)}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 font-display text-base">
              <ArrowRightLeft className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden />
              Praf în USDC
            </CardTitle>
            <CardDescription className="text-xs leading-relaxed">
              Folosește API-ul Binance <span className="font-medium text-foreground">Convert</span> (ofertă + acceptare),
              nu Spot MARKET — util pentru sume sub minimul NOTIONAL al perechilor Spot. Necesită drepturi API care permit
              Convert pe cheia ta. Listă sortată după valoare estimată (mare → mic). USDC și BNB (implicit) sunt oprite.
            </CardDescription>
          </div>
          <BinanceConnectionBadge wallet={wallet} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          aria-live="polite"
          className={cn(
            "transition-[max-height,opacity,margin] duration-300 ease-out",
            banner.kind === "idle" ? "pointer-events-none max-h-0 opacity-0" : "max-h-48 opacity-100"
          )}
        >
          {banner.kind !== "idle" ? (
            <div
              className={cn(
                "animate-in fade-in slide-in-from-top-2 rounded-lg border px-3 py-2.5 duration-300",
                banner.kind === "loading" &&
                  "border-primary/40 bg-gradient-to-b from-primary/[0.12] to-transparent text-foreground shadow-sm",
                banner.kind === "success" &&
                  "border-emerald-500/45 bg-emerald-500/[0.09] text-emerald-100 shadow-sm",
                banner.kind === "error" && "border-red-500/45 bg-red-500/[0.08] text-red-100 shadow-sm"
              )}
            >
              <div className="flex items-start gap-2">
                {banner.kind === "loading" ? (
                  <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
                ) : banner.kind === "success" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
                ) : (
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
                )}
                <p className="text-xs leading-relaxed">{banner.message}</p>
              </div>
              {banner.kind === "loading" ? (
                <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-muted/70">
                  <div className="dust-slide-bar h-full w-[38%] rounded-full bg-primary" />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {err ? <p className="text-sm text-destructive">{err}</p> : null}
        {!hasKeys ? (
          <p className="text-sm text-muted-foreground">Adaugă chei API în Settings.</p>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nu ai activ cu liber estimat sub {cap} USDC (sau doar BNB / USDC).
          </p>
        ) : (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {candidates.length} monede eligibile (mare → mic)
            </p>
            <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border/60 bg-muted/20 px-2 py-1.5 text-xs">
              {candidates.map((c) => {
                const rowBusy = busyKey === c.currency;
                return (
                  <li
                    key={c.currency}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 py-1 font-mono tabular-nums last:border-0"
                  >
                    <span className="min-w-[3rem] text-foreground">{c.currency}</span>
                    <span className="flex-1 text-right text-muted-foreground sm:text-left">
                      ≈ {Number(c.freeUsdEstimate).toFixed(4)} USD
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 px-2 text-[10px]"
                      disabled={anyBusy}
                      aria-busy={rowBusy}
                      onClick={() => void convertOne(c.currency)}
                    >
                      {rowBusy ? (
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                      ) : (
                        "Convert"
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={anyBusy}
              className="w-full sm:w-auto"
              onClick={() => void convertAll()}
            >
              {bulkBusy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  Se execută…
                </>
              ) : (
                `Convertește tot praf sub ${cap} USDC (Convert)`
              )}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

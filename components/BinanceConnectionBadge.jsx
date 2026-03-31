"use client";

import { Badge } from "@/components/ui/badge";

export function BinanceConnectionBadge({ wallet }) {
  if (!wallet) {
    return (
      <Badge variant="outline" className="font-normal">
        Se încarcă…
      </Badge>
    );
  }
  const { hasApiKeys, real } = wallet;
  if (!hasApiKeys) {
    return (
      <Badge variant="secondary" className="font-normal">
        Fără chei API
      </Badge>
    );
  }
  if (real?.error) {
    return (
      <Badge variant="outline" className="border-destructive/60 bg-destructive/10 font-normal text-destructive">
        Eroare API Binance
      </Badge>
    );
  }
  if (real?.connected) {
    return (
      <Badge
        variant="outline"
        className="border-emerald-500/60 bg-emerald-600/10 font-normal text-emerald-700 dark:text-emerald-400"
      >
        Conectat la Binance
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="font-normal">
      Neconectat
    </Badge>
  );
}

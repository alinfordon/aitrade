"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

const SpotWalletContext = createContext(null);

/**
 * O singură încărcare /api/wallet/spot pentru tot shell-ul (nav + pagini).
 */
export function SpotWalletProvider({ children }) {
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);

  /** @param {{ silent?: boolean }} [opts] - `silent: true` după tranzacții: fără stare globală „loading” (evită clipirea nav-ului). */
  const loadWallet = useCallback(async (opts) => {
    const silent = Boolean(opts?.silent);
    if (!silent) setLoading(true);
    try {
      const r = await fetch("/api/wallet/spot");
      const j = await r.json();
      if (!r.ok) {
        setWallet(null);
        return;
      }
      setWallet(j);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWallet().catch(() => {});
  }, [loadWallet]);

  const value = { wallet, loading, loadWallet };
  return <SpotWalletContext.Provider value={value}>{children}</SpotWalletContext.Provider>;
}

export function useSpotWallet() {
  const ctx = useContext(SpotWalletContext);
  if (!ctx) {
    throw new Error("useSpotWallet must be used within SpotWalletProvider");
  }
  return ctx;
}

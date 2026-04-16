"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

const SpotWalletContext = createContext(null);
const REFRESH_THROTTLE_MS = 5_000;

/**
 * O singură încărcare /api/wallet/spot pentru tot shell-ul (nav + pagini).
 */
export function SpotWalletProvider({ children }) {
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const inflightRef = useRef(null);
  const lastCompletedAtRef = useRef(0);

  /** @param {{ silent?: boolean, force?: boolean }} [opts] - `silent: true` după tranzacții: fără stare globală „loading” (evită clipirea nav-ului). */
  const loadWallet = useCallback(async (opts) => {
    const silent = Boolean(opts?.silent);
    const force = Boolean(opts?.force);
    const now = Date.now();

    if (inflightRef.current) return inflightRef.current;
    if (!force && lastCompletedAtRef.current > 0 && now - lastCompletedAtRef.current < REFRESH_THROTTLE_MS) {
      return;
    }

    const run = (async () => {
      setSyncing(true);
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
        lastCompletedAtRef.current = Date.now();
        inflightRef.current = null;
        setSyncing(false);
        if (!silent) setLoading(false);
      }
    })();

    inflightRef.current = run;
    return run;
  }, []);

  useEffect(() => {
    loadWallet().catch(() => {});
  }, [loadWallet]);

  const value = { wallet, loading, syncing, loadWallet };
  return <SpotWalletContext.Provider value={value}>{children}</SpotWalletContext.Provider>;
}

export function useSpotWallet() {
  const ctx = useContext(SpotWalletContext);
  if (!ctx) {
    throw new Error("useSpotWallet must be used within SpotWalletProvider");
  }
  return ctx;
}

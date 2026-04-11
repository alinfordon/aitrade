"use client";

import { useMemo, useSyncExternalStore } from "react";

const LS_KEY = "aitrade:livePositions:v1";
const STRUCT_POLL_MS = 45_000;
const MARK_FRESH_MS = 3 * 60 * 1000;

function emptyStore() {
  return {
    manual: [],
    bots: [],
    structureFp: "",
    lastFullAt: 0,
    loading: false,
    error: null,
  };
}

let store = emptyStore();
let version = 0;
const listeners = new Set();
let started = false;
let tickRunning = false;
let inflightFull = null;

function notify() {
  version++;
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot() {
  return version;
}

function getServerSnapshot() {
  return 0;
}

function hydrateFromLS() {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (p?.v !== 1 || !Array.isArray(p.manual)) return;
    store = {
      ...store,
      manual: p.manual,
      bots: Array.isArray(p.bots) ? p.bots : [],
      structureFp: typeof p.structureFp === "string" ? p.structureFp : "",
      lastFullAt: Number(p.lastFullAt) || 0,
      loading: false,
      error: null,
    };
  } catch {
    /* ignore */
  }
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        v: 1,
        manual: store.manual,
        bots: store.bots,
        structureFp: store.structureFp,
        lastFullAt: store.lastFullAt,
      })
    );
  } catch {
    /* quota / private mode */
  }
}

async function fetchFullPositions() {
  if (inflightFull) return inflightFull;
  inflightFull = (async () => {
    store = { ...store, loading: true, error: null };
    notify();
    try {
      const r = await fetch("/api/live/positions");
      const j = await r.json();
      if (!r.ok) {
        throw new Error(typeof j.error === "string" ? j.error : "Poziții");
      }
      store = {
        ...store,
        manual: Array.isArray(j.manual) ? j.manual : [],
        bots: Array.isArray(j.bots) ? j.bots : [],
        structureFp: typeof j.structureFp === "string" ? j.structureFp : "",
        lastFullAt: Date.now(),
        loading: false,
        error: null,
      };
      persist();
      notify();
    } catch (e) {
      store = {
        ...store,
        loading: false,
        error: e instanceof Error ? e.message : "Eroare poziții",
      };
      notify();
    } finally {
      inflightFull = null;
    }
  })();
  return inflightFull;
}

async function pollStructure() {
  try {
    const r = await fetch("/api/live/positions?structure=1");
    const j = await r.json();
    if (!r.ok) {
      await fetchFullPositions();
      return;
    }
    const fp = typeof j.structureFp === "string" ? j.structureFp : "";
    const age = Date.now() - (store.lastFullAt || 0);
    const marksStale = age > MARK_FRESH_MS;
    const structureChanged = fp && fp !== store.structureFp;
    const neverFull = !store.lastFullAt;
    if (structureChanged || marksStale || neverFull) {
      await fetchFullPositions();
    }
  } catch {
    await fetchFullPositions();
  }
}

async function tick() {
  if (tickRunning) return;
  tickRunning = true;
  try {
    await pollStructure();
  } finally {
    tickRunning = false;
  }
}

export function ensureLivePositionsPolling() {
  if (typeof window === "undefined") return;
  if (started) return;
  started = true;
  hydrateFromLS();
  notify();
  void (async () => {
    await tick();
  })();
  setInterval(() => void tick(), STRUCT_POLL_MS);
}

/**
 * Sincronizează cache-ul după un GET complet (ex. pagina Live).
 * @param {{ manual?: unknown[]; bots?: unknown[]; structureFp?: string }} j
 */
export function mergeLivePositionsFromApi(j) {
  if (!j || !Array.isArray(j.manual)) return;
  store = {
    ...store,
    manual: j.manual,
    bots: Array.isArray(j.bots) ? j.bots : [],
    structureFp: typeof j.structureFp === "string" ? j.structureFp : store.structureFp,
    lastFullAt: Date.now(),
    loading: false,
    error: null,
  };
  persist();
  notify();
}

export function clearLivePositionsCache() {
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      /* */
    }
  }
  store = emptyStore();
  notify();
}

/**
 * Reîncarcă forțat de la server (după acțiuni care schimbă pozițiile).
 */
export function refreshLivePositionsFromServer() {
  return fetchFullPositions();
}

export function useLivePositions() {
  const v = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(
    () => ({
      manual: store.manual,
      bots: store.bots,
      structureFp: store.structureFp,
      lastFullAt: store.lastFullAt,
      loading: store.loading,
      error: store.error,
      version: v,
    }),
    [v]
  );
}

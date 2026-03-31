import { ema } from "@/lib/indicators/ema";
import { sma } from "@/lib/indicators/sma";
import { bollinger } from "@/lib/indicators/bollinger";

const PALETTE = ["#a78bfa", "#fbbf24", "#22d3ee", "#f472b6", "#fb923c", "#4ade80"];

/** @param {unknown} definition */
export function rulesFromStrategyDefinition(definition) {
  if (!definition || typeof definition !== "object") return [];
  const entry = Array.isArray(definition.entry) ? definition.entry : [];
  const exit = Array.isArray(definition.exit) ? definition.exit : [];
  return [...entry, ...exit];
}

/**
 * Specificații linii de preț derivate din regulile strategiei (intrare + ieșire).
 * @param {unknown[]} rules
 */
export function buildStrategyOverlaySpecs(rules) {
  const seen = new Set();
  const specs = [];
  let ci = 0;
  const nextColor = () => PALETTE[ci++ % PALETTE.length];

  for (const rule of rules) {
    if (!rule || typeof rule !== "object") continue;
    const ind = String(rule.indicator || "").toUpperCase();

    if (ind === "EMA") {
      const period = Math.max(1, Math.floor(Number(rule.period ?? 14)));
      const key = `ema:${period}`;
      if (seen.has(key)) continue;
      seen.add(key);
      specs.push({ key, kind: "ema", period, color: nextColor(), title: `EMA ${period}` });
    } else if (ind === "SMA") {
      const period = Math.max(1, Math.floor(Number(rule.period ?? 20)));
      const key = `sma:${period}`;
      if (seen.has(key)) continue;
      seen.add(key);
      specs.push({ kind: "sma", period, color: nextColor(), title: `SMA ${period}` });
    } else if (ind === "EMA_CROSS") {
      const fast = Math.max(1, Math.floor(Number(rule.fast ?? 9)));
      const slow = Math.max(1, Math.floor(Number(rule.slow ?? 21)));
      const kf = `ema:${fast}`;
      const ks = `ema:${slow}`;
      if (!seen.has(kf)) {
        seen.add(kf);
        specs.push({ kind: "ema", period: fast, color: nextColor(), title: `EMA ${fast}` });
      }
      if (!seen.has(ks)) {
        seen.add(ks);
        specs.push({ kind: "ema", period: slow, color: nextColor(), title: `EMA ${slow}` });
      }
    } else if (ind === "BB" || ind === "BOLLINGER") {
      const period = Math.max(2, Math.floor(Number(rule.period ?? 20)));
      const mult = Number.isFinite(Number(rule.mult)) ? Number(rule.mult) : 2;
      const key = `bb:${period}:${mult}`;
      if (seen.has(key)) continue;
      seen.add(key);
      specs.push({
        kind: "bb",
        period,
        mult,
        color: nextColor(),
        title: `Bollinger ${period}`,
      });
    }
  }
  return specs;
}

/** @param {Array<{ time: unknown, close: number }>} candleRows */
export function candleRowsToClosesAndTimes(candleRows) {
  const closes = [];
  const times = [];
  for (const r of candleRows) {
    closes.push(Number(r.close));
    const t = r.time;
    times.push(typeof t === "number" ? t : Number(t));
  }
  return { closes, times };
}

export function zipTimeValueLineData(times, values) {
  const out = [];
  for (let i = 0; i < times.length; i++) {
    const v = values[i];
    if (v != null && Number.isFinite(v)) out.push({ time: times[i], value: v });
  }
  return out;
}

/**
 * @param {ReturnType<typeof buildStrategyOverlaySpecs>[number]} spec
 * @param {number[]} closes
 * @param {number[]} times
 * @returns {{ title: string, color: string, lineStyle?: number, data: { time: number, value: number }[] }[]}
 */
export function lineChunksForSpec(spec, closes, times) {
  if (spec.kind === "ema") {
    const arr = ema(closes, spec.period);
    return [{ title: spec.title, color: spec.color, data: zipTimeValueLineData(times, arr) }];
  }
  if (spec.kind === "sma") {
    const arr = sma(closes, spec.period);
    return [{ title: spec.title, color: spec.color, data: zipTimeValueLineData(times, arr) }];
  }
  if (spec.kind === "bb") {
    const { upper, middle, lower } = bollinger(closes, spec.period, spec.mult);
    const c = spec.color;
    return [
      {
        title: `${spec.title} · sus`,
        color: c,
        lineStyle: 2,
        data: zipTimeValueLineData(times, upper),
      },
      {
        title: `${spec.title} · mijloc`,
        color: c,
        lineStyle: 0,
        data: zipTimeValueLineData(times, middle),
      },
      {
        title: `${spec.title} · jos`,
        color: c,
        lineStyle: 2,
        data: zipTimeValueLineData(times, lower),
      },
    ];
  }
  return [];
}

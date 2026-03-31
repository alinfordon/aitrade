import { runBacktest } from "@/server/backtest/engine";
import crypto from "crypto";

function scoreResult(r) {
  const profit = r.totalProfit;
  const win = r.winRate;
  const dd = r.maxDrawdown;
  return profit * 0.6 + win * 0.2 - dd * 0.5;
}

function randomInt(min, maxInclusive) {
  return crypto.randomInt(min, maxInclusive + 1);
}

function cloneStrategy(base) {
  return JSON.parse(JSON.stringify(base));
}

/**
 * Mutate RSI thresholds, EMA lengths, SL/TP hints in strategy JSON (embedded in riskMeta on result only).
 * Generates `count` variations (50–200).
 */
export function generateVariations(baseDefinition, count = 80) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const def = cloneStrategy(baseDefinition);
    const rsiLow = randomInt(20, 40);
    const rsiHigh = randomInt(60, 80);
    if (Array.isArray(def.entry)) {
      def.entry = def.entry.map((r) => {
        if (String(r.indicator).toUpperCase() === "RSI" && r.operator === "<") {
          return { ...r, value: rsiLow };
        }
        return { ...r };
      });
    }
    if (Array.isArray(def.exit)) {
      def.exit = def.exit.map((r) => {
        if (String(r.indicator).toUpperCase() === "RSI" && r.operator === ">") {
          return { ...r, value: rsiHigh };
        }
        return { ...r };
      });
    }
    if (Array.isArray(def.entry)) {
      def.entry = def.entry.map((r) => {
        if (String(r.indicator).toUpperCase() === "EMA_CROSS") {
          const fast = randomInt(8, 21);
          const slow = randomInt(fast + 5, Math.min(200, fast + 100));
          return { ...r, fast, slow, value: r.value || "BULLISH" };
        }
        return { ...r };
      });
    }

    const stopLossPct = randomInt(1, 8) + Math.random();
    const takeProfitPct = randomInt(2, 12) + Math.random();
    const positionSizePct = randomInt(5, 25) / 100;

    out.push({
      definition: def,
      riskMeta: { stopLossPct, takeProfitPct, positionSizePct: positionSizePct * 100 },
    });
  }
  return out;
}

/**
 * Backtest each variation on provided series; return sorted by score.
 */
export function optimizeOnSeries(baseDefinition, series, options = {}) {
  const count = Math.min(200, Math.max(50, options.count ?? 80));
  const vars = generateVariations(baseDefinition, count);
  const results = [];

  for (const v of vars) {
    const bt = runBacktest(series, v.definition, {
      positionPct: (v.riskMeta.positionSizePct ?? 10) / 100,
    });
    const sc = scoreResult(bt);
    results.push({
      score: sc,
      backtest: bt,
      definition: v.definition,
      riskMeta: v.riskMeta,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

export { scoreResult };

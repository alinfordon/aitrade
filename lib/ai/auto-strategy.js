import crypto from "crypto";
import { DEFAULT_SPOT_PAIR } from "@/lib/market-defaults";

/**
 * Rule-based "AI Auto Bot" generator (no external LLM; deploy-safe on Vercel).
 * Produces a conservative starter strategy JSON from pair + risk posture.
 */
export function generateAutoStrategy({ pair = DEFAULT_SPOT_PAIR, safeMode = false } = {}) {
  const rsiLow = safeMode ? 32 : 25 + crypto.randomInt(0, 11);
  const rsiHigh = safeMode ? 68 : 70 + crypto.randomInt(0, 11);
  const fast = safeMode ? 12 : 8 + crypto.randomInt(0, 7);
  const slow = safeMode ? 26 : Math.min(55, fast + 10 + crypto.randomInt(0, 20));

  return {
    name: `Auto ${pair} ${safeMode ? "Safe" : "Std"}`,
    definition: {
      entry: [
        { indicator: "RSI", operator: "<", value: rsiLow, period: 14 },
        { indicator: "EMA_CROSS", value: "BULLISH", fast, slow },
      ],
      exit: [{ indicator: "RSI", operator: ">", value: rsiHigh, period: 14 }],
    },
    risk: safeMode
      ? {
          stopLossPct: 1.5,
          takeProfitPct: 2.5,
          maxDailyLossPct: 2,
          positionSizePct: 5,
        }
      : {
          stopLossPct: 2.5,
          takeProfitPct: 4,
          maxDailyLossPct: 5,
          positionSizePct: 10,
        },
  };
}

import { z } from "zod";
import { DEFAULT_SPOT_PAIR } from "@/lib/market-defaults";

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const strategyDefinitionSchema = z.object({
  entry: z.array(z.any()).default([]),
  exit: z.array(z.any()).default([]),
});

export const createStrategySchema = z.object({
  name: z.string().min(1).max(120),
  definition: strategyDefinitionSchema,
  safeMode: z.boolean().optional(),
});

export const createBotSchema = z.object({
  strategyId: z.string().min(1),
  pair: z.string().min(3).max(32).default(DEFAULT_SPOT_PAIR),
  mode: z.enum(["real", "paper"]).default("paper"),
  risk: z
    .object({
      stopLossPct: z.number().min(0.1).max(50).optional(),
      takeProfitPct: z.number().min(0.1).max(100).optional(),
      maxDailyLossPct: z.number().min(0.1).max(50).optional(),
      positionSizePct: z.number().min(0.5).max(100).optional(),
    })
    .optional(),
});

export const optimizeSchema = z.object({
  strategyId: z.string().optional(),
  definition: strategyDefinitionSchema.optional(),
  symbol: z.string().default(DEFAULT_SPOT_PAIR),
  timeframe: z.string().default("1h"),
  candleLimit: z.number().min(50).max(1000).default(500),
  count: z.number().min(50).max(200).default(80),
  save: z.boolean().default(true),
});

export const userKeysSchema = z.object({
  apiKey: z.string().min(10),
  apiSecret: z.string().min(10),
});

export const followSchema = z.object({
  traderId: z.string().min(1),
});

function optionalPositiveNumber(val) {
  if (val == null || val === "") return undefined;
  const n = typeof val === "number" ? val : Number(val);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

export const manualTradeSchema = z.object({
  pair: z
    .string()
    .min(3)
    .max(64)
    .transform((s) => String(s).trim().toUpperCase().replace(/-/g, "/")),
  side: z.enum(["buy", "sell"]),
  mode: z.enum(["real", "paper"]).default("paper"),
  /** Base asset size (e.g. BTC) */
  amountBase: z.preprocess(optionalPositiveNumber, z.number().positive().optional()),
  /** Quote spent for market buy (USDC) */
  spendQuote: z.preprocess(optionalPositiveNumber, z.number().positive().optional()),
});

const normPairString = z
  .string()
  .min(3)
  .max(64)
  .transform((s) => String(s).trim().toUpperCase().replace(/-/g, "/"));

export const liveProtectSchema = z.object({
  pair: normPairString,
  stopLoss: z.union([z.number().positive(), z.null()]).optional(),
  takeProfit: z.union([z.number().positive(), z.null()]).optional(),
  /** Șterge toate țintele pentru pereche */
  clear: z.boolean().optional(),
});

export const liveAiProtectRequestSchema = z.object({
  pair: normPairString,
  /** Dacă true, salvează stopLoss/takeProfit în User.liveProtections */
  apply: z.boolean().optional(),
});

export const liveCloseSchema = z.object({
  pair: normPairString,
  mode: z.enum(["paper", "real"]),
});

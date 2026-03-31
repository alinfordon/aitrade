import mongoose from "mongoose";
import { DEFAULT_SPOT_PAIR } from "@/lib/market-defaults";

const RiskSchema = new mongoose.Schema(
  {
    stopLossPct: { type: Number, default: 2 },
    takeProfitPct: { type: Number, default: 3 },
    maxDailyLossPct: { type: Number, default: 5 },
    positionSizePct: { type: Number, default: 10 },
  },
  { _id: false }
);

const PaperStateSchema = new mongoose.Schema(
  {
    quoteBalance: { type: Number, default: 10000 },
    baseBalance: { type: Number, default: 0 },
    avgEntry: { type: Number, default: 0 },
    open: { type: Boolean, default: false },
  },
  { _id: false }
);

/** Tracks open spot position for real bots (persisted across cron ticks). */
const PositionStateSchema = new mongoose.Schema(
  {
    open: { type: Boolean, default: false },
    side: { type: String, enum: ["buy", "sell"], default: "buy" },
    entryPrice: { type: Number, default: 0 },
    quantity: { type: Number, default: 0 },
    openedAt: { type: Date, default: null },
  },
  { _id: false }
);

const BotSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    strategyId: { type: mongoose.Schema.Types.ObjectId, ref: "Strategy", required: true },
    status: {
      type: String,
      enum: ["active", "paused", "stopped"],
      default: "stopped",
      index: true,
    },
    pair: { type: String, required: true, default: DEFAULT_SPOT_PAIR },
    lastRun: { type: Date, default: null },
    mode: { type: String, enum: ["real", "paper"], default: "paper" },
    risk: { type: RiskSchema, default: () => ({}) },
    paperState: { type: PaperStateSchema, default: () => ({}) },
    positionState: { type: PositionStateSchema, default: () => ({}) },
    futuresEnabled: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.models.Bot || mongoose.model("Bot", BotSchema);

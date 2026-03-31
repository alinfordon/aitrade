import mongoose from "mongoose";

const StrategySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true },
    /** Dynamic JSON: entry/exit indicator rules */
    definition: { type: mongoose.Schema.Types.Mixed, required: true },
    source: {
      type: String,
      enum: ["user", "optimized", "auto", "marketplace"],
      default: "user",
    },
    parentStrategyId: { type: mongoose.Schema.Types.ObjectId, ref: "Strategy", default: null },
    optimizationMeta: {
      score: Number,
      backtestProfit: Number,
      winRate: Number,
      maxDrawdown: Number,
      trades: Number,
    },
    /** Marketplace listing (structure for future monetization) */
    marketplace: {
      listed: { type: Boolean, default: false },
      priceUsd: { type: Number, default: 0 },
      description: { type: String, default: "" },
    },
    safeMode: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.models.Strategy || mongoose.model("Strategy", StrategySchema);

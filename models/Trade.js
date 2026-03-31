import mongoose from "mongoose";

const TradeSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    botId: { type: mongoose.Schema.Types.ObjectId, ref: "Bot", default: null },
    pair: { type: String, required: true },
    side: { type: String, enum: ["buy", "sell"], required: true },
    quantity: { type: Number, required: true },
    price: { type: Number, required: true },
    quoteQty: { type: Number, default: 0 },
    fee: { type: Number, default: 0 },
    pnl: { type: Number, default: 0 },
    status: { type: String, enum: ["filled", "simulated", "failed", "cancelled"], default: "filled" },
    isPaper: { type: Boolean, default: false },
    /** Copy-trading: original trader and source trade */
    traderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    copiedFromTradeId: { type: mongoose.Schema.Types.ObjectId, ref: "Trade", default: null },
    errorMessage: { type: String, default: "" },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    /** manual | bot — copy trades use traderId */
    tradeSource: { type: String, enum: ["bot", "manual", "copy"], default: "bot" },
  },
  { timestamps: true }
);

TradeSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.models.Trade || mongoose.model("Trade", TradeSchema);

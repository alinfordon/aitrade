import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    /** Afișare admin / profil (opțional) */
    displayName: { type: String, default: "", trim: true },
    passwordHash: { type: String, required: true },
    /** AES-GCM ciphertext (empty if keys not set) */
    apiKeyEncrypted: { type: String, default: "" },
    apiSecretEncrypted: { type: String, default: "" },
    subscriptionPlan: {
      type: String,
      enum: ["free", "pro", "elite"],
      default: "free",
    },
    /** Data expirării planului plătit (setată manual de admin sau flux viitor); null = fără expirare impusă */
    planExpiresAt: { type: Date, default: null },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    stripeCustomerId: { type: String, default: "" },
    stripeSubscriptionId: { type: String, default: "" },
    /** Aggregate stats for leaderboard / dashboard */
    stats: {
      totalProfit: { type: Number, default: 0 },
      totalTrades: { type: Number, default: 0 },
      winTrades: { type: Number, default: 0 },
    },
    /** Manual/paper spot book: { "BTC/USDC": { qty, avg } } */
    manualSpotBook: { type: mongoose.Schema.Types.Mixed, default: {} },
    /** Ținte afișate pe Live Trading: { "BTC/USDC": { stopLoss?, takeProfit? } } */
    liveProtections: { type: mongoose.Schema.Types.Mixed, default: {} },
    /** Sold paper în USDC (implicit) */
    manualPaperQuoteBalance: { type: Number, default: 10000 },
    /** @deprecated folosește manualPaperQuoteBalance; păstrat pentru migrare */
    manualPaperUsdt: { type: Number },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" } }
);

export default mongoose.models.User || mongoose.model("User", UserSchema);

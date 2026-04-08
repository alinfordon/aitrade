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
    /**
     * Pilot AI: analiză periodică, activare/pauză boti, închidere poziții la semnal.
     * botIds = subset din botii userului; maxUsdcPerTrade plafonează suma la ordin buy real.
     */
    aiPilot: {
      enabled: { type: Boolean, default: false },
      intervalMinutes: { type: Number, default: 15 },
      botIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Bot" }],
      maxUsdcPerTrade: { type: Number, default: 150 },
      /** Ordine manuale + boti noi creați de pilot */
      pilotOrderMode: { type: String, enum: ["paper", "real"], default: "paper" },
      manualTradingEnabled: { type: Boolean, default: false },
      createBotFromAnalysis: { type: Boolean, default: false },
      /** Max acțiuni pe rundă: cumpărare/vânzare manuală + creare bot (nu include activare/pauză bot existent) */
      maxTradesPerRun: { type: Number, default: 3 },
      /** Perechi distincte cu poziție manuală deschisă — plafon pentru intrări noi pe perechi noi */
      maxOpenManualPositions: { type: Number, default: 3 },
      /** Max boți creați de pilot (strategie source=pilot); la depășire se pot elimina cei fără poziție deschisă. */
      maxPilotBots: { type: Number, default: 5 },
      lastRunAt: { type: Date, default: null },
      lastSummary: { type: String, default: "" },
      lastError: { type: String, default: "" },
    },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" } }
);

export default mongoose.models.User || mongoose.model("User", UserSchema);

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
    /** Cron independent TP/SL pe poziții manuale live (fără AI). */
    manualLiveTpsl: {
      enabled: { type: Boolean, default: true },
      intervalMinutes: { type: Number, default: 1 },
      lastRunAt: { type: Date, default: null },
      lastSummary: { type: String, default: "" },
      lastError: { type: String, default: "" },
    },
    /** Sold paper în USDC (implicit) */
    manualPaperQuoteBalance: { type: Number, default: 10000 },
    /** @deprecated folosește manualPaperQuoteBalance; păstrat pentru migrare */
    manualPaperUsdt: { type: Number },
    /** Furnizor AI + mod agentic; cheile proprii sunt criptate AES-GCM (același ENCRYPTION_KEY ca Binance). */
    aiSettings: {
      provider: { type: String, enum: ["gemini", "claude", "ollama"], default: "gemini" },
      /** Claude: raționament extins în system prompt (nu e agent cu tool-use Anthropic). */
      claudeAgentic: { type: Boolean, default: false },
    },
    /** BYOK Gemini — câmp gol = folosește GEMINI_API_KEY din env (dacă există). */
    aiGeminiApiKeyEncrypted: { type: String, default: "" },
    aiGeminiModel: { type: String, default: "" },
    /** BYOK Anthropic — câmp gol = folosește ANTHROPIC_API_KEY din env. */
    aiAnthropicApiKeyEncrypted: { type: String, default: "" },
    aiAnthropicModel: { type: String, default: "" },
    /** Ollama: URL API (ex. http://localhost:11434) — text clar; modelul tot în clar. */
    aiOllamaBaseUrl: { type: String, default: "" },
    aiOllamaModel: { type: String, default: "" },
    /** Ollama Cloud / gateway cu Bearer — criptat AES-GCM; gol = OLLAMA_API_KEY din env dacă există. */
    aiOllamaApiKeyEncrypted: { type: String, default: "" },
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
      /** Guard anti-intrări târzii pe 15m (re-entry după vârf / decelerare). */
      momentumGuardEnabled: { type: Boolean, default: true },
      momentumGuardStrictness: {
        type: String,
        enum: ["permissive", "balanced", "strict"],
        default: "balanced",
      },
      /** Dacă e true, pragurile numerice de mai jos suprascriu preset-ul de strictness. */
      momentumGuardCustomEnabled: { type: Boolean, default: false },
      /** Praguri custom (procente: 0.05 = 0.05%; drawdown exprimat în % clasic, ex 2.5 = -2.5%). */
      momentumGuardMinLastChangePct: { type: Number, default: null },
      momentumGuardMinAccelerationPct: { type: Number, default: null },
      momentumGuardMaxDrawdownFromHighPct: { type: Number, default: null },
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
      /** Cron separat: verifică poziții manuale Live și poate propune vânzări (mod real). */
      manualLiveAiEnabled: { type: Boolean, default: false },
      manualLiveIntervalMinutes: { type: Number, default: 1 },
      lastManualLiveRunAt: { type: Date, default: null },
      lastManualLiveSummary: { type: String, default: "" },
      lastManualLiveError: { type: String, default: "" },
    },
    /**
     * Portofoliu pe termen lung cu ținte de alocare + alerte de rebalansare.
     * `targets` suma ~100% (validată la salvare). `manualHoldings` = poziții off-exchange
     * (hardware wallet, altă bursă) care se adaugă peste spot real pentru totaluri.
     */
    portfolio: {
      /** Moneda de referință pentru valori/cost (momentan locked pe USDC, lăsat extensibil). */
      quoteAsset: { type: String, enum: ["USDC"], default: "USDC" },
      /** Toleranță drift peste care se recomandă rebalansare (în puncte procentuale absolute). */
      tolerancePct: { type: Number, default: 5, min: 0.5, max: 30 },
      /** Prag sub care un activ e considerat „praf” (ascuns din tabelul principal, grupat separat). */
      dustThresholdUsd: { type: Number, default: 1, min: 0, max: 1000 },
      includeRealSpot: { type: Boolean, default: true },
      includeManual: { type: Boolean, default: true },
      targets: {
        type: [
          new mongoose.Schema(
            {
              symbol: { type: String, required: true, uppercase: true, trim: true },
              targetPct: { type: Number, required: true, min: 0, max: 100 },
              note: { type: String, default: "", trim: true },
            },
            { _id: false }
          ),
        ],
        default: [],
      },
      manualHoldings: {
        type: [
          new mongoose.Schema(
            {
              symbol: { type: String, required: true, uppercase: true, trim: true },
              quantity: { type: Number, required: true, min: 0 },
              avgCost: { type: Number, default: 0, min: 0 },
              note: { type: String, default: "", trim: true },
            },
            { _id: false }
          ),
        ],
        default: [],
      },
      updatedAt: { type: Date, default: null },
    },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" } }
);

export default mongoose.models.User || mongoose.model("User", UserSchema);

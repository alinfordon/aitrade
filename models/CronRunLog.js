import mongoose from "mongoose";

/** Ultimele execuții reușite / eșuate ale job-urilor HTTP cron (run-bots, ai-pilot, ai-pilot-manual-live, ai-optimize). */
const CronRunLogSchema = new mongoose.Schema(
  {
    job: { type: String, required: true, index: true },
    ok: { type: Boolean, required: true },
    statusCode: { type: Number, default: 200 },
    durationMs: { type: Number, default: null },
    error: { type: String, default: "" },
    summary: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

CronRunLogSchema.index({ createdAt: -1 });

export default mongoose.models.CronRunLog || mongoose.model("CronRunLog", CronRunLogSchema);

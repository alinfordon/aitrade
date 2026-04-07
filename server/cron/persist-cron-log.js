import { connectDB } from "@/models/db";
import CronRunLog from "@/models/CronRunLog";

/**
 * Păstrează un rezumat compact (evită documente uriașe în Mongo).
 * @param {{ job: string, ok: boolean, statusCode?: number, durationMs?: number, error?: string, body?: unknown }} args
 */
export async function persistCronRun(args) {
  const { job, ok, statusCode = 200, durationMs, error, body } = args;
  try {
    await connectDB();
    const summary = buildSummaryForStorage(job, body);
    await CronRunLog.create({
      job,
      ok,
      statusCode,
      durationMs: durationMs ?? null,
      error: error ? String(error).slice(0, 4000) : "",
      summary,
    });
  } catch (e) {
    console.error("[persistCronRun]", job, e);
  }
}

function buildSummaryForStorage(job, body) {
  if (!body || typeof body !== "object") {
    return {};
  }

  if (job === "run-bots") {
    const r = Array.isArray(body.results) ? body.results : [];
    return {
      processed: body.processed ?? r.length,
      items: r.slice(0, 24).map((x) => ({
        botId: x.botId,
        ok: x.ok,
        skipped: x.skipped,
        reason: x.reason,
        action: x.action,
        error: x.error ? String(x.error).slice(0, 240) : undefined,
      })),
    };
  }

  if (job === "ai-pilot") {
    const r = Array.isArray(body.results) ? body.results : [];
    return {
      batchUsers: r.length,
      items: r.slice(0, 16).map((item) => ({
        userId: item.userId,
        ok: item.ok,
        skipped: item.skipped,
        reason: item.reason,
        error: item.error ? String(item.error).slice(0, 300) : undefined,
        rezumat: item.rezumat ? String(item.rezumat).slice(0, 400) : undefined,
        appliedCount: Array.isArray(item.applied) ? item.applied.length : undefined,
        actionsUsed: item.actionsUsed,
        gainersSlice: item.gainersSlice,
        nextInMs: item.nextInMs,
      })),
    };
  }

  if (job === "ai-optimize") {
    const r = Array.isArray(body.results) ? body.results : [];
    return {
      elitesTried: r.length,
      items: r.slice(0, 25).map((x) => ({
        userId: x.userId,
        strategyId: x.strategyId,
        skipped: x.skipped,
        error: x.error ? String(x.error).slice(0, 240) : undefined,
      })),
    };
  }

  return { note: "unknown-job-shape" };
}

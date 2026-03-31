export function maxBotsForPlan(plan) {
  if (plan === "elite") return Number.POSITIVE_INFINITY;
  if (plan === "pro") return 5;
  return 1;
}

export function canUseAiOptimizer(plan) {
  return plan === "elite";
}

export function canListOnMarketplace(plan) {
  return plan === "elite" || plan === "pro";
}

/** Analiză AI pentru SL/TP pe Live (poziție manuală). */
export function canUseLiveAiAnalysis(plan) {
  return plan === "elite" || plan === "pro";
}

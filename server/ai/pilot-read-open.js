/**
 * Poziție deschisă bot (paper sau real) — folosit de motorul AI Pilot.
 * @param {import("mongoose").Document | object} bot
 */
export function readPilotOpen(bot) {
  if (bot.mode === "paper") {
    const p = bot.paperState || {};
    if (p.open && Number(p.baseBalance) > 1e-12) {
      return {
        has: true,
        avgEntry: Number(p.avgEntry) || 0,
        qty: Number(p.baseBalance) || 0,
      };
    }
  } else {
    const pos = bot.positionState || {};
    if (pos.open && Number(pos.quantity) > 1e-12) {
      return {
        has: true,
        avgEntry: Number(pos.entryPrice) || 0,
        qty: Number(pos.quantity) || 0,
      };
    }
  }
  return { has: false, avgEntry: 0, qty: 0 };
}

/** Cotă spot implicită în aplicație: doar USDC (stables/alte cote apar doar unde Binance/CCXT le cere explicit). */
export const DEFAULT_QUOTE_ASSET = "USDC";

export const DEFAULT_SPOT_PAIR = `BTC/${DEFAULT_QUOTE_ASSET}`;

export function defaultPairForBase(baseSymbol = "BTC") {
  return `${baseSymbol.toUpperCase()}/${DEFAULT_QUOTE_ASSET}`;
}

/** Sold paper manual: citire cu migrare de la câmpul vechi manualPaperUsdt */
export function getManualPaperQuoteBalance(user) {
  if (!user) return 10000;
  const v = user.manualPaperQuoteBalance ?? user.manualPaperUsdt;
  return Number(v ?? 10000);
}

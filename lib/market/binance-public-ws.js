/**
 * Utilitare streamuri publice Binance Spot (fără API key) — browser / Node.
 */

export const BINANCE_SPOT_COMBINED_WS = "wss://stream.binance.com:9443/stream";

/** BTC/USDC → btcusdc */
export function binanceSpotStreamSymbol(ccxtPair) {
  return String(ccxtPair || "")
    .trim()
    .replace(/\s/g, "")
    .replace("/", "")
    .toLowerCase();
}

/** Ex: btcusdc + 15m → btcusdc@kline_15m */
export function binanceKlineStreamName(symbolLower, interval) {
  return `${symbolLower}@kline_${interval}`;
}

export function binanceTickerStreamName(symbolLower) {
  return `${symbolLower}@ticker`;
}

export function binanceCombinedSpotLiveUrl(symbolLower, interval) {
  const k = binanceKlineStreamName(symbolLower, interval);
  const t = binanceTickerStreamName(symbolLower);
  return `${BINANCE_SPOT_COMBINED_WS}?streams=${k}/${t}`;
}

/** @param {unknown} raw - mesaj WS parse JSON */
export function parseBinanceCombinedMessage(raw) {
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

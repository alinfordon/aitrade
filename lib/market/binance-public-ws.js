/**
 * Utilitare streamuri publice Binance Spot (fără API key) — browser / Node.
 */

export const BINANCE_SPOT_COMBINED_WS = "wss://stream.binance.com:9443/stream";

/** Stream combinat USD-M futures (aceleași evenimente kline/ticker ca spot, simbol lowercase + usdt). */
export const BINANCE_USDM_COMBINED_WS = "wss://fstream.binance.com/stream";

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

/**
 * Pereche CCXT ex. BTC/USDC — stream futures liniar USDT-M: `btcusdt`.
 * @param {string} ccxtPair
 */
export function binanceUsdmStreamSymbolFromCcxtPair(ccxtPair) {
  const s = String(ccxtPair || "")
    .trim()
    .replace(/\s/g, "")
    .replace(/-/g, "/");
  const parts = s.split("/");
  if (parts.length !== 2 || !parts[0]) return "";
  return `${parts[0].toLowerCase()}usdt`;
}

export function binanceCombinedUsdmLiveUrl(symbolLowerUsdt, interval) {
  const k = binanceKlineStreamName(symbolLowerUsdt, interval);
  const t = binanceTickerStreamName(symbolLowerUsdt);
  return `${BINANCE_USDM_COMBINED_WS}?streams=${k}/${t}`;
}

/** @param {unknown} raw - mesaj WS parse JSON */
export function parseBinanceCombinedMessage(raw) {
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

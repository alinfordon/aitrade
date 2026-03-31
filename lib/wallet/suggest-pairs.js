import { DEFAULT_QUOTE_ASSET, DEFAULT_SPOT_PAIR } from "@/lib/market-defaults";

/** Perechi uzuale (cotă USDC) + derivate din active. */
const DEFAULT_PAIRS = [
  DEFAULT_SPOT_PAIR,
  `ETH/${DEFAULT_QUOTE_ASSET}`,
  `BNB/${DEFAULT_QUOTE_ASSET}`,
  `SOL/${DEFAULT_QUOTE_ASSET}`,
  `XRP/${DEFAULT_QUOTE_ASSET}`,
  `DOGE/${DEFAULT_QUOTE_ASSET}`,
  `ADA/${DEFAULT_QUOTE_ASSET}`,
  `AVAX/${DEFAULT_QUOTE_ASSET}`,
];

/** Ordine: USDC (implicit aplicație), apoi alte cote utile pentru sugestii din sold */
const QUOTES = [DEFAULT_QUOTE_ASSET, "FDUSD", "BTC", "ETH"];

/**
 * @param {Array<{ currency: string, free: number }>} balances — doar real
 */
export function buildSuggestedPairs(balances) {
  const set = new Set(DEFAULT_PAIRS);
  const currencies = new Set(
    (balances || []).filter((b) => b.free > 1e-12).map((b) => b.currency)
  );

  for (const cur of currencies) {
    for (const quote of QUOTES) {
      if (cur === quote) continue;
      set.add(`${cur}/${quote}`);
    }
  }

  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/**
 * Solduri paper: USDC + poziții din manualSpotBook.
 */
export function paperBalancesList(quoteBalance, book, quoteAsset = DEFAULT_QUOTE_ASSET) {
  const rows = [{ currency: quoteAsset, free: quoteBalance, used: 0, kind: "paper" }];
  if (book && typeof book === "object") {
    for (const [pair, pos] of Object.entries(book)) {
      const qty = Number(pos?.qty ?? pos?.base ?? 0);
      if (qty > 1e-12) {
        const base = pair.includes("/") ? pair.split("/")[0] : pair;
        rows.push({
          currency: base,
          free: qty,
          used: 0,
          kind: "paper",
          pair,
          avgEntry: pos?.avg ?? pos?.avgEntry,
        });
      }
    }
  }
  return rows;
}

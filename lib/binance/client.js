import ccxt from "ccxt";

const MAX_RETRIES = 4;
const BASE_DELAY_MS = 400;

function isRateLimitError(e) {
  const msg = String(e?.message || "");
  return (
    e instanceof ccxt.RateLimitExceeded ||
    e instanceof ccxt.DDoSProtection ||
    /429|rate limit|too many requests/i.test(msg)
  );
}

function isBinanceTimestampSkewError(e) {
  const msg = String(e?.message || "");
  return /-1021|timestamp for this request|timestamp.*server/i.test(msg);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Create Binance client (spot). Pass decrypted user keys or public-only.
 * @param {{ apiKey?: string, secret?: string, futures?: boolean }} opts
 */
export function createExchange(opts = {}) {
  const Ex = opts.futures ? ccxt.binanceusdm : ccxt.binance;
  const x = new Ex({
    apiKey: opts.apiKey || undefined,
    secret: opts.secret || undefined,
    enableRateLimit: true,
    options: {
      defaultType: opts.futures ? "future" : "spot",
      /** Evită Binance -1021 când ceasul local e înainte/înapoi față de server */
      adjustForTimeDifference: true,
      /** Fereastră mai mare (ms) pentru variații minore de timp; max permis Binance = 60000 */
      recvWindow: 60_000,
    },
  });
  return x;
}

/** 
 * Binance cere ca timestamp-ul semnat să nu fie cu >~1000ms înaintea serverului.
 * CCXT poate sub-estima diferența; buffer mic + retry reduce -1021 pe Windows/VM.
 */
function applyTimeSkewBuffer(ex) {
  const raw = process.env.BINANCE_TIME_SKEW_MS;
  const n = raw != null && raw !== "" ? Number(raw) : 450;
  const buf = Number.isFinite(n) && n >= 0 ? n : 450;
  ex.options["timeDifference"] = (ex.options["timeDifference"] || 0) + buf;
}

/**
 * Actualizează `timeDifference` față de server; apelează înainte de request-uri semnate (după loadMarkets).
 */
export async function syncServerTime(ex) {
  let lastErr;
  for (let i = 0; i < 4; i++) {
    try {
      await ex.loadTimeDifference();
      applyTimeSkewBuffer(ex);
      return;
    } catch (e) {
      lastErr = e;
      await sleep(150 * (i + 1));
    }
  }
  console.warn("[binance] loadTimeDifference failed after retries:", lastErr?.message || lastErr);
  applyTimeSkewBuffer(ex);
}

/**
 * @param {() => Promise<any>} fn
 * @param {{ exchange?: import("ccxt").Exchange }} meta - dacă e setat, la -1021 se resincronizează timpul și se reîncearcă o dată
 */
export async function withRetries(fn, meta = {}) {
  let last;
  let resyncedForClock = false;
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (
        meta.exchange &&
        isBinanceTimestampSkewError(e) &&
        !resyncedForClock
      ) {
        resyncedForClock = true;
        await syncServerTime(meta.exchange);
        await sleep(BASE_DELAY_MS);
        continue;
      }
      if (isRateLimitError(e)) {
        await sleep(BASE_DELAY_MS * 2 ** i);
        continue;
      }
      if (i < MAX_RETRIES - 1 && /network|fetch|timeout/i.test(String(e?.message))) {
        await sleep(BASE_DELAY_MS * 2 ** i);
        continue;
      }
      throw e;
    }
  }
  throw last;
}

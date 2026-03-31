/**
 * IP public cu care serverul (Vercel / hosting) iese către internet — același
 * IP pe care îl poți adăuga în Binance → API Management (dacă ai restricție IP).
 * Rezultatul e cache-uit scurt pentru a nu apela servicii externe la fiecare eroare.
 */

let cached = { ip: null, at: 0 };
const TTL_MS = 5 * 60 * 1000;

/**
 * @returns {Promise<string | null>}
 */
export async function getServerOutboundIp() {
  const now = Date.now();
  if (cached.ip && now - cached.at < TTL_MS) return cached.ip;

  const tryFetch = async (url, parse) => {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(4000),
      headers: { Accept: "application/json, text/plain,*/*" },
    });
    if (!res.ok) return null;
    return parse(res);
  };

  try {
    const ip = await tryFetch("https://api.ipify.org?format=json", async (res) => {
      const j = await res.json();
      return typeof j?.ip === "string" && j.ip ? j.ip : null;
    });
    if (ip) {
      cached = { ip, at: now };
      return ip;
    }
  } catch {
    /* fallback */
  }

  try {
    const textIp = await tryFetch("https://icanhazip.com", async (res) => {
      const t = (await res.text()).trim();
      return /^[\d.:a-fA-F]+$/.test(t) ? t : null;
    });
    if (textIp) {
      cached = { ip: textIp, at: now };
      return textIp;
    }
  } catch {
    /* ignore */
  }

  return null;
}

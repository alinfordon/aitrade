import { getServerOutboundIp } from "@/lib/server-outbound-ip";

function matchesRestrictedLocation(raw) {
  return /banned|restricted region|451|geographic|service unavailable from/i.test(raw);
}

/**
 * Mesaje CCXT / Binance mai utile în UI (română).
 * @param {unknown} err
 * @returns {string}
 */
export function mapBinanceUserMessage(err) {
  const raw = err instanceof Error ? err.message : String(err);
  if (/unable to authenticate data|Invalid authentication tag|bad decrypt/i.test(raw)) {
    return "Cheile nu pot fi descifrate. Salvează-le din pagina Settings (nu insera text clar în MongoDB în câmpurile criptate). Dacă ai schimbat ENCRYPTION_KEY după salvare, trebuie să introduci din nou cheile din Settings.";
  }
  if (/-1021|timestamp.*server|timestamp for this request/i.test(raw)) {
    return `${raw.trim()} — Ceasul mașinii (sau estimarea CCXT) e în fața Binance. Aplicația adaugă deja compensare; sincronizează ora Windows (Setări → Timp). Opțional în .env.local: BINANCE_TIME_SKEW_MS=600 (milisecunde suplimentar „înapoi”).`;
  }
  if (
    /401|Invalid Api-?Key|invalid api-key|API-?Key does not exist|-2015|permissions for action/i.test(
      raw
    )
  ) {
    return `${raw.trim()} — Verifică: (1) API Key + Secret copiate corect (Secret se afișează o singură dată la creare). (2) În Binance: „Enable Spot & Margin Trading” pentru ordine (nu doar Reading). (3) IP restricționat = adaugă IP-ul de unde rulează serverul (localhost / IP public / egress Vercel) sau „Unrestricted” pentru test. (4) Cont Binance.com vs Binance.US trebuie să corespundă codului aplicației (implicit .com).`;
  }
  if (matchesRestrictedLocation(raw)) {
    return `${raw.trim()} — Binance poate restricționa API-ul din regiunea sau IP-ul cererii. Dacă folosești restricție IP pe cheie, whitelist-ul trebuie să includă IP-ul de ieșire al serverului (hosting).`;
  }
  if (/insufficient balance/i.test(raw)) {
    return `${raw.trim()} — Frecvent la VÂNZARE: cantitatea cerută depășește soldul liber în moneda de bază (ex. comisioane au mâncat din cantitate, rotunjiri sau poziția din app nu reflectă exact Binance). Verifică în Binance soldul „Available” pentru acel activ, micșorează cantitatea sau sincronizează din nou. La CUMPĂRARE: fonduri insuficiente în moneda cotei (ex. USDC).`;
  }
  if (/NOTIONAL|-1013|Filter failure:\s*NOTIONAL/i.test(raw)) {
    return `${raw.trim()} — Binance cere o valoare minimă a ordinului în moneda perechii (MIN_NOTIONAL). Poziția ta e prea mică: convertește sau vinzi restul direct din Binance (Convert / Spot), apoi actualizează manual cartea din app dacă e nevoie.`;
  }
  if (/LOT_SIZE|minimum amount precision|quantity has too much precision|step size/i.test(raw)) {
    return `${raw.trim()} — Binance a respins cantitatea: trebuie să respecte pasul LOT_SIZE (ex. 0.1 FET) și minimul de volum în moneda de bază. Aplicația aliniază cantitatea la pas din soldul real; dacă soldul disponibil e sub acel minim („praf”), vinzi restul din Binance sau folosești Convert. Verifică și că poziția bot/carte din app nu depășește „Available” pe exchange.`;
  }
  return raw.trim() || "Eroare necunoscută la Binance.";
}

/**
 * Ca `mapBinanceUserMessage`, dar pentru restricții Binance (451 / „restricted location”)
 * adaugă IP-ul public cu care hostul iese la internet (whitelist în API, dacă aplică).
 * @param {unknown} err
 * @returns {Promise<string>}
 */
export async function mapBinanceUserMessageAsync(err) {
  const raw = err instanceof Error ? err.message : String(err);
  const base = mapBinanceUserMessage(err);
  if (!matchesRestrictedLocation(raw)) return base;

  const ip = await getServerOutboundIp();
  const geoNote =
    "Dacă mesajul menționează eligibilitate / «restricted location» după termeni, poate fi blocaj geografic — lista de IP din Binance nu rezolvă mereu; aplicația trebuie rulată din rețea țară permise sau altă soluție conform Binance.";

  if (ip) {
    return `${base} — IP public al serverului (cel cu care hostul apelează Binance; pune-l în API Management → restricții IP dacă nu e „Unrestricted”): ${ip}. Pe Vercel IP-ul de egress poate să nu fie fix — dacă după whitelist tot eșuează, verifică doc. Vercel sau folosește cont dedicat cu IP static. ${geoNote}`;
  }

  return `${base} — Nu s-a putut detecta automat IP-ul de egress. În Vercel: Deployment → Runtime Logs / documentație egress sau setează temporar cheia API Binance pe «Unrestricted IP» pentru test. ${geoNote}`;
}

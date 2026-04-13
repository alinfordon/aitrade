# Cron pe VPS (Linux) — fără EasyCron

Pe serverul unde rulează Next.js (PM2, port local + Nginx), poți folosi **cron-ul sistemului** (`crontab`) cu `curl` către **`http://127.0.0.1:PORT`**. Traficul rămâne pe mașină; nu ai nevoie de servicii externe pentru declanșare.

## Ce ai nevoie

1. **`CRON_SECRET`** — aceeași valoare ca în `.env.production` / variabilele app-ului Next.
2. **Portul** pe care ascultă app-ul (ex. `3010` ca în `deploy_next_https.sh`).
3. Script opțional: [`scripts/vps-cron.sh`](../scripts/vps-cron.sh) (citește `CRON_SECRET` din `.env.production` dacă nu e deja exportat).

## Varianta rapidă (fără script)

```bash
crontab -e
```

Exemple (înlocuiește `3010`, domeniul nu contează — folosești doar loopback):

```cron
# Boți — recomandat în fiecare minut
* * * * * curl -fsS --max-time 120 -H "Authorization: Bearer PUNE_AICI_CRON_SECRET" "http://127.0.0.1:3010/api/cron/run-bots" >/dev/null 2>&1

# AI Pilot Live manual — TP/SL pe perechi pilot, în fiecare minut
* * * * * curl -fsS --max-time 120 -H "Authorization: Bearer PUNE_AICI_CRON_SECRET" "http://127.0.0.1:3010/api/cron/ai-pilot-manual-live" >/dev/null 2>&1

# AI Pilot — la 15 minute (aliniat cu intervalul din UI)
*/15 * * * * curl -fsS --max-time 180 -H "Authorization: Bearer PUNE_AICI_CRON_SECRET" "http://127.0.0.1:3010/api/cron/ai-pilot" >/dev/null 2>&1

# Optimizare strategii (zilnic 02:00 UTC — ajustează TZ dacă vrei ora RO)
0 2 * * * curl -fsS --max-time 300 -H "Authorization: Bearer PUNE_AICI_CRON_SECRET" "http://127.0.0.1:3010/api/cron/ai-optimize" >/dev/null 2>&1
```

**Nu pune secretul în URL** (`?key=...`). Folosește doar header `Authorization: Bearer …`.

**De ce nu văd `run-bots` în „Ultimele execuții cron” din admin?** Jurnalul Mongo se scrie doar după autentificare reușită. Dacă în crontab ai `-H "Authorization: cheia_ta"` **fără** cuvântul `Bearer`, în versiunile vechi primeai **401** și syslog arăta tot `CMD (curl … run-bots)` (cronul rula), dar aplicația respingea cererea. Recomandat: `Authorization: Bearer …`. Din cod acceptăm și valoarea brută identică cu `CRON_SECRET` în `Authorization` (compatibilitate cu crontab-uri existente).

## Varianta cu script (secret din `.env.production`)

```bash
chmod +x /var/www/aitrade/scripts/vps-cron.sh
```

```cron
APP_ROOT=/var/www/aitrade
BASE_URL=http://127.0.0.1:3010

* * * * * APP_ROOT=/var/www/aitrade BASE_URL=http://127.0.0.1:3010 /var/www/aitrade/scripts/vps-cron.sh run-bots >>/var/log/aitrade-cron.log 2>&1
* * * * * APP_ROOT=/var/www/aitrade BASE_URL=http://127.0.0.1:3010 /var/www/aitrade/scripts/vps-cron.sh ai-pilot-manual-live >>/var/log/aitrade-cron.log 2>&1
*/15 * * * * APP_ROOT=/var/www/aitrade BASE_URL=http://127.0.0.1:3010 /var/www/aitrade/scripts/vps-cron.sh ai-pilot >>/var/log/aitrade-cron.log 2>&1
0 2 * * * APP_ROOT=/var/www/aitrade BASE_URL=http://127.0.0.1:3010 /var/www/aitrade/scripts/vps-cron.sh ai-optimize >>/var/log/aitrade-cron.log 2>&1
```

Dacă `CRON_SECRET` din fișier conține caractere speciale sau nu se parsează corect, exportă-l explicit în crontab:

```cron
CRON_SECRET='valoarea_exactă'
* * * * * BASE_URL=http://127.0.0.1:3010 /var/www/aitrade/scripts/vps-cron.sh run-bots
```

(Primele variabile `NAME=value` pe linie sunt exportate de `cron` pentru acea rulare, pe Debian/Ubuntu cu Vixie cron.)

## Verificare

```bash
curl -fsS -H "Authorization: Bearer \"$CRON_SECRET\"" "http://127.0.0.1:3010/api/cron/run-bots"
```

Răspuns `200` și JSON `{"ok":true,...}` — în regulă. **401** — secret diferit sau lipsă `CRON_SECRET` în procesul Next (PM2 trebuie repornit după schimbarea `.env`).

## Securitate

- Preferă **127.0.0.1** în loc de domeniul public: nu expui ruta cron prin internet dacă Nginx nu o proxy-uiește către altceva.
- Dacă totuși apelezi `https://domeniu.tld/api/cron/...`, păstrează Bearer secret; nu loga antetele.

Mai multe despre antete: [`easycron.md`](./easycron.md) (aceleași reguli pentru `Authorization` / `X-Cron-Secret`).

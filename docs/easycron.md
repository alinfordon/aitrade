# EasyCron / VPS cron — endpoint-uri `/api/cron/*`

Planificarea joburilor de trading se poate face prin **EasyCron** sau direct prin **cron pe VPS**.
Recomandat:

- `run-bots` la fiecare minut
- `ai-pilot-manual-live` la fiecare minut (monitorizare TP/SL salvat pe perechi AI Pilot, fără decizie AI nouă)
- `ai-pilot` la 15 minute

## Pregătire

1. În **Vercel** → proiect → **Settings** → **Environment Variables**: ai deja `CRON_SECRET` (string lung, random). Trebuie să fie **identic** cu ce pui în EasyCron.
2. Notează URL-ul public al app-ului, ex. `https://nume-proiect.vercel.app` (fără slash la final).

## Configurare EasyCron (www.easycron.com)

1. Cont → **Create Cron Job**.
2. **URL**  
   unul dintre:
   - `https://NUME.vercel.app/api/cron/run-bots`
   - `https://NUME.vercel.app/api/cron/ai-pilot-manual-live`
   - `https://NUME.vercel.app/api/cron/ai-pilot`
3. **HTTP method**  
   `GET`
4. **Anteturi (Avansat → Headers)** — reține: **`CRON_SECRET` e numele variabilei din Vercel, nu numele antetului.**  
   - **Recomandat:** Cheie `Authorization`, Valoare exact `Bearer ` urmat de secret (un spațiu după `Bearer`).  
   - **Alternativă acceptată în app:** Cheie `X-Cron-Secret`, Valoare = doar secretul (fără `Bearer`).  
   - **Greșit (duce la 401):** Cheie `CRON_SECRET` — alt nume de antet; serverul nu îl citea înainte (acum poate merge dacă proxy-ul trimite ca `cron-secret` / `cron_secret`). Preferă `Authorization` sau `X-Cron-Secret`.
5. Opțional: header `Accept: application/json`.
6. **Schedule** / **When to execute**  
   Expresie **cron**: `* * * * *` (în fiecare minut) — sau echivalentul „Every minute” din wizard.
7. Salvează și rulează o dată **manual** (Test / Run now), dacă serviciul oferă.

## Configurare VPS `crontab` (alternativ la EasyCron)

Exemple (înlocuiești domeniul și secretul):

```cron
* * * * * curl -fsS -m 25 -H "Authorization: Bearer CRON_SECRETUL_TAU" "https://DOMENIUL-TAU.ro/api/cron/run-bots" >/dev/null 2>&1
* * * * * curl -fsS -m 25 -H "Authorization: Bearer CRON_SECRETUL_TAU" "https://DOMENIUL-TAU.ro/api/cron/ai-pilot-manual-live" >/dev/null 2>&1
*/15 * * * * curl -fsS -m 25 -H "Authorization: Bearer CRON_SECRETUL_TAU" "https://DOMENIUL-TAU.ro/api/cron/ai-pilot" >/dev/null 2>&1
```

Note:

- folosește exact `Authorization: Bearer <CRON_SECRET>`
- nu pune secretul în query string
- poți redirecționa output-ul într-un fișier log în loc de `/dev/null` dacă vrei audit local

## Verificare

- Răspuns **200** și JSON de tip `{ "ok": true, ... }` → e în regulă.
- **401 Unauthorized** → (1) în Vercel, lipsește `CRON_SECRET` pentru **Production** / redeploy după ce l-ai setat; (2) antet greșit: trebuie `Authorization: Bearer …` sau `X-Cron-Secret: …`, nu doar un câmp denumit la întâmplare; (3) secretul diferă între Vercel și EasyCron.
- **Timeout** — mărește timeout-ul job-ului în EasyCron (ex. 120 s); batch-ul de boturi poate dura la prima rulare.

## Securitate

- Nu pune secretul în URL (`?key=...`). Folosește `Authorization: Bearer …` sau `X-Cron-Secret`.
- Rotește secretul dacă l-ai expus (Vercel + EasyCron).

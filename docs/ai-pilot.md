# AI Pilot – ce face, cum decide, ce setări are

Document tehnic sintetic despre funcționalitatea **AI Pilot** din aplicație:
fluxul per tick, ce analizează, ce acțiuni poate executa, cum se integrează
guard-ul anti-intrări târzii pe 15m și ce setări expune în UI (Settings).

> Toate tranzacțiile spot funcționează pe cotare **USDC**. AI Pilot este
> disponibil pe planurile **Pro** și **Elite** (`canUseAiPilot`).

---

## 1. Componente și cron-uri

AI Pilot este alcătuit din 3 fluxuri independente, rulate pe cron:

| Flux | Funcție server | Cron recomandat | Scop |
|---|---|---|---|
| **Pilot principal** (analiză & acțiuni) | `runAiPilotForUser` (`server/ai/pilot-engine.js`) | la fiecare 15 min (configurabil per user) | Analizează piața și boții, poate activa/pauza/închide boți, poate vinde/cumpăra manual, poate crea un bot nou |
| **TP/SL Live manual** (fără AI) | `runAiPilotManualLiveForUser` | la 1 min | Execută automat Stop Loss / Take Profit pe pozițiile manuale live care au protecții salvate |
| **Vânzări AI pe Live manual** | `runAiPilotManualLiveAiForUser` | la 5 min | AI analizează pozițiile live deschise prin pilot și poate propune vânzări suplimentare (doar în mod `real`) |
| **Reconciliere OCO** | `runOcoReconcileBatch` (`/api/cron/reconcile-oco`) | la 15 min | Sincronizează ordinele OCO de pe Binance cu DB-ul aplicației: detectează SL/TP fillate pe exchange, scade qty, creează `Trade`, curăță referințe moarte (detalii §5.1.2) |

Pe lângă acestea, **motorul de bot** (`runSingleBot`, `server/engine/bot-runner.js`)
evaluează strategia botului (entry/exit) și aplică risk management pentru fiecare
bot activ, indiferent dacă este condus de Pilot sau nu. Guard-ul anti-intrări
târzii descris mai jos rulează **aici**.

### 1.1 Batch runner (`runActiveBotsBatch`) — performanță

- **Runtime cache per batch**: `userCache` (User doc), `ohlcvCache`
  (pe `pair:timeframe:limit:futures`), `balanceCache` (`userId:futures`).
  Boții pe aceeași pereche sau aparținând aceluiași user NU mai dublează
  call-urile externe (Binance OHLCV, `fetchBalance`) sau DB (`User.findById`).
- **Grupare pe user**: boții aceluiași user rulează **secvențial** (cheia API
  Binance are rate limit per cont), dar useri diferiți rulează **în paralel**
  cu o limită de concurență (`RUN_BOTS_USER_CONCURRENCY`, implicit `4`,
  clamp `1..10`). Scalează liniar cu numărul de useri activi.
- **Invalidare `balanceCache`** automată după orice trade real reușit
  (buy / SL / TP close), pentru ca alt bot al aceluiași user să nu opereze
  pe balanță veche.

---

## 2. Analiză multi-timeframe

Există două locuri unde se face analiză tehnică, ambele **multi-timeframe**:

### 2.1 Motorul de bot (`runSingleBot`)

- Aduce lumânări pe **15m** (200 candles) și **1d** (220 candles) cu
  `Promise.allSettled` → dacă 1d pică, nu blocăm tick-ul.
- Evaluează strategia pe **15m** (sursa primară pentru entry/exit).
- Dacă 1d e disponibil, îl folosește ca **filtru de confirmare**:
  - `entryOk = entryOk15m && entryOk1d`
  - `exitOk = exitOk15m && exitOk1d`
- Apoi aplică **Momentum Guard** pe 15m (vezi §3) peste `entryOk`.
- Determină `slPct`, `tpPct`, `maxDailyLossPct`, `positionSizePct` din `bot.risk`.
- Pe poziție deschisă, urmărește SL/TP și `exitOk` pentru a închide.

### 2.2 Analiza AI pentru poziție live (`runLivePositionProtectAnalysis`)

Folosit când AI Pilot cumpără o pereche manual (se salvează automat
SL/TP sugerate + notă tehnică / executive pentru acea poziție).

- Fetch OHLC pe **15m** (~24h) și **1d** (~90 zile).
- Context trimis modelului AI: `contextOHLC15m` + `contextOHLC1d` (plus
  pretMediuIntrare, qty, markPrice).
- Prompt-ul forțează modelul să bazeze **analiza tehnică doar pe OHLC (15m + 1d)**
  și să declare clar dacă vreunul lipsește.
- Modelul întoarce JSON: `stopLoss`, `takeProfit`, `notaExecutive`,
  `analizaTehnica`, `analizaFinanciara`, `avertismente`, `indicatoriPeGrafic`
  (EMA/SMA/BB). Sunt salvate în `user.liveProtections[pair]` și în
  `trade.meta.aiPilotStrategy`.

---

## 3. Momentum Guard (anti-intrări târzii pe 15m)

Obiectiv: **să NU intri în tranzacție la vârful trendului** sau imediat după
o scădere bruscă din care piața încearcă un re-entry. Este o euristică peste
`entryOk` returnat de strategia utilizatorului; **nu** forțează entry, doar îl
poate anula.

Implementare: `momentumContinuationGuardOn15m` în `server/engine/bot-runner.js`.

### 3.1 Metrici calculate

Pe seria `closes` din 15m:

- `changeNow = (close[n-1] - close[n-1-4]) / close[n-1-4]` — variație ultimă oră (4 × 15m).
- `changePrev = (close[n-1-4] - close[n-1-8]) / close[n-1-8]` — variație ora anterioară.
- `acceleration = changeNow - changePrev` — +/- față de segmentul precedent.
- `recentHigh` = max(`close[n-12..n-1]`) — vârf pe ultimele ~3h.
- `drawdownFromHigh = (recentHigh - last) / recentHigh`.

### 3.2 Condiții pentru OK

Intrarea este permisă doar dacă **toate** condițiile sunt îndeplinite:

```text
changeNow        >  minLastChange         // urcare în derulare
acceleration     >  minAcceleration       // nu decelerează prea tare
drawdownFromHigh <  maxDrawdownFromHigh   // nu suntem prea jos sub vârf
```

Dacă nu avem suficiente lumânări pentru calcul, guard-ul face **fail-open**
(`ok: true`) — nu blochează tranzacționarea când nu poate decide.

### 3.3 Preseturi de strictness

Configurabile în Settings → AI Pilot (`momentumGuardStrictness`):

| Nivel | `minLastChange` | `minAcceleration` | `maxDrawdownFromHigh` |
|---|---|---|---|
| `permissive` | +0.025% | -0.1% | -4% |
| `balanced` (default) | +0.05% | -0.05% | -2.5% |
| `strict` | +0.1% | -0.025% | -1.5% |

### 3.4 Praguri custom

Dacă `momentumGuardCustomEnabled = true`, preset-ul este suprascris de
valorile numerice ale userului:

- `momentumGuardMinLastChangePct` (procent, ex. `0.08` = 0.08%)
- `momentumGuardMinAccelerationPct` (procent, ex. `-0.04` = -0.04%)
- `momentumGuardMaxDrawdownFromHighPct` (procent, ex. `4` = -4%)

---

## 4. Ce face `runAiPilotForUser` într-o rulare

Ordinea operațiilor e strict respectată în engine:

1. **Verificări preliminare**: plan `pro`/`elite`, `aiPilot.enabled`,
   throttling pe `intervalMinutes`, scope valid (boți selectați sau manual /
   createBot activat).
2. **Construire payload**:
   - Top USDC gainers 24h (vol min configurat).
   - Lista `boti` aleși de user (id, pair, status, poziție deschisă, preț, %).
   - Lista `pozitiiManualeDeschise` (din `manualSpotBook`).
   - Limitele userului (`maxTradesPerRun`, `maxOpenManualPositions`,
     `maxPilotBots`, ce acțiuni sunt permise).
3. **Decizie AI** (`runAutopilotDecide`) → JSON cu:
   - `rezumat` — context piață + rezumat decizii.
   - `decizii[]` — câte una per bot: `activeaza | pauza | mentine | inchide_pozitie`.
   - `manual[]` — ordine manuale `cumpara | vinde`, doar pe USDC.
   - `botNou` (obiect sau null) — propunere de bot nou (pereche, obiectiv,
     risc, nume, pornire activă).
4. **Faza 1 – vânzări manuale** propuse de AI, plafonate de `maxTradesPerRun`.
5. **Faza 2 – decizii boți existenți**: activeaza / pauza / inchide_pozitie.
6. **Creare bot nou** (dacă `createBotFromAnalysis` e on): strategie + bot prin
   `createPilotStrategyAndBot`; poate evacua boți pilot fără poziție dacă
   `maxPilotBots` e atins.
7. **Faza 3 – cumpărări manuale** (doar USDC, doar perechi din top gainers
   sau deja urmărite, suma clampată la `maxUsdcPerTrade`).
   - **Pre-check fonduri**: la începutul rulării pilotul citește o singură dată
     balanța USDC (free spot pentru real, `manualPaperQuoteBalance` pentru paper)
     și o trimite AI-ului ca `limite.sumaQuoteDisponibila`. Fiecare buy e
     clampat la `min(spend, maxUsdcPerTrade, remainingQuote/(1+0.5%))`; dacă
     disponibilul scade sub `MIN_NOTIONAL_QUOTE` (2 USDC), restul buy-urilor
     sunt respinse cu `detail: fonduri_USDC_insuficiente` / `paper_USDC_insuficient`
     fără a mai contacta Binance.
   - **Defensivă la nivel de `executeManualTrade`**: pentru buy în mod real se
     face încă un `fetchBalance` înainte de `createOrder` și ordinul este blocat
     dacă `freeUSDC < spend * 1.005`, evitând astfel trade-uri `failed` salvate
     degeaba în DB.
   - După fiecare buy reușit, rulează **`enrichAiPilotBuyWithStrategy`**
     (analiză live cu 15m+1d), salvează SL/TP și nota AI în
     `user.liveProtections[pair]` și în `trade.meta.aiPilotStrategy`.
8. **Scrie** `lastRunAt`, `lastSummary`, `lastError` pe user.

---

## 5. Alte fluxuri importante

### 5.1 Cron TP/SL pe poziții manuale live (`runAiPilotManualLiveForUser`)

- Rulează independent de toggle-urile AI Pilot (`user.manualLiveTpsl`).
- Ia pozițiile manuale **live** (non-paper) care au `liveProtections` salvate.
- Pentru fiecare pereche: ia prețul spot; dacă atinge SL sau TP, execută
  `executeManualTrade` side=`sell`, `fullExit: true`, `mode: "real"`.
- La vânzare reușită, șterge protecțiile pentru acea pereche.
- Este securitatea de bază pe pozițiile live deschise de AI Pilot (sau manual).

### 5.1.1 Eliminare „praf” din carte (`POST /api/live/discard`)

Binance respinge vânzările sub `LOT_SIZE` (pasul minim al cantității) sau sub
`MIN_NOTIONAL` (valoare minimă în cotă). După mai multe vânzări parțiale sau
după conversii pe Binance, în cartea aplicației poate rămâne o cantitate
reziduală care nu mai poate fi vândută — „praf”. Atâta timp cât poziția există
în `manualSpotBook`, AI Pilot și cron-ul TP/SL vor continua să încerce să o
vândă și vor salva tranzacții `failed` degeaba.

Helperul comun este `server/trading/discard-position.js`:

- `verifyRealDust({ apiKey, secret, pair, qty, price? })` încarcă piața spot
  Binance și folosește `spotMaxSellableBaseFromFree` → `dust: true` când
  vânzarea e imposibilă.
- `discardManualPosition({ userId, pair, force?, verifyDust?, source, reason })`
  șterge poziția din `manualSpotBook` și `liveProtections[pair]` și creează un
  `Trade { status: "cancelled", meta.discard: true, meta.source, meta.reason }`.

Endpoint `POST /api/live/discard` (schema `liveDiscardSchema`, `source = user_manual`):

- Payload: `{ pair, force? }`.
- `paper`: se șterge necondiționat.
- `real` fără `force`: dacă Binance acceptă încă o vânzare (`sellable > 0`)
  cererea e respinsă cu `Poziția NU e praf — folosește „Închide poziția”`.
- `real` cu `force: true`: elimină necondiționat (poziția rămâne pe Binance
  dacă există acolo — userul o vinde / convertește manual).

Butoanele „Elimină praf” apar în `AiPilotTradesColumn` (pagina AI Pilot) și în
`LiveTradingPanel` (pagina Live) lângă „Închide poziția”, cu confirmare din
browser înainte de apel.

#### Auto-cleanup în AI Pilot (`maybeAutoDiscardDust`)

Pentru a evita tranzacții `failed` repetate pe aceeași poziție praf, toate
cele trei puncte unde pilotul emite market sells reale fac preflight:

| Flux | `meta.source` |
|---|---|
| Faza 1 „vânzări manuale” din `runAiPilotForUser` | `pilot_manual_sell` |
| TP/SL la minut din `runManualLiveProtectionsTick` | `pilot_live_tpsl` |
| AI peste poziții live din `runAiPilotManualLiveAiForUser` | `pilot_live_ai_sell` |

Preflight-ul:

1. Sare peste perechi paper / fără chei API (lăsăm fluxul normal să decidă).
2. Rulează `verifyRealDust`. Dacă `dust: true`, apelează `discardManualPosition`
   cu `force: true, verifyDust: false, reason: "dust_auto_cleanup"`.
3. Raportează în `applied[]` cu `detail: "dust_auto_discarded"` și NU mai
   execută `executeManualTrade` (nu se mai salvează `failed` în DB).

Efectul: prima rulare pe care detectăm praful îl elimină silențios din carte;
rulările următoare nu mai au ce să încerce pe acea pereche.

### 5.1.2 Protecție SL/TP realtime prin OCO pe Binance

Cron-ul `runManualLiveProtectionsTick` rulează la 1 min și poate rata spike-uri
scurte (sub 60s) care ating SL/TP. Pentru a elimina această fereastră de risc,
aplicația plasează **ordine OCO** (One-Cancels-the-Other) direct pe Binance ori
de câte ori există SL **și** TP pe o poziție spot reală. OCO-ul declanșează
execuția pe exchange sub-secundă, independent de uptime-ul serverului.

#### Helper `server/trading/binance-oco.js`

- `placeSpotOcoSell({ apiKey, secret, pair, qty, stopLoss, takeProfit })` plasează
  un OCO SELL pe cantitatea curentă. Prețurile sunt aliniate la `PRICE_FILTER.tickSize`
  și `LOT_SIZE.stepSize`; `stopLimitPrice = stopPrice × 0.998` (buffer 0.2% ca SL-ul
  să fill-uiască și în spike-uri rapide). Validează `MIN_NOTIONAL` pentru ambele leg-uri.
- `cancelSpotOco({ apiKey, secret, pair, orderListId })` anulează OCO-ul după
  `orderListId`. Tolerant la „deja cancel/filled” (tratat ca `alreadyGone: true`).
- `fetchOcoStatus({ apiKey, secret, pair, orderListId })` verifică pe Binance
  dacă OCO-ul mai e activ (`EXECUTING`) sau s-a finalizat.
- `fetchOcoFillDetails({ apiKey, secret, pair, stopOrderId, limitOrderId })`
  citește ambele leg-uri și returnează `{ filledQty, avgPrice, trigger: "sl" | "tp" }`.

#### Orchestrare prin `server/trading/live-protection-sync.js`

Un singur entry point centralizează logica de place/cancel:

- `syncLiveProtectionOco({ userId, pair, reason, forceReplace? })` compară starea
  din DB cu ce trebuie să existe:
  - *Paper / fără chei API / fără SL sau TP / qty ≈ 0* → cancel OCO dacă există,
    fără replacement.
  - *SL + TP prezente* → dacă OCO-ul curent coincide pe qty + prețuri și e încă
    activ, îl păstrăm; altfel cancel + place nou.
  - Scrie rezultatul în `user.liveProtections[pair].oco`.
- `cancelLiveProtectionOco({ userId, pair })` anulează doar OCO-ul și curăță
  referința; păstrează `stopLoss` / `takeProfit` pentru a putea fi re-plasate.

#### Schema `user.liveProtections[pair]`

```json
{
  "stopLoss": 0.42,
  "takeProfit": 0.60,
  "oco": {
    "orderListId": "123456789",
    "stopOrderId": "111",
    "limitOrderId": "112",
    "placedQty": 120.5,
    "stopPrice": 0.42,
    "stopLimitPrice": 0.41916,
    "limitPrice": 0.60,
    "placedAt": "2026-04-18T12:34:56.789Z",
    "lastError": null
  },
  "ocoLastError": { "code": "BELOW_MIN_NOTIONAL", "message": "…", "at": "…" }
}
```

Când OCO nu poate fi plasat (MIN_NOTIONAL, fonduri blocate, rețea), motivul se
salvează în `ocoLastError` și UI-ul (LiveTradingPanel) afișează un banner galben.
Cron-ul la 1 min rămâne operațional — OCO e un strat suplimentar, nu un înlocuitor.

#### Hook-uri în fluxul trade-urilor

| Eveniment | Acțiune OCO |
|---|---|
| `POST /api/live/protect` (save SL / TP) | `syncLiveProtectionOco(reason: "protection_saved")` → place / replace |
| `POST /api/live/protect` (clear) | `syncLiveProtectionOco(reason: "protection_cleared")` → cancel |
| `executeManualTrade` înainte de sell real | `cancelLiveProtectionOco` → deblochează qty pe Binance |
| `executeManualTrade` după buy real | `syncLiveProtectionOco(reason: "post_buy")` → recreează pe qty totală |
| `discardManualPosition` (real) | `cancelLiveProtectionOco` → eliberează ordinul de pe exchange |

Efectul net: în orice moment în care există SL + TP și o poziție validă, Binance
deține ordinul de protecție și îl execută realtime. La orice sell (manual, AI,
close, discard), OCO-ul e anulat automat ca market sell-ul să găsească qty
liberă.

#### Reconciliere (`GET /api/cron/reconcile-oco`, */15 min)

Rulată de `server/trading/oco-reconcile.js` → `runOcoReconcileBatch`:

1. Pentru fiecare user cu `liveProtections[*].oco.orderListId`:
2. `fetchOcoStatus`. Dacă `gone: true`:
   - Citește `fetchOcoFillDetails`. Dacă există fill (`filledQty > 0`):
     - Scade `manualSpotBook[pair].qty` cu cantitatea fillată.
     - Calculează `pnl = filledQty × (avgPrice − avg cost)` și bump
       `user.stats.{totalProfit, totalTrades, winTrades}`.
     - Creează `Trade { side: "sell", status: "filled", meta.source: "oco_binance",
       meta.trigger: "sl" | "tp", meta.orderListId }`.
     - Curăță `liveProtections[pair].oco`.
   - Dacă nu există fill (anulat manual pe Binance): curăță doar `.oco`.
3. Dacă `gone: false` (încă `EXECUTING`): nothing.

Summary-ul rulării (`reconcile-oco` în `CronRunLog`) expune:
`ocoFilled`, `ocoCancelledExternally`, `ocoStillActive`, `ocoErrors`.

#### Ce NU face stratul OCO (by design)

- Nu se plasează OCO pe paper trades (nu există ordin real).
- Nu se plasează OCO dacă lipsește SL sau TP — lăsăm doar cron-ul la 1 min.
- Nu se plasează OCO sub `MIN_NOTIONAL` (Binance ar respinge oricum).
- Nu se înlocuiește cron-ul la 1 min — acesta rămâne fallback pentru cazurile în
  care OCO nu a putut fi plasat (sold, notional, rețea).

### 5.2 AI peste pozițiile live Pilot (`runAiPilotManualLiveAiForUser`)

- Rulează doar dacă `aiPilot.enabled` + `manualLiveAiEnabled` +
  `manualTradingEnabled` + `pilotOrderMode === "real"` + chei API prezente.
- Filtrează pozițiile la cele **deschise efectiv prin AI Pilot**
  (meta `aiPilotControl` pe trade).
- Rulează `runAutopilotManualLiveSellsDecide` → AI poate propune vânzări
  suplimentare (limitat la `MAX_MANUAL_LIVE_AI_SELLS_PER_RUN = 5` pe rulare).

---

## 6. Setări utilizator (`user.aiPilot`)

Expuse în UI prin `AiPilotPanel.jsx` (Settings) și API `/api/user/ai-pilot`.

| Câmp | Tip | Default | Descriere |
|---|---|---|---|
| `enabled` | bool | false | Activează AI Pilot global (cron-ul principal). |
| `intervalMinutes` | number | 15 | Throttle între rulări principale. |
| `botIds` | ObjectId[] | [] | Boții aflați sub control pilot. |
| `maxUsdcPerTrade` | number | 150 | Plafon USDC per ordin buy real. |
| `pilotOrderMode` | "paper" \| "real" | paper | Mod execuție ordine manuale + boți noi. |
| `manualTradingEnabled` | bool | false | Permite AI să facă buy/sell manual. |
| `createBotFromAnalysis` | bool | false | Permite AI să creeze bot nou. |
| `maxTradesPerRun` | number (1..20) | 3 | Plafon acțiuni noi (buy/sell/bot nou) pe rulare. |
| `maxOpenManualPositions` | number (1..20) | 3 | Plafon perechi distincte cu poziție manuală deschisă. |
| `maxPilotBots` | number (1..20) | 5 | Plafon boți creați de pilot. |
| `manualLiveAiEnabled` | bool | false | Activează cron-ul de AI peste pozițiile live. |
| `manualLiveIntervalMinutes` | number (1..30) | 1 | Throttle TP/SL live manual. |
| **Momentum Guard** | | | |
| `momentumGuardEnabled` | bool | **true** | Activează guard-ul anti-intrări târzii pe 15m. |
| `momentumGuardStrictness` | "permissive" \| "balanced" \| "strict" | balanced | Preset de praguri. |
| `momentumGuardCustomEnabled` | bool | false | Folosește pragurile numerice custom în loc de preset. |
| `momentumGuardMinLastChangePct` | number (%) | — | Urcare minimă pe ultima oră (15m×4). |
| `momentumGuardMinAccelerationPct` | number (%) | — | Decelerare tolerată (valoare negativă). |
| `momentumGuardMaxDrawdownFromHighPct` | number (%) | — | Distanță max sub vârful pe ~3h. |

Meta informații returnate la GET (read-only): `lastRunAt`, `lastSummary`,
`lastError`, `lastManualLive*` (status ultimelor rulări de cron).

---

## 7. Recomandări de tuning pentru Momentum Guard

Pentru scenariul „intrări repetate la vârf după scădere bruscă, urmate de re-entry”:

**Anti-reentry echilibrat (punct de pornire bun):**
- `Min urcare`: `0.08`
- `Decelerare tolerată`: `-0.04`
- `Max drawdown`: `4`

**Anti-reentry agresiv (dacă încă prinzi vârfuri):**
- `Min urcare`: `0.12`
- `Decelerare tolerată`: `-0.02`
- `Max drawdown`: `2.5`

**Mai permisiv (dacă ratezi intrări bune după pullback):**
- `Min urcare`: `0.05`
- `Decelerare tolerată`: `-0.06`
- `Max drawdown`: `6`

Reglaj rapid după rezultate:
- Prea multe re-entry la vârf → scade `Max drawdown` și/sau crește `Min urcare`,
  apropie `Decelerare tolerată` de 0.
- Prea puține intrări → crește `Max drawdown`, coboară puțin `Min urcare`.

---

## 8. Fișiere cheie

- `server/ai/pilot-engine.js` – orchestrator pilot (3 fluxuri).
- `server/engine/bot-runner.js` – evaluare strategie + Momentum Guard pe 15m/1d.
- `lib/ai/live-position-analyze.js` – analiză AI 15m+1d pentru SL/TP pe poziții live.
- `lib/ai/autopilot-decide.js` – prompt-ul + schema JSON a deciziei pilotului.
- `lib/ai/autopilot-manual-live-decide.js` – prompt pentru vânzări AI pe poziții live.
- `app/api/user/ai-pilot/route.js` – GET/PATCH setări (cu Zod validation).
- `lib/validations/schemas.js` – `aiPilotSettingsSchema` (Zod).
- `models/User.js` – sub-schema `aiPilot`.
- `components/AiPilotPanel.jsx` – UI setări.
- `components/AiPilotRunSummary.jsx` / `components/AiPilotTradesColumn.jsx` – vizualizare rezultate pilot.

---

## 9. Note de siguranță

- AI Pilot nu este consilier financiar. Avertismentul este obligatoriu în
  toate răspunsurile AI (schema impune `avertismente[]`).
- Modul `real` cere chei API Binance valide criptate (`apiKeyEncrypted`,
  `apiSecretEncrypted`); altfel pilotul marchează skip și salvează eroare.
- Ordinele buy manuale sunt plafonate per trade (`maxUsdcPerTrade`) și
  permise doar pe perechi din top gainers USDC sau deja deschise.
- Guard-ul Momentum este **fail-open**: când nu se poate calcula, nu blochează.
- TP/SL pe poziții live manuale rulează separat la 1 min, independent de
  rularea principală a pilotului.

# Deploy: Docker + Caddy cu Portainer

Ghid pentru a rula **aitrade** în **Docker**, cu **Caddy** (HTTPS / Let’s Encrypt) în față, gestionat prin **Portainer** (deja instalat pe server sau în cluster).

## Ce presupune acest document

- Ai **Portainer** (CE sau BE) cu acces la un **Docker environment** (local, agent pe VPS, Swarm sau Kubernetes — exemplele de mai jos sunt pentru **Docker standalone + Compose**).
- Vrei **HTTPS** automat; **Caddy v2** face reverse proxy și emite certificate (HTTP-01 pe portul **80**).
- Baza de date și secretele rămân ca în `.env.example` (ex. **MongoDB Atlas**, `JWT_SECRET`, `ENCRYPTION_KEY`, etc.).

## Două variante (alege una)

| Variantă | Când o folosești |
|----------|------------------|
| **A — Compose „solo”** (`aitrade` + `caddy` în același stack) | VPS dedicat sau singurul serviciu care ocupă **80/443** pe acel nod. |
| **B — Doar `aitrade` în Docker** | Ai deja **Caddy / Traefik / Nginx** în Portainer sau pe host; adaugi doar containerul aitrade și proxeizezi spre el. |

---

## Variantă A — Stack unic: aitrade + Caddy (recomandat pe VPS mic)

Fișiere din repo:

- `docker-compose.solo.example.yml` — servicii `aitrade` și `caddy` pe o rețea internă.
- `docs/Caddyfile.docker-solo.example` — `reverse_proxy aitrade:3000`.

### 1. DNS și firewall

- Înregistrare **A** (sau **AAAA**): `aitrade.tudomeniu.ro` → IP public al serverului.
- Pe firewall: **22** (SSH), **80**, **443** (și **443/UDP** pentru QUIC, opțional). Caddy folosește **80** pentru provizionarea certificatului.

### 2. Pregătește fișierele pe server (sau în repo)

Pe discul unde vei monta stack-ul (ex. `/opt/aitrade`):

1. Codul aplicației (clone Git sau artefact).
2. Copiază compose-ul:

   ```bash
   cp docker-compose.solo.example.yml docker-compose.yml
   ```

3. Copiază și editează **Caddyfile** (numele **site-ului** trebuie să coincidă cu DNS):

   ```bash
   cp docs/Caddyfile.docker-solo.example Caddyfile
   ```

   Înlocuiește `aitrade.example.com` cu domeniul tău real.

4. Creează **`.env.production`** din `.env.example` și completează valorile. Minimum pentru URL public:

   - `NEXT_PUBLIC_APP_URL=https://aitrade.tudomeniu.ro` (exact URL-ul final, cu `https`).

### 3. Creează stack-ul în Portainer

1. **Stacks** → **Add stack**.
2. Nume stack: ex. `aitrade`.
3. **Build method**:
   - **Web editor**: lipește conținutul din `docker-compose.solo.example.yml` (sau din `docker-compose.yml` deja editat).
   - Sau **Repository**: URL Git + **Compose path** `docker-compose.solo.example.yml` — atunci trebuie să furnizezi **Caddyfile** și env prin montări (vezi mai jos).
4. **Environment variables** (în UI Portainer): dacă **nu** folosești `env_file` pe disc, copiază aici variabilele din `.env.production` (sau folosește **Enviroment variables** doar pentru chei critice și restul în fișier montat).

**Important — `env_file: .env.production` în Compose:**  
Portainer rulează compose pe **host**-ul Docker. Fișierul `.env.production` trebuie să existe **pe host**, în același director cu `docker-compose.yml` **dacă** calea e relativă. Practic:

- Varianta simplă: la **Deployment**, setezi **working directory** pe host la `/opt/aitrade` și pornești stack-ul cu fișierele acolo; sau
- Îndepărtezi `env_file` din compose și pui toate variabilele în secțiunea **Environment** a stack-ului Portainer.

### 4. Montarea Caddyfile în stack

Compose-ul exemple montează:

```yaml
volumes:
  - ./Caddyfile:/etc/caddy/Caddyfile:ro
```

Pe host, `Caddyfile` trebuie să fie lângă fișierul compose folosit de Portainer. Dacă stack-ul e creat doar din editor web, fără fișiere pe disk, adaugă un volum **bind** cu cale absolută pe server, ex.:

```yaml
volumes:
  - /opt/aitrade/Caddyfile:/etc/caddy/Caddyfile:ro
```

### 5. Deploy și verificare

1. **Deploy the stack**.
2. Prima pornire: Caddy cere certificat (verifică logurile containerului `caddy`).
3. În Portainer: **Containers** → `aitrade-...` → **Logs** — aștepți `Ready` / fără erori Node.
4. Deschide în browser `https://aitrade.tudomeniu.ro`.

### 6. Actualizare imagine aitrade

- Din **Git** pe host: `git pull`, apoi în Portainer **Recreate** stack cu **Re-pull image** / **Rebuild** (după cum ai setat `build:`).
- Sau: **Images** → rebuild; apoi repornește doar serviciul `aitrade`.

---

## Variantă B — Portainer: doar aitrade; Caddy separat

Folosește `docker-compose.aitrade.example.yml`: containerul expune **`127.0.0.1:3002:3000`** (doar localhost pe host).

1. Deploy stack cu acest compose + `.env.production`.
2. **Caddy** rulează fie:
   - ca alt stack / container pe același server cu **`network_mode: host`** sau montând socket Docker (mai avansat), fie
   - **instalat pe host** (pachet `caddy`), fie
   - deja existent (Nginx Proxy Manager, Traefik etc.).

Exemplu bloc Caddy pe **host**, proxy spre portul mapat local — vezi `docs/caddy-Caddyfile.example`:

```caddy
aitrade.tudomeniu.ro {
	encode gzip zstd
	reverse_proxy 127.0.0.1:3002 {
		transport http {
			read_timeout 2m
			dial_timeout 30s
		}
	}
}
```

Atenție: **nu** poți avea două procese care ascultă simultan pe **80/443** pe același IP; un singur „entry point” TLS.

---

## Cron (boturi) după deploy

URL-urile trebuie să fie **HTTPS** pe același domeniu ca `NEXT_PUBLIC_APP_URL`. Exemplu pe **host** (nu în container):

```cron
* * * * * curl -fsS --max-time 120 -H "Authorization: Bearer SECRETUL_CRON" "https://aitrade.tudomeniu.ro/api/cron/run-bots" >/dev/null 2>&1
```

`SECRETUL_CRON` = valoarea `CRON_SECRET` din `.env.production`. Detalii: [`docs/easycron.md`](./easycron.md).

---

## Depanare (Portainer + Caddy)

| Simptom | Verificare |
|---------|------------|
| ACME / fără certificat | DNS **A** corect; port **80** deschis din internet; domeniul din `Caddyfile` = cel din browser. |
| **502** sau **blank** | Loguri container `aitrade`; rețea: în varianta solo, Caddy trebuie să poată rezolva hostul `aitrade`. |
| Build eșuat / OOM | Oferă **≥ 2 GB RAM** nodului de build; în Portainer verifică resursele host. |
| Env lipsă în runtime | Variabilele din `.env.production` / UI Portainer; `NEXT_PUBLIC_*` necesită **rebuild** la schimbare. |
| Conflict port 80/443 | Un singur Caddy (sau alt reverse proxy) pe acel IP pentru acele porturi. |

Validare config Caddy (în container):

```bash
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile
```

---

## Legături utile în repo

| Fișier | Rol |
|--------|-----|
| `Dockerfile` | Build Next.js `standalone`. |
| `docker-compose.solo.example.yml` | **aitrade** + **caddy** (variantă A). |
| `docker-compose.aitrade.example.yml` | Doar **aitrade** pe `127.0.0.1:3002` (variantă B). |
| `docs/Caddyfile.docker-solo.example` | Proxy spre `aitrade:3000` în rețeaua Docker. |
| `docs/caddy-Caddyfile.example` | Proxy spre `127.0.0.1:3002` (Caddy pe host). |
| `docs/deploy-digitalocean-docker-solo.md` | Bootstrap VPS (Docker, firewall, cron) fără Portainer. |

Dacă Portainer e pe **Docker Swarm**, traduce serviciile din același compose în format **stack Swarm** (rețele, volume-uri numite); principiile (Caddy în față, aitrade în spate, env) rămân la fel.

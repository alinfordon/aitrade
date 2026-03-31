# Deploy pe droplet DigitalOcean (Ubuntu)

> **VPS dedicat, doar aitrade, totul în Docker (Caddy + compose)?** Vezi ghidul separat: [`deploy-digitalocean-docker-solo.md`](./deploy-digitalocean-docker-solo.md).

Ghid pentru a rula **aitrade** (Next.js 14) pe un VPS DigitalOcean, cu **HTTPS** în față (**Caddy** sau **Nginx**), și **cron** local pentru boturi (în loc de Vercel + EasyCron).

Dacă folosești deja **Caddy v2** (ex. `caddy version` → 2.9.x), vezi **[secțiunea Caddy](#caddy-v2-reverse-proxy--https)** — nu ai nevoie de Certbot separat; certificatele TLS sunt emise automat.

## Droplet unde rulează deja Flowise (Docker)

Dacă **Flowise** e deja în Docker pe același server, cel mai simplu este să **nu** instalezi un al doilea Node global (PM2), ci să adaugi **aitrade ca alt container** și să lași **Caddy** sau **Nginx** în față să trimită traficul pe **porturi diferite** (subdomenii separate).

| Serviciu  | Exemplu acces intern | Evită |
|-----------|----------------------|--------|
| Flowise   | `127.0.0.1:3001` (sau cum ai mapat tu) | — |
| aitrade   | `127.0.0.1:3002` → container `3000` | Nu mapa ambele pe `80` / același port host |

**DNS:** subdomenii separate sunt cele mai clare — ex. `flowise.example.com` și `aitrade.example.com`, ambele **A** către același IP al dropletului.

**Caddy:** câte un bloc `nume.domeniu.tld { reverse_proxy 127.0.0.1:PORT }` — vezi `docs/caddy-Caddyfile.example`. **Nginx:** [secțiunea 10](#10-nginx--next-reverse-proxy); pentru aitrade în Docker, `proxy_pass http://127.0.0.1:3002;`.

**Fișiere în repo:**

- `Dockerfile` — imagine production (`output: standalone` când `DOCKER_BUILD=1`).
- `docker-compose.aitrade.example.yml` — fragment cu `ports: ["127.0.0.1:3002:3000"]` și `env_file: .env.production`.

Pe server, în directorul proiectului:

```bash
cp docker-compose.aitrade.example.yml docker-compose.aitrade.yml
# editează docker-compose.aitrade.yml dacă integrezi serviciul în același compose cu Flowise
cp .env.example .env.production   # apoi completează valorile reale
docker compose -f docker-compose.aitrade.yml up -d --build
```

**Resurse:** Flowise + build Next pot încărca **RAM**; un droplet **2–4 GB** e mai sigur decât 1 GB. Monitorizează `docker stats`.

**Cron** rămâne pe **host** (secțiunea 12), cu URL public `https://aitrade.example.com/...` — același Caddy/Nginx rutează spre container.

---

## Presupuneri

- **Ubuntu 22.04 sau 24.04 LTS** pe droplet.
- **MongoDB**: păstrezi **MongoDB Atlas** (ca în `.env.example`) sau alt cluster accesibil din rețea.
- **Redis**: **Upstash** (REST) — nu e nevoie de Redis instalat pe droplet.
- Domeniu cu DNS către IP-ul dropletului (ex. `aitrade.example.com`).

## Variantă A — DOAR Docker (fără Node pe host, recomandat lângă Flowise)

1. Instalezi **Docker Engine** + **Docker Compose plugin**. **Caddy**: doar dacă nu e deja (HTTPS automat — fără Certbot). Cu **Nginx**: vezi secțiunile 4, 10–11.
2. Nu execuți secțiunile 3, 8–9 (Node global, PM2) pentru aitrade; build-ul e în `docker compose build`.
3. `NEXT_PUBLIC_APP_URL` în `.env.production` = URL final **HTTPS** al aitrade.

## Variantă B — Node + PM2 pe host (fără Docker pentru aitrade)

Urmează secțiunile 3–9, apoi **Caddy** sau **Nginx+Certbot** (10–11 sau [Caddy](#caddy-v2-reverse-proxy--https)). Flowise poate rămâne în Docker (atenție la **porturi**).

## Caddy v2 (reverse proxy + HTTPS)

Potrivit pentru **Caddy 2.9.x** pe același droplet cu Flowise + aitrade.

1. **DNS:** înregistrări **A** (sau **AAAA**) pentru `aitrade.example.com` (și `flowise...`) către IP-ul VPS.
2. **Caddyfile** (ex. `/etc/caddy/Caddyfile`): include blocuri `reverse_proxy` spre `127.0.0.1` și portul mapat pe host — vezi **`docs/caddy-Caddyfile.example`** (aitrade pe `3002` cu Docker, sau `3000` cu PM2).
3. Rescrie configurația și reîncarcă:

```bash
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
# sau: caddy reload --config /etc/caddy/Caddyfile
```

4. **Firewall:** porturile **80** și **443** trebuie deschise către internet (Caddy folosește **80** pentru ACME HTTP-01 și **443** pentru site).

**Notă:** nu porni în același timp **alt** proces care ocupă `:443` / `:80` pe același IP (conflict cu Caddy).

### Exemplu minimal (aitrade în Docker pe 3002)

```caddy
aitrade.example.com {
	encode gzip zstd
	reverse_proxy 127.0.0.1:3002 {
		transport http {
			read_timeout 2m
		}
	}
}
```

## 1. Creează dropletul

1. DigitalOcean → **Create** → **Droplets**.
2. **Image**: Ubuntu LTS.
3. **Plan**: minimum **2 GB RAM** recomandat pentru `next build` stabil; 1 GB poate necesita swap.
4. **Autentificare**: SSH key.
5. **Datacenter**: alege regiune compatibilă cu **Binance API** (terminii de eligibilitate / 451).
6. Notează **IP-ul public** — îl vei folosi la **Binance API → restricții IP** și, opțional, la **Atlas → Network Access**.

## 2. Firewall (DO Cloud Firewall sau UFW)

Pe droplet:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

(Folosești **Caddy** sau **Nginx** — ambele au nevoie de **80/443** pentru HTTPS.)

## 3. Node.js (LTS 20)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs build-essential
node -v   # v20.x
```

## 4. Nginx (opțional, dacă nu folosești Caddy)

Dacă **reverse proxy** este deja **Caddy**, sari peste această secțiune și peste 10–11; folosește [Caddy v2](#caddy-v2-reverse-proxy--https).

```bash
sudo apt install -y nginx
sudo systemctl enable --now nginx
```

## 5. Utilizator de deploy (opțional, recomandat)

```bash
sudo adduser --disabled-password deploy
sudo mkdir -p /var/www/aitrade
sudo chown deploy:deploy /var/www/aitrade
```

Loghează-te ca `deploy` sau folosește `sudo -u deploy bash`.

## 6. Codul aplicației

```bash
cd /var/www/aitrade
git clone <URL_REPO> .
# sau scp/rsync din mașina locală
```

**Nu** comita fișiere `.env` cu secrete.

## 7. Variabile de mediu

Creează `/var/www/aitrade/.env.production` (sau `.env.local`) cu valorile din `.env.example`:

| Variabilă | Pe droplet |
|-----------|------------|
| `NEXT_PUBLIC_APP_URL` | `https://domeniul-tău.ro` (fix, cu HTTPS) |
| `MONGODB_URI` | connection string Atlas / Mongo |
| `JWT_SECRET`, `ENCRYPTION_KEY` | aceleași reguli ca local |
| `UPSTASH_REDIS_*` | credențiale Upstash |
| `CRON_SECRET` | string random; folosit la `curl` din cron |
| Stripe, `GEMINI_*`, etc. | completezi după nevoie |

Next încarcă `.env.production` la `next start` în modul production. După modificări la variabile, repornește procesul (`pm2 restart` sau systemd).

Generează secrete puternice pe server:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 8. Build și pornire

```bash
cd /var/www/aitrade
npm ci
npm run build
```

Test manual:

```bash
NODE_ENV=production npm run start
# ascultă pe 3000 implicit; oprești cu Ctrl+C
```

## 9. PM2 (proces persistent)

```bash
sudo npm install -g pm2
cd /var/www/aitrade
pm2 start npm --name aitrade -- start
pm2 save
pm2 startup systemd
# rulează comanda pe care o afișează pm2 (cu sudo)
```

Verificare: `pm2 logs aitrade`

## 10. Nginx → Next (reverse proxy)

*Dacă folosești **Caddy**, configurarea echivalentă e în **`docs/caddy-Caddyfile.example`**.*

Creează `/etc/nginx/sites-available/aitrade`:

```nginx
server {
    listen 80;
    server_name aitrade.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

Activează site-ul:

```bash
sudo ln -sf /etc/nginx/sites-available/aitrade /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 11. HTTPS (Let’s Encrypt) — doar cu Nginx

*Cu **Caddy**, TLS e gestionat automat de Caddy; nu instala Certbot pentru același host.*

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d aitrade.example.com
```

Certbot modifică serverul pentru `listen 443 ssl`.

## 12. Cron: boturi + (opțional) ai-optimize

Pe droplet nu există Vercel Cron; folosește **cron** de sistem.

Editează crontab (`crontab -e` ca utilizatorul care rulează aplicația sau root, în funcție de cum rulezi `curl`):

```cron
# Rulează batch-ul de boturi la fiecare minut
* * * * * curl -fsS --max-time 120 -H "Authorization: Bearer SECRETUL_CRON" "https://aitrade.example.com/api/cron/run-bots" >/dev/null 2>&1

# Optimizare AI zilnic (02:00 UTC) — același pattern ca vercel.json
0 2 * * * curl -fsS --max-time 300 -H "Authorization: Bearer SECRETUL_CRON" "https://aitrade.example.com/api/cron/ai-optimize" >/dev/null 2>&1
```

Înlocuiește `SECRETUL_CRON` cu valoarea **exactă** din `CRON_SECRET` (fără a lăsa secretul în loguri publice — ideal crontab utilizator dedicat, permisiuni stricte).

**EasyCron** nu mai e obligatoriu dacă folosești cron local; păstrează același header `Authorization: Bearer …`.

## 13. Checklist după deploy

1. **Atlas**: adaugă IP-ul dropletului în **Network Access** (sau regula existentă permite conexiunea).
2. **Binance**: în API key, restricție IP → **IP public al dropletului** (sau „Unrestricted” doar pentru test).
3. **Stripe**: webhook URL spre `https://domeniu/api/...` (rutele reale din proiect).
4. Deschide aplicația în browser, login, test **wallet** / tranzacție paper.
5. `pm2 logs` fără erori repetate la conectare Mongo / Redis.

## 14. Actualizări (deploy nou)

```bash
cd /var/www/aitrade
git pull
npm ci
npm run build
pm2 restart aitrade
```

## 15. Depanare scurtă

| Simptom | Direcție |
|--------|----------|
| 502 Bad Gateway | `pm2 status` / `docker ps`; Next nu rulează sau port greșit în Caddyfile / Nginx. |
| Mongo timeout | Firewall Atlas / IP droplet / `MONGODB_URI`. |
| 401 la `/api/cron/*` | `CRON_SECRET` în `.env` identic cu `Bearer` din crontab. |
| Binance 451 | Regiune / eligibilitate; vezi mesajele din app despre IP egress (pe droplet IP-ul e de obicei stabil). |

## Notă despre `vercel.json`

Fișierul `vercel.json` din repo configurează cron doar pentru **Vercel**. Pe droplet **ignori** acea integrare și folosești secțiunea **Cron** de mai sus.

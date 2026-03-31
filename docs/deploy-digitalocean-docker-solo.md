# Deploy pe DigitalOcean — VPS dedicat, doar aitrade (Docker)

Ghid pentru un **singur droplet** pe care rulează **doar** aitrade: aplicația în **Docker**, **Caddy** în același `docker-compose` pentru **HTTPS automat** (Let’s Encrypt). Fără Flowise, fără PM2 pe host.

## Cerințe

- **Ubuntu 22.04 / 24.04 LTS**
- **Minimum 2 GB RAM** pe droplet (build-ul Next.js în Docker consumă memorie; 1 GB duce des la eșec la `build` sau la OOM)
- Domeniu (ex. `aitrade.example.com`) cu înregistrare **A** către IP-ul public al dropletului
- **MongoDB Atlas** (sau Mongo accesibil din rețea) și restul variabilelor din `.env.example`

## 1. Droplet și DNS

1. Creează dropletul (Ubuntu, **2 GB+** RAM).
2. În DNS: `A` pentru `aitrade.example.com` → IP droplet (propagarea poate dura câteva minute).

## 2. Firewall

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

## 3. Docker Engine + Compose

```bash
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${VERSION_CODENAME:-$VERSION}") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
# deconectează-te și reconectează-te SSH ca grupul docker să fie activ
```

## 4. Cod și variabile

```bash
sudo mkdir -p /opt/aitrade
sudo chown "$USER:$USER" /opt/aitrade
cd /opt/aitrade
git clone <URL_REPO> .
```

Creează `.env.production` (nu comita acest fișier):

```bash
cp .env.example .env.production
nano .env.production
```

Obligatoriu pentru URL public:

- `NEXT_PUBLIC_APP_URL=https://aitrade.example.com` (domeniul tău real, cu **https**)

Completează `MONGODB_URI`, `JWT_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`, Upstash, Stripe, Gemini etc. după nevoie.

## 5. Caddyfile și Compose

```bash
cp docker-compose.solo.example.yml docker-compose.yml
cp docs/Caddyfile.docker-solo.example Caddyfile
nano Caddyfile
```

În `Caddyfile`, schimbă `aitrade.example.com` în domeniul tău **exact** cum apare în DNS.

## 6. Pornire

```bash
cd /opt/aitrade
docker compose build
docker compose up -d
docker compose ps
docker compose logs -f aitrade
```

La prima rulare, Caddy obține certificatul TLS (necesită ca **portul 80** să fie liber și DNS deja propagat).

## 7. Cron (boturi) pe host

EasyCron nu e obligatoriu; pe VPS poți folosi **cron** local care apelează URL-ul public (același domeniu HTTPS):

```bash
crontab -e
```

```cron
* * * * * curl -fsS --max-time 120 -H "Authorization: Bearer SECRETUL_DIN_CRON_SECRET" "https://aitrade.example.com/api/cron/run-bots" >/dev/null 2>&1
0 2 * * * curl -fsS --max-time 300 -H "Authorization: Bearer SECRETUL_DIN_CRON_SECRET" "https://aitrade.example.com/api/cron/ai-optimize" >/dev/null 2>&1
```

Înlocuiește domeniul și secretul.

## 8. Actualizare aplicație

```bash
cd /opt/aitrade
git pull
docker compose build aitrade
docker compose up -d aitrade
```

Dacă ai schimbat `Caddyfile`:

```bash
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile
docker compose up -d caddy
```

## 9. Depanare

| Problemă | Ce să verifici |
|----------|-----------------|
| Build eșuează / container se oprește | `docker compose logs aitrade`; mărește RAM droplet. |
| Fără HTTPS / ACME eșuează | DNS `A` corect; port **80** deschis; domeniul din `Caddyfile` = cel din DNS. |
| 502 la site | `docker compose ps`; `aitrade` trebuie **healthy** pe rețea; vezi loguri. |
| 401 pe `/api/cron/*` | `CRON_SECRET` în `.env.production` = `Bearer` din `curl`. |
| Binance 451 | Eligibilitate geografică / IP; vezi mesajele din app. |

## 10. Fișiere relevante în repo

| Fișier | Rol |
|--------|-----|
| `Dockerfile` | Imagine Next.js `standalone`. |
| `docker-compose.solo.example.yml` | Șablon `aitrade` + `caddy`. |
| `docs/Caddyfile.docker-solo.example` | Reverse proxy spre serviciul `aitrade:3000`. |

## Varianta fără Caddy în Docker

Dacă preferi **Caddy instalat pe host** (pachet nativ): folosește `docker-compose.aitrade.example.yml` cu `ports: "127.0.0.1:3002:3000"` și un Caddyfile pe host care face `reverse_proxy 127.0.0.1:3002` — vezi `docs/caddy-Caddyfile.example`. Pe VPS dedicat acest ghid rămâne însă cel mai simplu: tot în compose.

**Portainer:** același layout (compose + Caddy) poate fi pornit ca stack din UI — vezi [`deploy-docker-portainer-caddy.md`](./deploy-docker-portainer-caddy.md).

#!/bin/bash
set -e

# ==== 1️⃣ Variabile ====
GIT_REPO="https://github.com/alinfordon/aitrade.git"  # schimbă cu repo-ul tău
APP_NAME="ai-trade"
DOMAIN="aitrade.sgdev.ro"  # subdomeniu
EMAIL="alinfordon@gmail.com"    # email pentru Let's Encrypt

# ==== 2️⃣ Instalare dependințe ====
sudo apt update
sudo apt install -y git curl docker.io docker-compose nginx certbot python3-certbot-nginx

# ==== 3️⃣ Clone proiect ====
cd /var/www
if [ ! -d "$APP_NAME" ]; then
    sudo git clone $GIT_REPO
fi
cd $APP_NAME

# ==== 4️⃣ Creare structura foldere ====
mkdir -p nginx certs

# ==== 5️⃣ Dockerfile ====
cat > Dockerfile <<EOF
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install pm2 -g
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["pm2-runtime", "start", "npm", "--name", "next-app", "--", "start"]
EOF

# ==== 6️⃣ Nginx config (HTTP doar pentru Certbot inițial) ====
cat > nginx/default.conf <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://next-app:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

# ==== 7️⃣ Docker Compose ====
cat > docker-compose.yml <<EOF
version: "3.9"
services:
  next-app:
    build: .
    container_name: next-app
    restart: unless-stopped
    ports:
      - "3000:3000"

  nginx:
    image: nginx:latest
    container_name: nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
      - ./certs:/etc/letsencrypt
    depends_on:
      - next-app
EOF

# ==== 8️⃣ Pornire containere ====
sudo docker-compose up -d --build

# ==== 9️⃣ Obține SSL Certbot ====
sudo certbot certonly --webroot -w $(pwd)/certs -d $DOMAIN --email $EMAIL --agree-tos --non-interactive

# ==== 10️⃣ Actualizare Nginx config SSL ====
cat > nginx/default.conf <<EOF
server {
    listen 443 ssl;
    server_name $DOMAIN;

    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;

    location / {
        proxy_pass http://next-app:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}

server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$host\$request_uri;
}
EOF

# ==== 11️⃣ Repornește Nginx ====
sudo docker-compose restart nginx

echo "✅ Setup complet! Accesează https://$DOMAIN"
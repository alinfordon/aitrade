#!/bin/bash

set -e

APP_NAME="aitrade"
DOMAIN="aitrade.sgdev.ro"
REPO_URL="https://github.com/alinfordon/aitrade.git"
APP_PORT="3000"
APP_DIR="/var/www/$APP_NAME"

echo "===> Update sistem"
sudo apt update && sudo apt upgrade -y


echo "===> Instalare dependinte"
sudo apt install -y \
  git \
  curl \
  nginx \
  certbot \
  python3-certbot-nginx \
  docker.io \
  docker-compose


echo "===> Pornire Docker"
sudo systemctl enable docker
sudo systemctl start docker


echo "===> Adaug user in grupul docker"
sudo usermod -aG docker $USER


echo "===> Curatare folder aplicatie"
sudo rm -rf "$APP_DIR"
sudo mkdir -p /var/www
sudo chown -R $USER:$USER /var/www


echo "===> Clone repo"
git clone "$REPO_URL" "$APP_DIR"

cd "$APP_DIR"


echo "===> Oprire procese existente pe port $APP_PORT"
sudo fuser -k ${APP_PORT}/tcp || true


echo "===> Stergere containere vechi"
sudo docker-compose down || true
sudo docker rm -f next-app nginx || true


echo "===> Creare docker-compose.yml"
cat > docker-compose.yml <<EOF
version: '3.9'

services:
  next-app:
    container_name: next-app
    build: .
    restart: always
    ports:
      - "3000:3000"

  nginx:
    image: nginx:latest
    container_name: nginx
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf
      - /etc/letsencrypt:/etc/letsencrypt
    depends_on:
      - next-app
EOF


echo "===> Creare Dockerfile"
cat > Dockerfile <<EOF
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
EOF


echo "===> Creare configurare Nginx"
mkdir -p nginx

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


echo "===> Build si start containere"
sudo docker-compose up -d --build


echo "===> Pornire Nginx local daca nu ruleaza"
sudo systemctl restart nginx || true


echo "===> Generare SSL"
sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m admin@$DOMAIN --redirect


echo "===> Restart containere"
sudo docker-compose restart


echo "=========================================="
echo "Deploy finalizat"
echo "Verificare:"
echo "sudo docker ps"
echo "sudo docker-compose logs -f"
echo "https://$DOMAIN"
echo "=========================================="
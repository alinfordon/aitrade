#!/bin/bash
# Script automat NextJS + PM2 + Nginx + HTTPS
APP_NAME="next-app"
APP_DIR="/var/www/aitrade"
PORT=3010
DOMAIN="aitrade.sgdev.ro"
NGINX_CONF="/etc/nginx/sites-available/$APP_NAME"

echo "1️⃣ Actualizare și instalare PM2 dacă nu există..."
npm install -g pm2

echo "2️⃣ Pornește aplicația NextJS cu PM2 pe portul $PORT..."
cd $APP_DIR || exit 1

# Oprește aplicația dacă rulează deja
pm2 delete $APP_NAME 2>/dev/null

# Pornește aplicația pe portul 3010
pm2 start npm --name "$APP_NAME" -- start -- -p $PORT

# Salvează configurarea PM2 pentru restart la boot
pm2 save
pm2 startup systemd -u $USER --hp $HOME

echo "3️⃣ Configurare Nginx pentru HTTP (temporar)..."
cat > $NGINX_CONF <<EOL
server {
    listen 80;
    listen [::]:80;

    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }

    root /var/www/html;
    index index.html index.htm;
}
EOL

# Activează config-ul dacă nu există link simbolic
if [ ! -L "/etc/nginx/sites-enabled/$APP_NAME" ]; then
    ln -s $NGINX_CONF /etc/nginx/sites-enabled/
fi

echo "4️⃣ Verificare configurație Nginx..."
sudo nginx -t

echo "5️⃣ Reîncărcare Nginx..."
sudo systemctl restart nginx

echo "6️⃣ Instalare Certbot pentru HTTPS..."
sudo apt update
sudo apt install -y certbot python3-certbot-nginx

echo "7️⃣ Obținere certificat HTTPS Let's Encrypt..."
sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m your-email@example.com

echo "✅ Aplicația '$APP_NAME' este live cu HTTPS pe https://$DOMAIN"
pm2 status

echo ""
echo "8️⃣ Cron pe VPS (opțional): vezi docs/vps-crontab.md și scripts/vps-cron.sh"
echo "   Exemplu: curl -H \"Authorization: Bearer \$CRON_SECRET\" http://127.0.0.1:$PORT/api/cron/run-bots"
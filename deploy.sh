#!/bin/bash
# deploy.sh — script automat pentru VPS

# Configurari
APP_DIR="/var/www/aitrade"
BRANCH="main"
APP_NAME="next-app"
PORT=3010

# 1?? Navigheaza în directorul aplica?iei
cd $APP_DIR || exit
echo "?? Fixing permissions..."
sudo chown -R $USER:$USER $APP_DIR
find $APP_DIR -type d -exec chmod 777 {} \;
find $APP_DIR -type f -exec chmod 777 {} \;

# 2?? Asigura-te ca Git ?tie ca directorul e sigur
git config --global --add safe.directory $APP_DIR

# 3?? Preia ultimele update-uri ?i reseteaza branch-ul curent
git fetch --all
git reset --hard origin/$BRANCH

# 4?? Instaleaza dependen?ele
npm install

# 5?? Build Next.js
npm run build

# 6?? Opre?te vechiul proces PM2 (daca exista)
pm2 delete $APP_NAME >/dev/null 2>&1 || true

# 7?? Porne?te aplica?ia cu PM2 pe portul corect
PORT=$PORT pm2 start npm --name "$APP_NAME" -- start

# 8?? Salveaza procesul PM2 pentru restart automat la reboot
pm2 save

echo "? Deploy complet. Next.js ruleaza pe port $PORT cu PM2."
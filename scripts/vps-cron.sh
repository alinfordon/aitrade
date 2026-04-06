#!/usr/bin/env bash
# Apel local job-uri cron (aceleași rute ca EasyCron/Vercel).
# Pe VPS: curl către Next ascuns în spatele Nginx (127.0.0.1:PORT).
#
# Instalare:
#   chmod +x scripts/vps-cron.sh
#   # În crontab: setezi APP_ROOT / BASE_URL sau lași valorile implicite
#
# Exemplu crontab (dockeră editare: crontab -e):
#   APP_ROOT=/var/www/aitrade BASE_URL=http://127.0.0.1:3010 * * * * * /var/www/aitrade/scripts/vps-cron.sh run-bots
#   (exemplu: 5 câmpuri cron — minut oră zi lună dow; loghează cu >>/var/log/aitrade-cron.log 2>&1)
#   APP_ROOT=... */15 * * * * .../vps-cron.sh ai-pilot
#   APP_ROOT=... 0 2 * * * .../vps-cron.sh ai-optimize
#
# CRON_SECRET: exportă în linia de crontab (recomandat) sau lasă scriptul să îl citească din .env.production:
#   CRON_SECRET=xxx * * * * * ...

set -euo pipefail

APP_ROOT="${APP_ROOT:-/var/www/aitrade}"
BASE_URL="${BASE_URL:-http://127.0.0.1:3010}"

load_cron_secret_from_env_file() {
  local f val line
  for f in "$APP_ROOT/.env.production" "$APP_ROOT/.env.local" "$APP_ROOT/.env"; do
    [ -f "$f" ] || continue
    line="$(grep -E '^[[:space:]]*CRON_SECRET=' "$f" | tail -1)" || continue
    val="${line#*=}"
    val="$(printf '%s' "$val" | tr -d '\r')"
    val="${val#"${val%%[![:space:]]*}"}"
    val="${val%"${val##*[![:space:]]}"}"
    if [ "${val:0:1}" = '"' ] && [ "${val: -1}" = '"' ]; then val="${val:1:-1}"; fi
    if [ "${val:0:1}" = "'" ] && [ "${val: -1}" = "'" ]; then val="${val:1:-1}"; fi
    if [ -n "$val" ]; then
      printf '%s' "$val"
      return 0
    fi
  done
  return 1
}

if [ -z "${CRON_SECRET:-}" ]; then
  CRON_SECRET="$(load_cron_secret_from_env_file)" || true
fi

if [ -z "${CRON_SECRET:-}" ]; then
  echo "vps-cron.sh: setează CRON_SECRET (mediu) sau definește CRON_SECRET în \$APP_ROOT/.env.production" >&2
  exit 1
fi

ACTION="${1:-}"
TIMEOUT="120"
PATH_SUFFIX=""

case "$ACTION" in
  run-bots)
    PATH_SUFFIX="/api/cron/run-bots"
    TIMEOUT="${TIMEOUT_RUN_BOTS:-120}"
    ;;
  ai-pilot)
    PATH_SUFFIX="/api/cron/ai-pilot"
    TIMEOUT="${TIMEOUT_AI_PILOT:-180}"
    ;;
  ai-optimize)
    PATH_SUFFIX="/api/cron/ai-optimize"
    TIMEOUT="${TIMEOUT_AI_OPTIMIZE:-300}"
    ;;
  *)
    echo "Utilizare: $0 run-bots | ai-pilot | ai-optimize" >&2
    exit 2
    ;;
esac

# Fără slash dublu
BASE_URL="${BASE_URL%/}"

exec curl -fsS --max-time "$TIMEOUT" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Accept: application/json" \
  "${BASE_URL}${PATH_SUFFIX}"

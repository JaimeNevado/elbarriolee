#!/bin/bash
# Arranca el panel de edición de El Barrio (si no está ya en marcha) y lo abre en Chrome.
# Lo usa el icono «El Barrio - Panel» del escritorio; se crea con scripts/crear-app.sh.

DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT=3100
URL="http://localhost:$PORT/#/admin"
LOG="$HOME/Library/Logs/elbarrio-panel.log"

# Las apps del Finder no cargan el PATH de la Terminal: se busca Node en los sitios habituales.
NODE="$(command -v node)"
for candidate in "$HOME/.local/node/bin/node" /opt/homebrew/bin/node /usr/local/bin/node; do
  [ -z "$NODE" ] && [ -x "$candidate" ] && NODE="$candidate"
done
if [ -z "$NODE" ]; then
  echo "No encuentro Node en este ordenador." >&2
  exit 1
fi

panel_running() { curl -s "http://127.0.0.1:$PORT/api/admin" | grep -q '"local":true'; }

if ! panel_running; then
  cd "$DIR" || exit 1
  ADMIN_LOCAL=1 PORT=$PORT nohup "$NODE" server.js >> "$LOG" 2>&1 < /dev/null &
  for _ in $(seq 1 40); do
    panel_running && break
    sleep 0.25
  done
  if ! panel_running; then
    echo "El panel no ha arrancado. Detalles en $LOG" >&2
    exit 1
  fi
fi

open -a "Google Chrome" "$URL" 2>/dev/null || open "$URL"

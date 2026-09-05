#!/usr/bin/env bash
#
# ResInvest ERP — uruchomienie serwera aplikacji.
#
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "[BŁĄD] Brak pliku konfiguracyjnego. Uruchom najpierw ./instaluj.sh"
  exit 1
fi

PORT="$(grep -E '^PORT=' .env | cut -d= -f2 || true)"
PORT="${PORT:-4173}"
URL="http://localhost:${PORT}"

echo
echo "  ResInvest ERP uruchamia się…"
echo "  Adres: ${URL}"
echo "  Zatrzymanie: Ctrl+C"
echo

# Otwarcie przeglądarki, gdy serwer odpowie (bez blokowania startu).
(
  for _ in $(seq 1 30); do
    if curl -sf "${URL}/api/v1/health" >/dev/null 2>&1; then
      (xdg-open "$URL" >/dev/null 2>&1 || open "$URL" >/dev/null 2>&1) || true
      break
    fi
    sleep 1
  done
) &

exec node --disable-warning=ExperimentalWarning server/src/index.js

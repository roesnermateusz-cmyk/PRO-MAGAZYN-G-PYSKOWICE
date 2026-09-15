#!/usr/bin/env bash
#
# ResInvest ERP — instalacja na Linuksie i macOS.
#
set -euo pipefail
cd "$(dirname "$0")"

BOLD=$'\033[1m'; GREEN=$'\033[32m'; RED=$'\033[31m'; RESET=$'\033[0m'

echo
echo "${BOLD}============================================================${RESET}"
echo "${BOLD}  ResInvest ERP — Magazyn Biomasy · instalacja${RESET}"
echo "${BOLD}============================================================${RESET}"
echo

# ---------- 1. Środowisko Node.js ----------
if ! command -v node >/dev/null 2>&1; then
  echo "${RED}[BŁĄD]${RESET} Nie znaleziono środowiska Node.js."
  echo "       Zainstaluj Node.js 22 LTS lub nowszy: https://nodejs.org/pl"
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "${RED}[BŁĄD]${RESET} Wymagany Node.js 22 lub nowszy (znaleziono $(node -v))."
  exit 1
fi
echo "${GREEN}[OK]${RESET} Node.js $(node -v)"

# ---------- 2. Plik konfiguracyjny ----------
if [ ! -f .env ]; then
  cp .env.example .env
  SECRET="$(node -e 'console.log(require("crypto").randomBytes(48).toString("base64url"))')"
  ADMPASS="Res-$(node -e 'console.log(require("crypto").randomBytes(4).toString("hex"))')-2026A"

  node -e "
    const fs = require('fs');
    let t = fs.readFileSync('.env', 'utf8');
    t = t.replace(/^AUTH_SECRET=.*\$/m, 'AUTH_SECRET=$SECRET');
    t = t.replace(/^BOOTSTRAP_ADMIN_PASSWORD=.*\$/m, 'BOOTSTRAP_ADMIN_PASSWORD=$ADMPASS');
    fs.writeFileSync('.env', t);
  "
  chmod 600 .env

  echo "${GREEN}[OK]${RESET} Utworzono plik .env z unikalnym kluczem bezpieczeństwa."
  echo
  echo "  ------------------------------------------------------------"
  echo "  ${BOLD}DANE PIERWSZEGO LOGOWANIA — ZAPISZ JE TERAZ${RESET}"
  echo "  ------------------------------------------------------------"
  echo "    Login : admin@resinvest.local"
  echo "    Hasło : ${BOLD}${ADMPASS}${RESET}"
  echo "  (hasło zostanie zmienione przy pierwszym logowaniu)"
  echo "  ------------------------------------------------------------"
  echo
else
  echo "${GREEN}[OK]${RESET} Plik .env już istnieje — konfiguracja zachowana."
fi

# ---------- 3. Baza danych ----------
echo "  Przygotowywanie bazy danych…"
node --disable-warning=ExperimentalWarning server/scripts/migrate.mjs

# ---------- 4. Dane testowe ----------
read -r -p "  Wgrać przykładowe dane testowe? (t/N): " SEED
if [[ "${SEED,,}" == "t" ]]; then
  node --disable-warning=ExperimentalWarning server/scripts/seed.mjs
fi

chmod +x start.sh kopia-zapasowa.sh 2>/dev/null || true

echo
echo "${BOLD}============================================================${RESET}"
echo "  ${GREEN}INSTALACJA ZAKOŃCZONA${RESET}"
echo
echo "  Uruchomienie systemu:   ./start.sh"
echo "  Adres aplikacji:        http://localhost:4173"
echo
echo "  Usługa systemowa (serwer firmowy): patrz docs/DEPLOYMENT.md"
echo "${BOLD}============================================================${RESET}"
echo

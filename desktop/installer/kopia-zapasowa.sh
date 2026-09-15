#!/usr/bin/env bash
#
# ResInvest ERP — kopia zapasowa danych (do wpięcia w crona).
#
#   0 22 * * *  /opt/resinvest-erp/kopia-zapasowa.sh >> /var/log/resinvest-backup.log 2>&1
#
set -euo pipefail
cd "$(dirname "$0")"

echo "=== Kopia zapasowa ResInvest ERP · $(date '+%Y-%m-%d %H:%M:%S') ==="
node --disable-warning=ExperimentalWarning server/scripts/backup.mjs --json
echo
echo "ZALECENIE: katalog data/ (baza + skany dokumentów) należy objąć"
echo "firmową kopią zapasową na osobnym nośniku."

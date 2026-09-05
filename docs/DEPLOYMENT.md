# Wdrożenie i utrzymanie

Trzy scenariusze: stanowisko desktopowe, serwer firmowy z dostępem z telefonów,
dostęp przez internet.

---

## 1. Stanowisko desktopowe (Windows)

Najprostszy wariant — jeden komputer w biurze magazynu.

1. Zainstaluj **Node.js 22 LTS** — <https://nodejs.org/pl> (opcje domyślne).
2. Rozpakuj `ResInvest-ERP-1.0.0.zip`, np. do `C:\ResInvest-ERP`.
   Nie uruchamiaj plików z wnętrza archiwum.
3. Uruchom `INSTALUJ.bat`.
   Skrypt tworzy `.env` z unikalnym kluczem `AUTH_SECRET`, zakłada bazę,
   proponuje dane testowe i tworzy skrót na pulpicie.
4. **Zapisz wyświetlone dane pierwszego logowania.**
5. Uruchom `START.bat` (albo skrót z pulpitu) — przeglądarka otworzy
   `http://localhost:4173`.

### Automatyczny start z systemem

Skrót do `START.bat` w katalogu autostartu:

```
Win+R  →  shell:startup  →  wklej skrót
```

### Cykliczna kopia zapasowa

Harmonogram zadań Windows → nowe zadanie codzienne o 22:00 →
uruchom `C:\ResInvest-ERP\KOPIA-ZAPASOWA.bat`.

---

## 2. Serwer firmowy z dostępem z telefonów

Wariant dla pracy w terenie: magazynierzy wprowadzają dokumenty z telefonu,
biuro pracuje na komputerach.

### 2.1 Instalacja (Linux)

```bash
sudo mkdir -p /opt/resinvest-erp && cd /opt/resinvest-erp
sudo unzip ~/ResInvest-ERP-1.0.0.zip -C /opt/resinvest-erp --strip-components=1
sudo chown -R resinvest:resinvest /opt/resinvest-erp
./instaluj.sh
```

### 2.2 Konfiguracja sieci

W pliku `.env`:

```ini
HOST=0.0.0.0          # nasłuch na wszystkich interfejsach
PORT=4173
NODE_ENV=production
AUTH_SECRET=<48 losowych bajtów base64url>
```

Adres dla telefonów: `http://<adres-IP-serwera>:4173`.
Adres IP warto zarezerwować na routerze (przypisanie statyczne po MAC).

> **Ważne:** `HOST=0.0.0.0` udostępnia system całej sieci lokalnej. Stosuj
> wyłącznie w sieci firmowej, nigdy bez zapory na łączu publicznym.

### 2.3 Usługa systemd

`/etc/systemd/system/resinvest-erp.service`:

```ini
[Unit]
Description=ResInvest ERP — magazyn biomasy
After=network.target

[Service]
Type=simple
User=resinvest
WorkingDirectory=/opt/resinvest-erp
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server/src/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

# Zabezpieczenia procesu
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/resinvest-erp/data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now resinvest-erp
sudo systemctl status resinvest-erp
journalctl -u resinvest-erp -f          # dziennik na żywo (JSON Lines)
```

### 2.4 Kopia zapasowa w cronie

```cron
0 22 * * *  /opt/resinvest-erp/kopia-zapasowa.sh >> /var/log/resinvest-backup.log 2>&1
```

Katalog `data/` (baza, skany, kopie) **musi** być objęty firmową kopią zapasową
na osobnym nośniku — NAS, dysk zewnętrzny albo chmura.

---

## 3. Dostęp przez internet

Wymaga szyfrowania. Aplikacja nasłuchuje lokalnie, a HTTPS obsługuje reverse proxy.

### Caddy (najprościej — certyfikat automatycznie)

```caddy
magazyn.firma.pl {
    reverse_proxy 127.0.0.1:4173
    encode gzip
}
```

### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name magazyn.firma.pl;

    ssl_certificate     /etc/letsencrypt/live/magazyn.firma.pl/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/magazyn.firma.pl/privkey.pem;

    client_max_body_size 20M;          # załączniki (skany)

    location / {
        proxy_pass http://127.0.0.1:4173;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

W `.env` pozostaw `HOST=127.0.0.1` — do aplikacji ma docierać wyłącznie ruch
z proxy. `X-Forwarded-For` jest uwzględniany przy zapisie adresu IP w audycie.

---

## 4. Aktualizacja wersji

```bash
# 1. Kopia zapasowa — zawsze przed aktualizacją
./kopia-zapasowa.sh

# 2. Zatrzymanie
sudo systemctl stop resinvest-erp

# 3. Podmiana plików aplikacji (data/ i .env pozostają nietknięte)
sudo unzip -o ResInvest-ERP-1.1.0.zip -d /tmp/erp-new
sudo rsync -a --delete /tmp/erp-new/ResInvest-ERP-1.1.0/{server,web,docs}/ /opt/resinvest-erp/

# 4. Migracje
sudo -u resinvest npm run migrate

# 5. Start i kontrola
sudo systemctl start resinvest-erp
curl -s localhost:4173/api/v1/health
```

Migracje są przyrostowe i zapisywane w tabeli `schema_migrations` — ponowne
uruchomienie na zaktualizowanej bazie nic nie zmienia.

---

## 5. Konfiguracja — parametry

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `PORT` | `4173` | Port nasłuchu |
| `HOST` | `127.0.0.1` | `0.0.0.0` udostępnia w sieci lokalnej |
| `NODE_ENV` | `production` | W trybie produkcyjnym błędy bez szczegółów |
| `AUTH_SECRET` | — | **Wymagany w produkcji**, min. 32 znaki |
| `AUTH_ACCESS_TTL_MIN` | `30` | Czas życia tokenu dostępu |
| `AUTH_REFRESH_TTL_DAYS` | `14` | Czas życia sesji |
| `AUTH_MAX_FAILED` / `AUTH_LOCK_MINUTES` | `8` / `15` | Blokada po nieudanych logowaniach |
| `DB_FILE` | `./data/resinvest.db` | Plik bazy |
| `DB_AUTO_MIGRATE` | `true` | Migracje przy starcie |
| `ATTACHMENTS_DIR` / `ATTACHMENTS_MAX_MB` | `./data/attachments` / `12` | Skany |
| `BACKUP_DIR` / `BACKUP_KEEP` | `./data/backups` / `30` | Kopie i rotacja |
| `CORS_ORIGINS` | — | Dozwolone źródła, po przecinku |
| `LOG_LEVEL` / `LOG_FILE` | `info` / `./data/logs/app.log` | Dziennik |
| `COMPANY_*` | — | Nagłówki dokumentów i raportów |

Wygenerowanie klucza:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

---

## 6. Monitoring

```bash
curl -s localhost:4173/api/v1/health
# {"status":"ok","version":"1.0.0","time":"…","uptimeSec":86400}
```

Dziennik w formacie JSON Lines (stdout + opcjonalnie plik) — nadaje się do
`journalctl`, Lokiego albo dowolnego kolektora. Hasła i tokeny są maskowane.

Sygnały wymagające reakcji, widoczne również na pulpicie aplikacji:

* stany ujemne — brakujący dokument przyjęcia,
* dokumenty bez podpisu zatwierdzającego,
* okres otwarty dłużej niż miesiąc po jego zakończeniu.

---

## 7. Rozwiązywanie problemów

| Objaw | Przyczyna i rozwiązanie |
|---|---|
| `Port 4173 jest zajęty` | Druga instancja albo inna usługa. Zmień `PORT` w `.env` |
| `AUTH_SECRET jest wymagany` | Brak klucza w trybie produkcyjnym — wygeneruj i wpisz do `.env` |
| Wylogowanie po restarcie | `AUTH_SECRET` pusty → klucz tymczasowy. Ustaw go na stałe |
| `SQLITE_BUSY` | Kopiowanie pliku bazy w trakcie pracy. Używaj `npm run backup` |
| Nie mogę się zalogować | `npm run user:create -- --list`, potem założenie nowego konta ADMIN |
| Brak dostępu z telefonu | `HOST=0.0.0.0`, zapora, ten sam segment sieci |
| Skany się nie zapisują | Prawa do `ATTACHMENTS_DIR`, limit `ATTACHMENTS_MAX_MB` |

### Odtworzenie z kopii

```bash
sudo systemctl stop resinvest-erp
cd /opt/resinvest-erp/data
mv resinvest.db resinvest.db.uszkodzona
rm -f resinvest.db-wal resinvest.db-shm
cp backups/resinvest-auto-2026-09-04T22-00-00-000Z.db resinvest.db
sudo systemctl start resinvest-erp
```

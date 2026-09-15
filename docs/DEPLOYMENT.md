# Wdrożenie i utrzymanie

Trzy scenariusze: stanowisko desktopowe, serwer firmowy z dostępem z telefonów,
dostęp przez internet.

---

## 1. Stanowisko desktopowe (Windows)

Najprostszy wariant — jeden komputer w biurze magazynu. Są dwie drogi:
gotowy instalator (zalecana) albo pakiet `.ZIP` ze skryptami.

### 1.1 Instalator `.exe` — zalecane

Jeden plik do pobrania: **`ResInvest-ERP-Setup-1.0.0.exe`** (ok. 2 MB).
Niesie w sobie serwer, interfejs, dokumentację, program uruchamiający
i wersję jednoplikową. **Nic nie pobiera z internetu** — instaluje się
tak samo na komputerze odciętym od sieci.

1. Sprawdź sumę kontrolną pobranego pliku (patrz 1.2).
2. Uruchom instalator dwuklikiem.
   Windows pokaże ostrzeżenie SmartScreen — patrz 1.3, to spodziewane.
3. Kreator przeprowadzi przez pięć ekranów: powitanie, kontrola środowiska,
   katalog i opcje, instalacja, zakończenie.
4. **Zapisz dane pierwszego logowania z ostatniego ekranu.**
   Ten sam login i hasło instalator zapisuje w pliku
   `DANE-PIERWSZEGO-LOGOWANIA.txt` w katalogu programu.

Instalator domyślnie zakłada program w profilu użytkownika
(`%LOCALAPPDATA%\ResInvest ERP`), więc **nie wymaga uprawnień administratora
i nie wywołuje okna UAC**. Katalog można zmienić na dowolny inny.

**Gdy na komputerze nie ma Node.js** — kreator to wykryje i zaproponuje
wersję jednoplikową: cały system w jednym pliku HTML, otwierany dwuklikiem,
działający bez instalowania czegokolwiek. Nie jest to wersja okrojona
funkcjonalnie, ale dane zostają w tej jednej przeglądarce na tym komputerze
(szczegóły i ograniczenia: `docs/STANDALONE.md`). Pełną wersję można
zainstalować później, uruchamiając instalator ponownie po instalacji Node.js.

**Ponowne uruchomienie instalatora aktualizuje program**, zostawiając
`data\` i `.env` nietknięte — dokumenty, kopie zapasowe, załączniki
i klucz sesji zostają na miejscu.

**Odinstalowanie**: „Aplikacje i funkcje” w ustawieniach Windows albo
`Odinstaluj.exe` w katalogu programu. Dane magazynowe **domyślnie zostają** —
usunięcie ich wymaga świadomego zaznaczenia pola i potwierdzenia.

### 1.2 Suma kontrolna

Obok instalatora publikowany jest plik `.sha256` i gotowa instrukcja
`SPRAWDZ-SUME-KONTROLNA-<wersja>.txt`. W PowerShell:

```powershell
Get-FileHash .\ResInvest-ERP-Setup-1.0.0.exe -Algorithm SHA256 | Format-List
```

Wynik musi zgadzać się co do znaku z zawartością pliku `.sha256`.
Jeżeli się różni — **nie uruchamiaj pliku**: pobranie było niepełne albo
plik został po drodze zmieniony.

Budowa jest powtarzalna: te same źródła dają bajt w bajt ten sam plik
i tę samą sumę, więc każdy może odtworzyć wydanie u siebie i porównać.

### 1.3 Ostrzeżenie SmartScreen — czego się spodziewać

Instalator **nie jest podpisany certyfikatem wydawcy**, więc przy pierwszym
uruchomieniu Windows pokaże niebieskie okno „System Windows ochronił Twój
komputer”. To nie jest oznaka, że z plikiem coś jest nie tak — tak Windows
traktuje każdy program bez wykupionego certyfikatu podpisywania kodu.

Aby kontynuować: **Więcej informacji** → **Uruchom mimo to**.

Ostrzeżenie zniknie dopiero po podpisaniu pliku certyfikatem EV
(koszt roczny, weryfikacja tożsamości firmy). Do rozważenia, jeśli
instalator ma być rozsyłany szerzej niż na własne komputery.
Sumę kontrolną SHA-256 sprawdzaj tak czy inaczej — ona mówi o pliku
więcej niż podpis o wydawcy.

### 1.4 Pakiet `.ZIP` — wariant bez instalatora

Dla informatyka, który woli widzieć pliki przed uruchomieniem czegokolwiek,
albo wdraża system na kilku stanowiskach naraz.

1. Zainstaluj **Node.js 22 LTS** — <https://nodejs.org/pl> (opcje domyślne).
2. Rozpakuj `ResInvest-ERP-1.0.0.zip`, np. do `C:\ResInvest-ERP`.
   Nie uruchamiaj plików z wnętrza archiwum.
3. Uruchom `INSTALUJ.bat`.
   Skrypt tworzy `.env` z unikalnym kluczem `AUTH_SECRET`, zakłada bazę,
   proponuje dane testowe i tworzy skrót na pulpicie.
4. **Zapisz wyświetlone dane pierwszego logowania.**
5. Uruchom `START.bat` (albo skrót z pulpitu) — przeglądarka otworzy
   `http://localhost:4173`.

Tę samą zawartość można wyjąć z instalatora bez instalowania:

```
ResInvest-ERP-Setup-1.0.0.exe /rozpakuj C:\ResInvest-ERP
```

Tryb `/rozpakuj` nie tworzy `.env`, nie dotyka rejestru i nie zakłada
skrótów — wypakowuje samą zawartość.

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
        # $remote_addr, NIE $proxy_add_x_forwarded_for — patrz uwaga niżej.
        proxy_set_header X-Forwarded-For   $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

W `.env` pozostaw `HOST=127.0.0.1` — do aplikacji ma docierać wyłącznie ruch
z proxy.

**Adres IP w dzienniku audytu.** Aplikacja domyślnie zapisuje adres gniazda
i **ignoruje** `X-Forwarded-For` (`TRUST_PROXY=false`). Za proxy zapisywałby się
wtedy adres samego proxy — żeby w dzienniku był adres pracownika, ustaw
`TRUST_PROXY=true`, ale **wyłącznie razem z powyższą konfiguracją nginx**.

Dwie rzeczy muszą zajść jednocześnie, inaczej wpis w dzienniku jest bezwartościowy:

1. nginx **nadpisuje** nagłówek (`$remote_addr`). Popularne
   `$proxy_add_x_forwarded_for` **dopisuje** się do wartości przysłanej przez
   klienta, więc na początku listy — a stamtąd aplikacja bierze adres — ląduje
   to, co wpisał sam klient.
2. do aplikacji nie da się dojść z pominięciem proxy (`HOST=127.0.0.1`).

Bez proxy zostaw `TRUST_PROXY=false`. Aplikacja wystawiona wprost do sieci
z `TRUST_PROXY=true` pozwala każdemu podpisać własne działania cudzym adresem
i rozsypuje ograniczanie prób logowania — każdy zmyślony adres dostaje własny
licznik. Ten dziennik jest dowodem przy certyfikacji KZR/SURE i kontroli
skarbowej.

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

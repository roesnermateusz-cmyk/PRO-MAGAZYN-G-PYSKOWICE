# ResInvest ERP

System magazynowy, produkcyjny i handlowy dla obrotu biomasą drzewną.
Zaprojektowany dla firmy **ResInvest Commodities** obsługującej magazyny
RiC Zabrze, RiC Brąszewice i RiC Rokitki.

Jedna centralna baza danych, wielu użytkowników pracujących równocześnie,
pełna historia zmian i dokumenty gotowe do wydruku.

---

## Spis treści

1. [Co system obsługuje](#co-system-obsługuje)
2. [Wymagania](#wymagania)
3. [Szybki start (środowisko deweloperskie)](#szybki-start-środowisko-deweloperskie)
4. [Konta początkowe](#konta-początkowe)
5. [Instalacja produkcyjna na Windows](#instalacja-produkcyjna-na-windows)
6. [Konfiguracja](#konfiguracja)
7. [Struktura projektu](#struktura-projektu)
8. [Logika biznesowa](#logika-biznesowa)
9. [Bezpieczeństwo](#bezpieczeństwo)
10. [Kopie zapasowe i odtwarzanie](#kopie-zapasowe-i-odtwarzanie)
11. [Testy i kontrola jakości](#testy-i-kontrola-jakości)
12. [Dokumentacja szczegółowa](#dokumentacja-szczegółowa)
13. [Licencja](#licencja)

---

## Co system obsługuje

| Obszar | Zakres |
|---|---|
| **Przyjęcia PZ** | Zakup surowca od dostawcy, w tym od nadleśnictwa z numerem kwitu wywozowego, nazwą nadleśnictwa i leśnictwa |
| **Produkcja** | Przetworzenie drewna na zrębkę z **automatycznym zużyciem surowca** w jednej transakcji; rąbanie własne lub firmą zewnętrzną, z kosztem jednostkowym |
| **Wydania WZ** | Sprzedaż z magazynu do elektrowni i pozostałych odbiorców |
| **Przesunięcia MM** | Atomowy transfer między magazynami firmy |
| **Transport** | Przewoźnik, pojazd, trasa, odległość i koszt, ze wskaźnikami koszt/km, koszt/t, koszt/MP, koszt/m³ |
| **Sprzedaż bezpośrednia** | Zakup → sprzedaż z pominięciem magazynu, bez tworzenia sztucznego stanu |
| **Stany magazynowe** | Saldo w jednostce bazowej z przeliczeniem na m³, MP i tony |
| **Kartoteka ruchów** | Niemodyfikowalna księga wszystkich przychodów i rozchodów |
| **Dokumenty** | Automatyczna numeracja, wydruk A4, skany (JPG/PNG/WEBP/HEIC/PDF), anulowanie i korekty |
| **Raporty** | Zestawienie zbiorcze, produkcja, transport, kontrahenci — miesięczne, roczne lub za dowolny zakres dat; eksport CSV |
| **Historia zmian** | Kto, kiedy, co zmienił, wartość przed i po — zapis chroniony przed edycją na poziomie bazy danych |
| **Administracja** | Użytkownicy, role i uprawnienia, magazyny, produkty, kontrahenci, przeliczniki i stawki, kopie zapasowe |

Interfejs dostępny w językach **polskim** (domyślny), **czeskim** i **angielskim**,
w motywie jasnym i ciemnym, na komputerze, tablecie i telefonie.

---

## Wymagania

| Element | Wersja |
|---|---|
| Node.js | 20.11 LTS lub nowszy (zalecany 22 LTS) |
| npm | 10 lub nowszy |
| System | Windows 10/11, Linux, macOS |
| Przeglądarka | Chrome / Edge / Firefox / Safari, wersja z ostatnich 2 lat |

Baza danych (SQLite) jest wbudowana — nie trzeba instalować osobnego serwera bazodanowego.

---

## Szybki start (środowisko deweloperskie)

```bash
# 1. Zależności
npm install

# 2. Plik konfiguracyjny
cp .env.example .env

# 3. Baza danych + dane przykładowe
npm run db:reset

# 4. Serwer API (port 4000) i aplikacja kliencka (port 5173)
npm run dev
```

Aplikacja: **http://localhost:5173**

Pozostałe polecenia:

```bash
npm run db:migrate    # tylko migracje schematu (bez danych przykładowych)
npm run db:seed       # dane słownikowe, konta i dokumenty przykładowe
npm run test          # 84 testy serwera
npm run typecheck     # kontrola typów serwera i klienta
npm run lint          # analiza statyczna
npm run build         # build produkcyjny obu pakietów
npm run verify        # typecheck + lint + testy + build (pełna weryfikacja)
npm start             # uruchomienie zbudowanego serwera
```

---

## Konta początkowe

Tworzone przez `npm run db:seed`. **Hasła należy zmienić przed wdrożeniem produkcyjnym.**

| Login | Hasło | Rola | Magazyny |
|---|---|---|---|
| `admin` | `Admin#2026` | Administrator | wszystkie |
| `manager` | `Demo#2026` | Manager | ZAB, BRA, ROK |
| `zabrze` | `Demo#2026` | Magazynier | RiC Zabrze |
| `braszewice` | `Demo#2026` | Magazynier | RiC Brąszewice |
| `rokitki` | `Demo#2026` | Magazynier | RiC Rokitki |
| `podglad` | `Demo#2026` | Podgląd | ZAB, BRA, ROK |

Konto `admin` wymusza zmianę hasła przy pierwszym logowaniu.
Hasła początkowe można nadpisać zmiennymi `SEED_ADMIN_PASSWORD` i `SEED_DEMO_PASSWORD`.

Wdrożenie bez danych demonstracyjnych:

```bash
npm run db:migrate
SEED_ADMIN_PASSWORD='WlasneHaslo#2026' npm run db:seed -w server -- --core-only
```

---

## Instalacja produkcyjna na Windows

Instalator to jeden plik `.exe`, który instaluje serwer, bazę danych i aplikację
w jednej paczce. Stanowisko z zainstalowanym programem pełni rolę serwera firmowego —
pozostali pracownicy łączą się przeglądarką pod adresem podanym w menu
**Narzędzia → Adres dla innych stanowisk**.

### Budowanie instalatora

Instalator buduje się **na maszynie Windows** (electron-builder kompiluje moduł
natywny bazy danych pod architekturę docelową):

```bash
npm install
npm run verify              # wymagane: build nie może przejść z błędami
cd desktop
npm install
npm run dist
```

Wynik: `desktop/release/ResInvest-ERP-Setup-1.0.0.exe`

Suma kontrolna do weryfikacji integralności pliku:

```powershell
Get-FileHash .\release\ResInvest-ERP-Setup-1.0.0.exe -Algorithm SHA256
```

### Co robi instalator

- instaluje program w `C:\Program Files\ResInvest ERP`;
- tworzy katalog danych `C:\ProgramData\ResInvestERP` (baza, załączniki, kopie zapasowe);
- dodaje regułę zapory Windows dla portu 4000 (profil prywatny i domenowy);
- tworzy skróty na pulpicie i w menu Start;
- przy **deinstalacji nie usuwa danych firmy** — baza i kopie zapasowe pozostają na dysku.

Szczegóły: [docs/WDROZENIE-WINDOWS.md](docs/WDROZENIE-WINDOWS.md)

> **Status:** konfiguracja instalatora jest kompletna i zweryfikowana w zakresie
> możliwym w środowisku Linux (montaż zawartości paczki oraz uruchomienie
> wbudowanego serwera z tej zawartości). Sam plik `.exe` musi zostać zbudowany
> i przetestowany na Windows — patrz sekcja „Odbiór instalatora” w
> [docs/WDROZENIE-WINDOWS.md](docs/WDROZENIE-WINDOWS.md).

---

## Konfiguracja

Wszystkie parametry opisuje [`.env.example`](.env.example). Najważniejsze:

| Zmienna | Znaczenie | Domyślnie |
|---|---|---|
| `PORT` | Port serwera API | `4000` |
| `HOST` | Adres nasłuchu (`0.0.0.0` udostępnia w sieci firmowej) | `0.0.0.0` |
| `DATA_DIR` | Katalog bazy, załączników i kopii zapasowych | `./server/data` |
| `JWT_SECRET`, `REFRESH_SECRET` | Klucze podpisu tokenów — **wymagane w produkcji** | generowane i utrwalane przy pierwszym starcie |
| `CORS_ORIGINS` | Dozwolone adresy przeglądarkowe | `http://localhost:5173` |
| `ACCESS_TOKEN_TTL_MINUTES` | Ważność tokenu dostępu | `30` |
| `REFRESH_TOKEN_TTL_DAYS` | Ważność sesji | `14` |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_LOCK_MINUTES` | Ochrona przed atakiem słownikowym | `8` / `15` |
| `BACKUP_INTERVAL_HOURS` / `BACKUP_KEEP` | Harmonogram kopii zapasowych | `12` / `30` |
| `MAX_UPLOAD_MB` | Limit rozmiaru skanu | `15` |

Przeliczniki jednostek i stawki (transport zł/km, rąbanie zł/jednostkę, próg niskiego
stanu, zgoda na stan ujemny) zmienia się **w aplikacji**: *Administracja → Ustawienia*.

---

## Struktura projektu

```
resinvest-erp/
├─ server/                      Serwer API (Node.js + TypeScript + Express)
│  ├─ src/
│  │  ├─ config/                Konfiguracja środowiska
│  │  ├─ core/                  Jednostki, kwoty, audyt, numeracja, hasła, kopie zapasowe
│  │  ├─ db/                    Połączenie, migracje SQL, dane początkowe
│  │  ├─ middleware/            Uwierzytelnianie, uprawnienia, walidacja, limity, błędy
│  │  └─ modules/               auth, users, warehouses, products, partners,
│  │                            documents (silnik magazynowy), stock, reports,
│  │                            audit, settings, attachments
│  └─ tests/                    84 testy: jednostkowe, API, wielodostęp
├─ client/                      Aplikacja kliencka (React + TypeScript + Vite)
│  └─ src/
│     ├─ api/                   Klient HTTP z rotacją tokenów
│     ├─ components/            Komponenty wielokrotnego użytku, układ, wydruk
│     ├─ i18n/                  Słowniki pl / cs / en
│     ├─ pages/                 Ekrany aplikacji
│     ├─ state/                 Sesja, motyw, powiadomienia
│     └─ styles/                System wizualny (tokeny, motywy, wydruk A4)
├─ desktop/                     Powłoka Electron + konfiguracja instalatora NSIS
├─ docs/                        Dokumentacja szczegółowa
├─ legacy/                      Poprzedni prototyp jednoplikowy (archiwum)
└─ .env.example                 Wzorzec konfiguracji środowiska
```

---

## Logika biznesowa

### Przepływ podstawowy

```
ZAKUP DREWNA → PZ → STAN MAGAZYNOWY → PRODUKCJA (automatyczne zużycie)
   → ZRĘBKA → MM / TRANSPORT → MAGAZYN → SPRZEDAŻ → WZ
```

Przepływy alternatywne:

```
ZAKUP → SPRZEDAŻ BEZPOŚREDNIA          (bez stanu magazynowego)
ZAKUP → TRANSPORT → MAGAZYN DOCELOWY
MAGAZYN A → MM → MAGAZYN B
```

### Przeliczniki

| Relacja | Wartość domyślna |
|---|---|
| 1 m³ drewna | 4 MP zrębki |
| 1 MP zrębki | 0,25 m³ drewna |
| 1 MP zrębki | 0,33 t |

Przykład: `100 m³ → 400 MP → 132 t`

Przeliczniki są konfigurowalne globalnie oraz indywidualnie dla produktu.
Każdą wartość m³ / MP / t można **wpisać ręcznie** jako wartość rzeczywistą —
jest wtedy wyraźnie oznaczona i **nie zmienia stanu magazynowego** prowadzonego
w jednostce bazowej produktu.

### Reguły integralności

- Stan magazynowy zmienia wyłącznie **zatwierdzenie** dokumentu, nie jego zapis.
- Każda operacja magazynowa wykonywana jest w jednej transakcji bazodanowej;
  niepowodzenie dowolnego kroku wycofuje całość (brak stanów częściowych).
- Stan ujemny jest zablokowany; dopuszczenie wymaga **jednocześnie** włączenia
  polityki w ustawieniach i uprawnienia `stock.allow_negative`.
- Dokument zatwierdzony nie podlega edycji — dostępne są **anulowanie** (ze stornem
  ruchów) oraz **korekta** (anulowanie oryginału i wystawienie poprawionej kopii).
- Ruchy magazynowe i wpisy historii zmian są niemodyfikowalne — wymuszają to
  wyzwalacze bazy danych, nie tylko kod aplikacji.
- Numeracja `TYP/ROK/MAGAZYN/KOLEJNY` rezerwowana jest atomowo — dwóch użytkowników
  nigdy nie otrzyma tego samego numeru.
- Kwoty przechowywane są jako liczby całkowite groszy — sumy nie kumulują błędu
  zaokrąglenia.

---

## Bezpieczeństwo

- **Uwierzytelnianie**: JWT z krótkim czasem życia + token odświeżania z rotacją
  (ponowne użycie zużytego tokenu unieważnia sesję).
- **Hasła**: scrypt z losową solą; polityka złożoności; blokada konta po serii
  nieudanych prób.
- **Autoryzacja**: uprawnienia sprawdzane **wyłącznie po stronie serwera**.
  Ukrycie przycisku w interfejsie nie jest traktowane jako zabezpieczenie.
- **Izolacja magazynów**: filtr magazynów wymuszany w zapytaniach SQL — użytkownik
  nie zobaczy ani nie zmodyfikuje dokumentu spoza przypisanych magazynów, także
  przy bezpośrednim wywołaniu API.
- **Natychmiastowe cofnięcie dostępu**: zmiana roli, magazynów lub dezaktywacja
  konta unieważnia aktywne sesje bez czekania na wygaśnięcie tokenu.
- **Walidacja wejścia**: schematy zod na każdym endpoincie, odrzucanie nieznanych pól.
- **SQL injection**: wyłącznie zapytania parametryzowane.
- **XSS**: React escapuje treści, nagłówki `helmet` z polityką CSP.
- **Załączniki**: zamknięta lista typów MIME, limit rozmiaru, ochrona przed wyjściem
  poza katalog, suma SHA-256 każdego pliku.
- **Limity żądań** na endpointach logowania i API.

Testy bezpieczeństwa (próba obejścia uprawnień przez API, dostęp do cudzych magazynów,
wstrzyknięcie SQL, podrobiony token, dezaktywacja konta) są częścią zestawu testów.

---

## Kopie zapasowe i odtwarzanie

- Kopia automatyczna co `BACKUP_INTERVAL_HOURS` godzin, przechowywane ostatnie
  `BACKUP_KEEP` plików (domyślnie co 12 h, 30 plików).
- Kopia na żądanie: *Administracja → Ustawienia → Kopie zapasowe*.
- Mechanizm: natywne `VACUUM INTO` SQLite — spójny obraz bazy **bez przerywania
  pracy użytkowników**.
- Pliki: `<DATA_DIR>/backups/resinvest-<auto|manual>-<znacznik-czasu>.sqlite`

**Odtworzenie:**

1. Zatrzymaj aplikację (zamknij program lub zatrzymaj usługę).
2. Skopiuj wybrany plik kopii na `<DATA_DIR>/resinvest.sqlite`.
3. Usuń pliki `resinvest.sqlite-wal` i `resinvest.sqlite-shm`, jeśli istnieją.
4. Uruchom aplikację ponownie.

Kontrola spójności sald z księgą ruchów: `GET /api/stock/integrity`
(uprawnienie `admin.backup`).

---

## Testy i kontrola jakości

```bash
npm run verify
```

Zakres zestawu testów (84 przypadki):

| Obszar | Co jest sprawdzane |
|---|---|
| Przeliczniki i kwoty | m³ ↔ MP ↔ t, przeliczniki indywidualne, brak błędu zaokrąglenia na 1000 pozycji |
| Dokumenty | PZ, WZ, MM, produkcja, transport, sprzedaż bezpośrednia — walidacja i księgowanie |
| Stany | blokada stanu ujemnego, sumowanie wielu pozycji tego samego produktu, brak stanu częściowego przy MM |
| Cykl życia | wersjonowanie, blokada edycji po zatwierdzeniu, anulowanie ze stornem, korekta, idempotencja |
| Bezpieczeństwo | role, izolacja magazynów, podrobiony token, dezaktywacja konta, SQL injection, rotacja tokenów |
| Wielodostęp | **rzeczywiste procesy systemowe** konkurujące o tę samą bazę: podwójne zatwierdzenie, równoległe wydania przekraczające stan, operacje na różnych magazynach |
| Niemodyfikowalność | próba edycji i usunięcia audytu oraz ruchów magazynowych |

Dodatkowo wykonano test przeglądarkowy całej aplikacji (Chromium, 1440×950 i 390×844,
motyw jasny i ciemny) — bez błędów konsoli i nieobsłużonych wyjątków.

Pełny raport: [docs/RAPORT-JAKOSCI.md](docs/RAPORT-JAKOSCI.md)

---

## Dokumentacja szczegółowa

| Dokument | Zawartość |
|---|---|
| [docs/ARCHITEKTURA.md](docs/ARCHITEKTURA.md) | Warstwy systemu, model danych, decyzje projektowe |
| [docs/INSTRUKCJA-UZYTKOWNIKA.md](docs/INSTRUKCJA-UZYTKOWNIKA.md) | Obsługa krok po kroku dla pracowników |
| [docs/WDROZENIE-WINDOWS.md](docs/WDROZENIE-WINDOWS.md) | Instalacja, praca wielostanowiskowa, aktualizacje |
| [docs/API.md](docs/API.md) | Pełna specyfikacja endpointów |
| [docs/RAPORT-JAKOSCI.md](docs/RAPORT-JAKOSCI.md) | Raport audytu i testów |
| [CHANGELOG.md](CHANGELOG.md) | Historia wersji |

---

## Licencja

[MIT](LICENSE) — Copyright (c) 2026 ResInvest Commodities

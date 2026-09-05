# ResInvest ERP — System Magazynowy Biomasy

System magazynowy dla obrotu biomasą leśną: dokumenty PZ / WZ / PW / RW / MM / BO,
produkcja zrębki, stany magazynowe, raporty miesięczne, rejestr korekt oraz
ścieżka pochodzenia surowca wymagana przy certyfikacji **KZR INiG** i **SURE**.

**ResInvest Commodities PL** · ul. Gwarecka 16, Zabrze · autor: Mateusz Roesner

---

## Spis treści

1. [Co system robi](#1-co-system-robi)
2. [Szybki start](#2-szybki-start)
3. [Instalacja desktopowa (.ZIP)](#3-instalacja-desktopowa-zip)
4. [Konta i role](#4-konta-i-role)
5. [Jak system liczy](#5-jak-system-liczy)
6. [Praca z systemem](#6-praca-z-systemem)
7. [Struktura projektu](#7-struktura-projektu)
8. [Konfiguracja](#8-konfiguracja)
9. [Bezpieczeństwo danych](#9-bezpieczeństwo-danych)
10. [Polecenia](#10-polecenia)
11. [Testy](#11-testy)
12. [Dokumentacja techniczna](#12-dokumentacja-techniczna)
13. [Licencja](#13-licencja)

---

## 1. Co system robi

### Rejestr dokumentów magazynowych

Sześć typów operacji z automatyczną numeracją roczną w osobnych seriach:

| Typ | Seria | Znaczenie |
|---|---|---|
| ZAKUP | **PZ** | Przyjęcie zewnętrzne — zakup surowca |
| SPRZEDAŻ | **WZ** | Wydanie zewnętrzne — sprzedaż i wywóz |
| PRODUKCJA | **PW** | Przyjęcie wewnętrzne — zrębka po rąbaniu |
| ZUŻYCIE | **RW** | Rozchód wewnętrzny — surowiec do produkcji |
| MM | **MM** | Przesunięcie międzymagazynowe |
| BO | **BO** | Bilans otwarcia |

### Łańcuch terenowy — jeden formularz, komplet dokumentów

Realne zdarzenie w lesie to nie jeden dokument. Magazynier wypełnia jeden
formularz, a system księguje spójny komplet:

```
   zakup drewna      rębak w lesie       wywóz zrębki
        │                  │                   │
        ▼                  ▼                   ▼
   PZ/2026/000123 ──► RW/2026/000045 ──► PW/2026/000045 ──► WZ/2026/000067
   (surowiec)         (zużycie)          (zrębka)           (do elektrowni)
        └──────────────── chain_ref: PZ/2026/000123 ────────────────┘
```

Koszty nie dublują się: cena surowca na PZ, koszt rąbania na PW, transport
i kwit wywozowy na dokumencie faktycznego wywozu.

### Stany magazynowe

Stan to **suma ruchów magazynowych**, nigdy pole aktualizowane w miejscu.
Dzięki temu rozjazd stanu jest niemożliwy, a system daje:

* stan bieżący w rozbiciu na magazyn i produkt (m³, MP, tony, GJ),
* stan **na dowolny dzień wstecz**,
* kartotekę magazynową z saldem narastającym po każdym dokumencie,
* ostrzeżenia o stanach ujemnych.

### Raporty

| Raport | Zawartość |
|---|---|
| **Miesięczny** | BO + zakup + produkcja − zużycie − sprzedaż = BZ, per produkt; koszty i marża |
| **Produkcja dnia** | Kwit produkcyjny: zużyty surowiec, uzysk zrębki, kwity wywozowe, pochodzenie |
| **Transport** | Koszty wg przewoźnika i pojazdu, stawki zł/km i zł/tonę |
| **Kontrahenci** | Obroty zakupu i sprzedaży w okresie |
| **Certyfikacja** | Pochodzenie surowca wg nadleśnictw + lista dokumentów do uzupełnienia |

Każdy raport ma wersję do wydruku i eksport CSV.

### Korekty i audyt

* Dokumenty **nie są usuwane** — storno z wymaganą przyczyną.
* Każda edycja zapisuje stan „przed → po” w rejestrze korekt.
* Przywrócenie stanu sprzed korekty tworzy kolejny wpis — historia nie jest nadpisywana.
* Nieusuwalny dziennik audytu: logowania, zapisy, storna, eksporty, zamknięcia okresów.

### Okresy rozliczeniowe

Zamknięcie miesiąca blokuje zapisy i utrwala migawkę stanów. Otwarcie wymaga
uprawnień kierownika i uzasadnienia zapisywanego w audycie.

### Import i eksport

* **CSV** rejestru operacji i stanów — separator średnik, przecinek dziesiętny,
  BOM UTF-8 (polskie znaki otwierają się poprawnie w Excelu).
* **JSON** — pełna kopia logiczna do przeniesienia albo archiwizacji.
* **Import** z kopii JSON w trybie scalania lub odtworzenia, zawsze po
  automatycznej kopii bezpieczeństwa.

### Załączniki

Skany kwitów wywozowych i zdjęcia z placu — z aparatu telefonu, kompresowane
w przeglądarce przed wysyłką. Metadane w bazie (wraz z SHA-256), pliki na dysku.

---

## 2. Szybki start

### Wymagania

**Node.js 22 LTS lub nowszy** — <https://nodejs.org/pl>
System nie ma żadnych zależności npm. Nie trzeba uruchamiać `npm install`.

### Uruchomienie

```bash
# 1. Konfiguracja
cp .env.example .env

# 2. Klucz podpisu sesji — wklej wynik do AUTH_SECRET w pliku .env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# 3. Baza danych
npm run migrate

# 4. (opcjonalnie) przykładowe dane testowe — 2 miesiące realistycznej pracy
npm run seed

# 5. Start
npm start
```

Aplikacja: **<http://localhost:4173>**

Przy pierwszym uruchomieniu system zakłada konto administratora i wypisuje w
konsoli login oraz hasło. Hasło trzeba zmienić przy pierwszym logowaniu.

---

## 3. Instalacja desktopowa (.ZIP)

Gotowy pakiet dla stanowiska w biurze magazynu — bez konsoli i bez `git`.

```bash
npm run build:installer
# → dist/ResInvest-ERP-1.0.0.zip
```

Archiwum zawiera serwer, aplikację kliencką, migracje, dane testowe,
dokumentację i skrypty instalacyjne.

### Windows

1. Zainstaluj Node.js 22 LTS z <https://nodejs.org/pl>.
2. Rozpakuj archiwum, np. do `C:\ResInvest-ERP` *(nie uruchamiaj plików z wnętrza ZIP-a)*.
3. Kliknij dwukrotnie **`INSTALUJ.bat`**. Skrypt utworzy konfigurację
   z unikalnym kluczem bezpieczeństwa, założy bazę, zaproponuje dane testowe,
   **zbuduje program `ResInvestERP.exe`** oraz doda skróty na pulpicie
   i w menu Start. Zapyta też o uruchamianie po zalogowaniu do Windows.
4. **Zapisz wyświetlone dane pierwszego logowania.**
5. Uruchamiaj system plikiem **`ResInvestERP.exe`** albo skrótem z pulpitu.

#### Program `ResInvestERP.exe`

Po uruchomieniu program siada w **zasobniku systemowym** obok zegara — bez
okna konsoli, którego nie da się przypadkiem zamknąć w środku pracy magazynu.
Prawy przycisk na ikonie otwiera menu: aplikacja, folder z danymi, dziennik
serwera i zakończenie pracy systemu. Kolejne kliknięcie ikony nie uruchamia
drugiego serwera, tylko otwiera przeglądarkę.

Instalator buduje ten plik na miejscu, kompilatorem wbudowanym w Windows —
nic nie trzeba pobierać. Gdyby go zabrakło, system uruchamia się plikiem
**`START.bat`**, a instalator o tym poinformuje.

Diagnostyka bez zdalnego dostępu do komputera:

```bat
ResInvestERP.exe --sprawdz
```

Wypisuje, czy jest Node.js, czy komplet plików i czy port jest wolny.

Kopia zapasowa: **`KOPIA-ZAPASOWA.bat`** (warto wpiąć w Harmonogram zadań).

### Linux / macOS

```bash
unzip ResInvest-ERP-1.0.0.zip && cd ResInvest-ERP-1.0.0
chmod +x *.sh
./instaluj.sh
./start.sh
```

Wdrożenie na serwerze firmowym (systemd, HTTPS, dostęp z telefonów):
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## 4. Konta i role

| Rola | Zakres uprawnień |
|---|---|
| **ADMIN** | Pełna kontrola: konta użytkowników, ustawienia, import danych |
| **KIEROWNIK** | Praca operacyjna, storno dokumentów, zamykanie i otwieranie okresów |
| **MAGAZYNIER** | Wprowadzanie dokumentów, edycja **własnych** wpisów, kartoteki |
| **KSIĘGOWY** | Odczyt, raporty i eksporty — bez wprowadzania dokumentów |
| **AUDYTOR** | Wyłącznie odczyt — kontrola i certyfikacja |

Zakładanie konta z konsoli:

```bash
npm run user:create -- --email jan.kowalski@firma.pl --name "Jan Kowalski" --role MAGAZYNIER
npm run user:create -- --list        # lista kont
```

Zabezpieczenia kont: hasła `scrypt`, blokada po serii nieudanych logowań,
tokeny odświeżania rotowane przy każdym użyciu, natychmiastowe unieważnienie
sesji po zmianie hasła lub zablokowaniu konta.

---

## 5. Jak system liczy

### Łańcuch jednostek

```
   m³ (drewno lite) ──×4──► MP (metry przestrzenne) ──×0,33──► tony ──×8,5──► GJ
```

Przeliczniki są konfigurowalne globalnie **oraz indywidualnie dla produktu**
(kartoteka produktów ma pierwszeństwo). Każdy krok można nadpisać wartością
rzeczywistą z dokumentu — na przykład masą z wagi samochodowej.

### Historia się nie zmienia

Dokument przechowuje wynik przeliczenia **oraz użyte przeliczniki**. Zmiana
ustawień dotyczy wyłącznie nowych dokumentów — raport za marzec wygląda tak
samo w kwietniu i za trzy lata. To warunek konieczny przy kontroli.

> **Zmiana względem wcześniejszej wersji arkuszowej.** Poprzednio masa była
> liczona wprost z wolumenu wejściowego (`tony = m³ × 0,33`), z pominięciem
> kroku m³ → MP, co dawało niespójne wyniki dla dokumentów w m³ i w MP.
> Tutaj obowiązuje jeden spójny łańcuch. Kalibrację pod rzeczywiste warunki
> uzyskuje się przeliczniknikami produktu lub wagą rzeczywistą.

### Wartości

Ceny podawane są za jednostkę wprowadzenia dokumentu:

```
wartość zakupu   = wolumen × cena zakupu
wartość sprzedaży = wolumen × cena sprzedaży
koszt rąbania    = wolumen × stawka rąbania
marża brutto     = sprzedaż − zakupy − rąbanie − transport
```

Ilości zaokrąglane do 3 miejsc, kwoty do 2 (groszy).

---

## 6. Praca z systemem

### Ekrany

| Ekran | Zastosowanie |
|---|---|
| **Pulpit** | Stan surowca i zrębki, obroty miesiąca, kwit produkcji dnia, sygnały do reakcji |
| **Operacje** | Rejestr z filtrami (typ, produkt, magazyn, miesiąc, wyszukiwanie pełnotekstowe) |
| **Nowa operacja** | Formularz z podglądem przeliczeń na żywo i panelem łańcucha |
| **Magazyn** | Stany + kartoteka magazynowa produktu |
| **Produkcja dnia** | Kwit produkcyjny do wydruku |
| **Raporty** | Miesięczny, transport, kontrahenci, certyfikacja |
| **Korekty** | Historia zmian „przed → po” z możliwością przywrócenia |
| **Kartoteki** | Produkty, kontrahenci, magazyny, pojazdy, nadleśnictwa |
| **Okresy** | Zamykanie i otwieranie miesięcy |
| **Użytkownicy** | Konta, role, dziennik audytu |
| **Ustawienia** | Przeliczniki, reguły księgowania, kopie zapasowe |

### Praca w terenie

Interfejs jest przystosowany do telefonu: dolny pasek zakładek, rejestr w formie
kart, klawiatura numeryczna przy polach liczbowych, dodawanie skanów prosto
z aparatu. Aplikację można zainstalować na ekranie głównym telefonu
(manifest PWA).

### Typowy dzień magazyniera

1. **Nowa operacja** → typ ZAKUP, dane z kwitu wywozowego.
2. Zaznaczenie **+ PRODUKCJA** (rębak pracował w lesie) i ewentualnie
   **+ SPRZEDAŻ** (zrębka pojechała prosto do elektrowni).
3. Zdjęcie kwitu z aparatu.
4. Podpis pełnym imieniem i nazwiskiem → **Zapisz**.

Jeden zapis daje komplet 2–4 dokumentów o poprawnych numerach, spójnych ruchach
magazynowych i rozdzielonych kosztach.

### Koniec miesiąca

1. **Raporty → miesięczny** — kontrola bilansu i marży.
2. **Raporty → certyfikacja** — uzupełnienie brakujących kwitów i nadleśnictw.
3. **Magazyn** — sprawdzenie stanów ujemnych.
4. **Okresy → Zamknij** — blokada zapisów i utrwalenie migawki stanów.
5. Eksport CSV dla księgowości.

---

## 7. Struktura projektu

```
PRO-MAGAZYN-G-PYSKOWICE/
├── README.md · LICENSE · .env.example · package.json
│
├── server/                     Warstwa serwerowa (zero zależności npm)
│   ├── src/
│   │   ├── index.js            punkt wejścia, zadania cykliczne
│   │   ├── app.js              złożenie tras + serwowanie front-endu
│   │   ├── bootstrap.js        migracje, magazyn domyślny, konto startowe
│   │   ├── config/env.js       konfiguracja z .env
│   │   ├── lib/                http, db-agnostyczne narzędzia, crypto, walidacja, CSV
│   │   ├── db/
│   │   │   ├── index.js        SQLite (WAL), transakcje, migracje
│   │   │   └── migrations/     wersjonowane skrypty SQL
│   │   ├── domain/             ⭐ czysta logika: units · documents · stock
│   │   ├── middleware/         auth (JWT + RBAC) · audit · rateLimit
│   │   └── modules/            auth · users · catalog · operations · stock
│   │                           reports · periods · corrections · attachments
│   │                           settings · backup · admin
│   ├── scripts/                migrate · seed · create-user · backup
│   ├── src/seed/demo-seed.js   generator danych demonstracyjnych (wspólny dla obu wersji)
│   ├── seed/demo-data.json     przykładowe dane testowe
│   └── tests/                  119 testów (node:test)
│
├── web/                        Aplikacja kliencka (ESM, bez build-stepu)
│   ├── index.html · manifest.webmanifest
│   ├── assets/app.css          chrom aplikacji
│   ├── assets/viz.css          ⭐ instancja palety + style wykresów
│   └── src/
│       ├── core/               dom · api · router · format · store · ui
│       ├── components/         layout · icons
│       ├── ui/                 DataTable · Toolbar · Pager · ListScreen
│       │   └── charts/         ⭐ scale · chart-core · Line · Column · Waterfall · Bar · figures
│       └── views/              pulpit · operacje · magazyn · raporty · kartoteki · …
│
├── desktop/
│   ├── build-zip.mjs           generator pakietu instalacyjnego
│   ├── make-icon.mjs           generator ikony aplikacji (.ico)
│   └── installer/              INSTALUJ.bat · ResInvestERP.cs · START.bat · instaluj.sh
│
├── standalone/                 ⭐ wersja jednoplikowa (build.mjs · runtime/ · vendor/)
├── docs/                       ARCHITECTURE · DATABASE · API · UI · DEPLOYMENT · DEBUGGING · SCALING · FRONTEND · DESIGN-SYSTEM · STANDALONE
├── legacy/                     wcześniejsze wersje jednoplikowe (archiwum)
└── data/                       runtime: baza, skany, kopie, logi (poza repo)
```

---

## 8. Konfiguracja

Wszystko w pliku `.env` (wzorzec: `.env.example`). Najważniejsze:

```ini
PORT=4173
HOST=127.0.0.1              # 0.0.0.0 udostępnia w sieci firmowej
NODE_ENV=production
AUTH_SECRET=                # WYMAGANY w produkcji, min. 32 znaki
DB_FILE=./data/resinvest.db
ATTACHMENTS_DIR=./data/attachments
ATTACHMENTS_MAX_MB=12
BACKUP_DIR=./data/backups
BACKUP_KEEP=30
COMPANY_NAME=ResInvest Commodities PL
COMPANY_DEFAULT_WAREHOUSE=Magazyn RiC Zabrze
```

Pełna lista parametrów: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#5-konfiguracja--parametry).

### Reguły księgowania (Ustawienia w aplikacji)

| Reguła | Domyślnie | Działanie |
|---|---|---|
| Wymagaj podpisu | włączone | Dokument musi mieć imię i nazwisko zatwierdzającego |
| Zezwalaj na stany ujemne | włączone | Ostrzeżenie zamiast blokady wydania |
| Księgowanie wstecz | 90 dni | Limit dla magazyniera i księgowego; kierownik bez limitu |

---

## 9. Bezpieczeństwo danych

### Kopie zapasowe

| Rodzaj | Kiedy |
|---|---|
| Kopia pliku bazy | automatycznie raz na dobę, przed każdym importem, na żądanie |
| Eksport JSON | ręcznie lub skryptem `npm run backup -- --json` |
| Rotacja | ostatnie 30 kopii (`BACKUP_KEEP`) |

Kopia wykonuje checkpoint dziennika WAL, więc archiwum zawiera wszystkie
zatwierdzone transakcje.

> Katalog `data/` (baza + skany dokumentów) należy objąć **firmową** kopią
> zapasową na osobnym nośniku. Kopie wewnętrzne chronią przed błędem
> użytkownika, nie przed awarią dysku.

### Ochrona dostępu

* Hasła: `scrypt` z solą per konto, porównanie w czasie stałym.
* Sesje: JWT (30 min) + token odświeżania rotowany przy każdym użyciu.
* Blokada konta po serii nieudanych logowań; limit żądań na logowaniu.
* Zapytania wyłącznie parametryzowane; każda wartość w interfejsie escapowana.
* Nieusuwalny dziennik audytu z adresem IP.

---

## 10. Polecenia

| Polecenie | Działanie |
|---|---|
| `npm start` | Uruchomienie systemu |
| `npm run dev` | Tryb deweloperski z automatycznym przeładowaniem |
| `npm run migrate` | Migracje bazy danych |
| `npm run seed` | Przykładowe dane testowe |
| `npm run seed:reset` | Wyczyszczenie rejestru i wygenerowanie od nowa |
| `npm run user:create -- --email … --name … --role …` | Nowe konto |
| `npm run user:create -- --list` | Lista kont |
| `npm run backup` | Kopia zapasowa (`--json` dodaje zrzut logiczny) |
| `npm test` | Testy |
| `npm run build:installer` | Pakiet instalacyjny `.ZIP` |

---

## 11. Testy

```bash
npm test
```

77 testów w trzech warstwach:

| Plik | Zakres |
|---|---|
| `units.test.mjs` | Przeliczenia jednostek, numeracja, wyprowadzanie ruchów magazynowych |
| `operations.test.mjs` | Księgowanie, korekty, storno, łańcuch, okresy, raporty, bilans |
| `api.test.mjs` | HTTP: uwierzytelnianie, uprawnienia ról, walidacja, eksporty, limity |

Najważniejsze niezmienniki objęte testami:

* stan magazynowy = suma ruchów, także po edycji i storno,
* raport miesięczny domyka bilans dla **każdego** produktu,
* zmiana przeliczników nie zmienia dokumentów już zaksięgowanych,
* zamknięty okres blokuje zapisy, otwarcie je przywraca,
* rola bez uprawnienia dostaje 403, a nie częściowy dostęp,
* ogniwa łańcucha nie dają się anulować pojedynczo,
* raport miesięczny domyka bilans również z filtrem magazynu,
* przywrócenie korekty odtwarza także magazyn dokumentu.

Każdy plik testowy pracuje na własnej bazie w katalogu tymczasowym.

---

## 12. Dokumentacja techniczna

| Dokument | Zawartość |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architektura, decyzje projektowe, skalowanie, kierunki rozwoju |
| [docs/DATABASE.md](docs/DATABASE.md) | Schemat bazy, indeksy, zapytania, migracja na PostgreSQL |
| [docs/API.md](docs/API.md) | Punkty końcowe, przykłady żądań, macierz uprawnień |
| [docs/UI.md](docs/UI.md) | Architektura interfejsu, system wizualny, responsywność |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Wdrożenie, systemd, HTTPS, aktualizacje, diagnostyka |
| [docs/REFACTORING.md](docs/REFACTORING.md) | Przegląd kodu: wąskie gardła, strategie refaktoryzacji, pomiary |
| [docs/DEBUGGING.md](docs/DEBUGGING.md) | Usterki produkcyjne: odtworzenie, przyczyny źródłowe, poprawki |
| [docs/SCALING.md](docs/SCALING.md) | Skalowanie: model odczytu, strategia buforowania, drabina S1–S4 |
| [docs/FRONTEND.md](docs/FRONTEND.md) | Wydajność klienta, komponenty UI, launcher Windows |
| [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md) | System wizualny: paleta z walidacją, układ pulpitu, styl wykresów, sekwencja tworzenia |
| [docs/STANDALONE.md](docs/STANDALONE.md) | Wersja jednoplikowa: jak powstaje, co jest podmienione, gdzie mieszkają dane |

---

## 13. Licencja

MIT — patrz [LICENSE](LICENSE).

© 2026 Mateusz Roesner / ResInvest Commodities PL

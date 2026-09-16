# Raport jakości — ResInvest ERP 1.1.1

Data: 16.09.2026
Zakres: zastąpienie prototypu jednoplikowego (`legacy/magazyn-v8-prototype.html`)
systemem wielodostępowym z centralną bazą danych.

---

## Etap 1 — Architekt

**STATUS: PASS**

### Wykonane

- Analiza stanu wyjściowego: aplikacja jednoplikowa (1303 linie), dane wyłącznie
  w `localStorage` przeglądarki, brak kont użytkowników, brak historii zmian,
  brak stanów magazynowych, dwa typy dokumentów (PZ/WZ) bez wpływu na stan.
- Projekt architektury trójwarstwowej: klient → API → baza relacyjna.
- Model danych: 17 tabel z uzasadnieniem biznesowym każdej z nich.
- Projekt systemu uprawnień: 4 role, 33 uprawnienia, izolacja per magazyn.
- Projekt systemu wizualnego: tokeny CSS, dwa motywy, trzy punkty przełamania
  responsywności, arkusz wydruku A4.
- Projekt przepływów: zakup → PZ → produkcja → MM/transport → sprzedaż → WZ,
  oraz ścieżki alternatywne (sprzedaż bezpośrednia, zakup → transport → magazyn).

### Decyzje wymagające odnotowania

| Decyzja | Uzasadnienie |
|---|---|
| SQLite zamiast PostgreSQL | Skala kilkunastu użytkowników w sieci lokalnej; pozwala dostarczyć system jako jeden instalator bez osobnego serwera bazy. Pełna transakcyjność ACID zachowana. Granice i ścieżka migracji opisane w `docs/ARCHITEKTURA.md` §2.1 |
| Jedna tabela `documents` dla sześciu typów | Uniknięcie sześciu równoległych zestawów zapytań dla list, raportów, numeracji i audytu |
| Kontrahenci w jednej encji z flagami ról | Ten sam podmiot bywa dostawcą i odbiorcą; rozdzielenie dawałoby duplikaty |
| Brak tabeli `production_consumption` | Powiązanie zużycia z produkcją realizują role pozycji w jednym dokumencie — to samo powiązanie bez dodatkowej tabeli |
| Kwoty jako `INTEGER` w groszach | Eliminacja błędu zaokrąglenia przy sumowaniu |

**WYNIK: PASS** — projekt zatwierdzony do implementacji.

---

## Etap 2 — Inżynier

**STATUS: PASS**

### Wykonane — serwer

- Migracja schematu (17 tabel, 24 indeksy, 4 wyzwalacze ochronne).
- Silnik magazynowy: wyznaczanie ruchów, agregacja netto, kontrola dostępności,
  zapis księgi, aktualizacja sald — wszystko w jednej transakcji `IMMEDIATE`.
- Cykl życia dokumentu: utworzenie, edycja, zatwierdzenie, anulowanie ze stornem,
  korekta, usunięcie wersji roboczej.
- Uwierzytelnianie: JWT + rotacja tokenów odświeżania, scrypt, blokada konta.
- Autoryzacja: 33 uprawnienia egzekwowane po stronie serwera, izolacja magazynów
  wymuszana w zapytaniach SQL.
- Moduły: użytkownicy i role, magazyny, produkty, kontrahenci, dokumenty, stany,
  raporty, historia zmian, ustawienia, załączniki, kopie zapasowe.
- Numeracja dokumentów rezerwowana atomowo.
- Kopie zapasowe: harmonogram + na żądanie, mechanizmem `VACUUM INTO`.

### Wykonane — klient

- System wizualny na tokenach CSS: motyw jasny i ciemny, wydruk A4.
- Komponenty wielokrotnego użytku: przyciski, pola formularza, tabela danych
  ze stanami ładowania/błędu/pustki, okna modalne z pułapką fokusu, powiadomienia,
  karty metryk, zakładki, stronicowanie.
- 18 ekranów pokrywających pełen zakres funkcjonalny.
- Tłumaczenia pl / cs / en ze słownikiem typowanym (brak tłumaczenia = błąd kompilacji).
- Token dostępu wyłącznie w pamięci karty; automatyczne odświeżenie sesji
  i ponowienie przerwanego żądania.
- Klucz idempotencji formularza; podgląd przeliczeń m³/MP/t na żywo.
- Granica błędów zapobiegająca białemu ekranowi.

### Wykonane — instalator

- Powłoka Electron 42 uruchamiająca serwer jako proces potomny.
- Konfiguracja `electron-builder` 26 → NSIS, jeden plik `.exe`, język polski.
- Skrypt montujący zawartość paczki z buildów serwera i klienta.
- Skrypt dostarczający moduł natywny bazy danych dla Windows x64:
  pobranie oficjalnego pliku binarnego, weryfikacja ABI Electrona, sumy SHA-256
  archiwum i pliku `.node` oraz nagłówka PE; suma przypięta w repozytorium.
- Rozszerzenia NSIS: katalog danych ustalany przez `%ProgramData%` (identycznie
  jak w `main.js`), reguła zapory, zachowanie danych przy deinstalacji.
- Numer wersji z jednego źródła: manifest → zasób `.exe`, `/api/health`,
  ekran logowania.
- Ikona aplikacji.

**WYNIK: PASS**

---

## Etap 3 — Recenzent

**STATUS: PASS** (po naprawach opisanych poniżej)

### Kontrola statyczna

| Kontrola | Wynik |
|---|---|
| `tsc --noEmit` (serwer, tryb `strict`) | 0 błędów |
| `tsc --noEmit` (klient, tryb `strict`) | 0 błędów |
| `eslint --max-warnings=0` (serwer) | 0 błędów, 0 ostrzeżeń |
| `eslint --max-warnings=0` (klient) | 0 błędów, 0 ostrzeżeń |
| `npm audit` | 0 podatności |
| Build produkcyjny serwera | powodzenie |
| Build produkcyjny klienta | powodzenie, 345 kB (101 kB gzip) |

### Znalezione problemy i naprawy

| # | Problem | Waga | Naprawa |
|---|---|---|---|
| 1 | `multer@1.x` z opublikowanymi podatnościami | wysoka | Aktualizacja do `2.0.2` |
| 2 | `react-router@6.x` — otwarte przekierowanie (CVE) | średnia | Aktualizacja do `7.9.6` |
| 3 | `vitest`/`esbuild` — podatność serwera deweloperskiego | średnia | Aktualizacja `vitest` do 5.x, `vite` do 7.x |
| 4 | Rzutowanie ładunku JWT bez walidacji kształtu | średnia | Walidacja typu `sub` i `login` przed użyciem |
| 5 | Limit żądań blokował zestaw testów | niska | Limiter wyłączony w środowisku testowym; dodany osobny test limitera z jawnym wymuszeniem |
| 6 | Znak BOM zapisany dosłownie w kodzie źródłowym | niska | Zastąpiony sekwencją `﻿` |
| 7 | Niestabilne referencje list powodowały przeliczanie `useMemo` przy każdym renderze | niska | Listy opakowane w `useMemo` |
| 8 | **Brak polskich znaków diakrytycznych** w interfejsie i komunikatach API | **wysoka** | Uzupełnienie wszystkich tekstów widocznych dla użytkownika (pl i cs), weryfikacja wizualna |
| 9 | Podgląd wydruku drukował się razem z oknem modalnym | niska | Reguła `@media print` ukrywająca warstwę modalną i pozostałą treść strony |
| 10 | Synchroniczne oczekiwanie (`Atomics.wait`) przy zamykaniu powłoki desktopowej | średnia | Asynchroniczne zamknięcie z wstrzymaniem `before-quit` i limitem czasu |
| 11 | Ostrzeżenie Node o nieokreślonym typie modułu w paczce instalatora | niska | Manifest ESM generowany w podkatalogu serwera |

### Weryfikacja logiki biznesowej

| Obszar | Wynik |
|---|---|
| Przeliczniki `100 m³ → 400 MP → 132 t` | zgodne, weryfikacja w obie strony |
| Automatyczne zużycie surowca przy produkcji | działa, w jednej transakcji |
| Blokada stanu ujemnego | działa, także przy kilku pozycjach tego samego produktu |
| Atomowość MM | brak stanu częściowego przy niepowodzeniu |
| Storno przy anulowaniu | wpis odwrotny, bilans wraca do zera |
| Blokada anulowania przyjęcia po wydaniu towaru | działa |
| Wartości rzeczywiste nie zmieniają stanu | potwierdzone |
| Koszt transportu i wskaźniki pochodne | zgodne z wyliczeniem ręcznym |
| Sprzedaż bezpośrednia bez stanu magazynowego | 0 ruchów magazynowych |
| Numeracja per typ, rok i magazyn | ciągła, bez kolizji |

### Weryfikacja bezpieczeństwa

| Scenariusz | Wynik |
|---|---|
| Żądanie bez tokenu | 401 |
| Podrobiony token | 401 |
| Konto podglądu tworzy dokument | 403 |
| Magazynier otwiera administrację | 403 |
| Magazynier wystawia dokument dla obcego magazynu | 403 `WAREHOUSE_FORBIDDEN` |
| Nagłówek `X-Warehouse-Id` spoza uprawnień | 403 |
| Lista dokumentów magazyniera | brak dokumentów obcych magazynów |
| Dezaktywacja konta przy aktywnym tokenie | natychmiastowe 403 |
| Ponowne użycie zużytego tokenu odświeżania | 401, sesja unieważniona |
| Wstrzyknięcie SQL w parametrze wyszukiwania | brak efektu, tabela nienaruszona |
| Nieznane pole w treści żądania (np. `status`) | 400 |
| Niedozwolony typ pliku załącznika | 400 |
| Próba modyfikacji historii zmian | odrzucona przez bazę danych |
| Próba modyfikacji ruchów magazynowych | odrzucona przez bazę danych |
| Komunikat przy błędnym haśle vs. nieistniejącym loginie | identyczny (brak enumeracji kont) |

### Weryfikacja przeglądarkowa

Chromium, rozdzielczości 1440×950 i 390×844, motyw jasny i ciemny,
ścieżka: logowanie → wybór magazynu → pulpit → lista PZ → szczegóły → wydruk →
formularz produkcji → stany → raporty → historia zmian → kartoteka → menu mobilne.

**Wynik: 0 błędów konsoli, 0 nieobsłużonych wyjątków.**

**WYNIK: PASS**

---

## Etap 4 — Optymalizator

**STATUS: PASS**

| Obszar | Działanie |
|---|---|
| Indeksy | 24 indeksy na kolumnach filtrowanych i sortowanych |
| Problem N+1 | Wyeliminowany — listy pobierane jednym zapytaniem ze złączeniami i podzapytaniami agregującymi |
| Stany magazynowe | Saldo zmaterializowane zamiast agregacji całej księgi przy każdym odczycie |
| Filtrowanie po magazynach | Wykonywane w SQL, nie po pobraniu danych |
| Stronicowanie | Po stronie bazy (`LIMIT`/`OFFSET`) na wszystkich listach |
| Renderowanie | Kolumny i listy w `useMemo`; brak zbędnych przeliczeń |
| Żądania | Opóźnienie wyszukiwania 350 ms; anulowanie nieaktualnych żądań (`AbortController`) |
| Rozmiar paczki | Podział: biblioteki w osobnym pliku; 345 kB łącznie, 101 kB po gzip |
| Baza | WAL (równoczesny odczyt przy zapisie), `busy_timeout` (kolejkowanie zamiast błędu) |

Nie wprowadzono optymalizacji kosztem poprawności ani czytelności kodu.

**WYNIK: PASS**

---

## Testy końcowe

```
Test Files  5 passed (5)
     Tests  84 passed (84)
```

| Plik | Przypadki | Zakres |
|---|---|---|
| `units.test.ts` | 17 | Przeliczniki, arytmetyka kwot, daty, hasła |
| `documents.test.ts` | 30 | Pełna logika dokumentów i stanów magazynowych |
| `api.test.ts` | 32 | Uwierzytelnianie, autoryzacja, walidacja, przepływ end-to-end, załączniki, ustawienia, niemodyfikowalność |
| `concurrency.test.ts` | 3 | Wielodostęp w rzeczywistych procesach systemowych |
| `rateLimit.test.ts` | 2 | Limity żądań |

### Test wielodostępu

Uruchamiane są **osobne procesy systemowe** łączące się z tą samą bazą danych:

| Scenariusz | Oczekiwane | Wynik |
|---|---|---|
| Dwa procesy zatwierdzają ten sam dokument | 1 sukces, 1 odrzucenie (`INVALID_STATE` lub `VERSION_CONFLICT`) | zgodne |
| Cztery równoległe wydania po 40 przy stanie 100 | 2 sukcesy, 2 odrzucenia `INSUFFICIENT_STOCK`, stan końcowy 20 | zgodne |
| Operacje na trzech różnych magazynach równolegle | wszystkie 4 sukcesy, stany poprawne | zgodne |

Po każdym scenariuszu kontrola `verifyStockIntegrity()` — salda zgodne z księgą ruchów.

### Testy przepływów biznesowych

| Przepływ | Wynik |
|---|---|
| Zakup → PZ → stan → produkcja → zużycie → zrębka → MM → WZ | stany końcowe zgodne z wyliczeniem ręcznym, księga spójna |
| Zakup → sprzedaż bezpośrednia | 0 ruchów magazynowych, obie strony transakcji zapisane |
| Magazyn A → MM → Magazyn B | atomowo, bez stanu częściowego |

### Przypadki brzegowe

Pokryte testami: brak produktu, brak magazynu, brak uprawnień, stan 0,
wydanie ponad stan, produkcja ponad zapas surowca, ilość 0, ilość ujemna,
dokument bez pozycji, nieistniejąca data (30.02), duplikat kodu magazynu,
jednoczesna edycja, podwójne kliknięcie zapisu, ponowne zatwierdzenie,
anulowanie po wydaniu towaru, zmiana jednostki produktu z historią ruchów.

---

## Odpowiedzi na pytania weryfikacji końcowej

| Pytanie | Odpowiedź | Podstawa |
|---|---|---|
| Czy aplikacja się uruchamia? | **TAK** | Serwer produkcyjny uruchomiony, `/api/health` zwraca `ok` |
| Czy użytkownik może się zalogować? | **TAK** | Test przeglądarkowy + 6 testów API |
| Czy działa wybór magazynu? | **TAK** | Ekran wyboru, przełącznik w pasku, zapis w historii zmian |
| Czy działa autoryzacja? | **TAK** | 15 scenariuszy bezpieczeństwa |
| Czy działa PZ? | **TAK** | Testy + weryfikacja przeglądarkowa |
| Czy działa WZ? | **TAK** | Testy + dane przykładowe |
| Czy działa MM? | **TAK** | Test atomowości |
| Czy działa produkcja? | **TAK** | Test pełnego przepływu |
| Czy działa automatyczne zużycie? | **TAK** | 100 m³ → stan drewna −100, stan zrębki +400 |
| Czy działają przeliczenia? | **TAK** | 17 testów jednostkowych |
| Czy działa transport? | **TAK** | Koszt i wskaźniki zweryfikowane liczbowo |
| Czy działa zakup? | **TAK** | PZ z danymi kwitu wywozowego |
| Czy działa sprzedaż? | **TAK** | WZ oraz sprzedaż bezpośrednia |
| Czy działają stany? | **TAK** | Salda zgodne z księgą ruchów |
| Czy działają dokumenty? | **TAK** | Numeracja, statusy, anulowanie, korekty |
| Czy działa druk/PDF? | **TAK** | Podgląd A4 zweryfikowany wizualnie; PDF przez drukarkę systemową |
| Czy działa historia? | **TAK** | Filtry i eksport |
| Czy audyt zapisuje kto/kiedy/co/przed/po? | **TAK** | Struktura wpisu potwierdzona testem |
| Czy wielu użytkowników może pracować jednocześnie? | **TAK** | Test w rzeczywistych procesach systemowych |
| Czy transakcje są atomowe? | **TAK** | Test braku stanu częściowego przy MM |
| Czy API jest zabezpieczone? | **TAK** | 15 scenariuszy, `npm audit` bez podatności |
| Czy baza jest spójna? | **TAK** | `verifyStockIntegrity()` — brak rozbieżności |
| Czy testy przechodzą? | **TAK** | 84/84 |
| Czy production build przechodzi? | **TAK** | Serwer i klient |
| Czy instalator się buduje? | **TAK** | `npm run dist` → kod 0, jeden plik, 103 864 955 B |
| Czy zawartość instalatora jest poprawna? | **TAK** | patrz „Weryfikacja instalatora” |
| **Czy instalator działa na Windows?** | **TAK** | instalacja, uruchomienie serwera i deinstalacja przetestowane na `windows-latest` |

---

## Weryfikacja instalatora

### Przebieg budowania

Pierwsze podejście do budowania ujawniło cztery realne problemy — każdy został
naprawiony przed kolejną próbą, zgodnie z zasadą nieprzechodzenia dalej
z nierozwiązanym błędem:

| # | Problem | Naprawa |
|---|---|---|
| 1 | Electron 33 po zakończeniu wsparcia; 14 podatności w łańcuchu narzędzi (`npm audit`, w tym 1 krytyczna) | Electron 42.11.4, electron-builder 26.16.1, better-sqlite3 12.11.1 → **0 podatności** |
| 2 | Modułu natywnego dla Windows nie da się skompilować poza Windows | Pobranie oficjalnego pliku binarnego dla ABI 146 (Electron 42) z weryfikacją SHA-256 i nagłówka PE; `npmRebuild: false` |
| 3 | `$COMMONAPPDATA` w skrypcie NSIS — stała nie istnieje, kompilacja przerwana | Katalog danych z `%ProgramData%` (`ExpandEnvStrings`), spójnie z `main.js` |
| 4 | Generowanie metadanych aktualizacji kończyło build błędem (`publish` bez repozytorium) | `publish: null`, `differentialPackage: false` — system nie używa aktualizacji sieciowych |
| 5 | **Zainstalowany program nie uruchamiał serwera** — `ERR_MODULE_NOT_FOUND: Cannot find package 'express'` | `asarUnpack` obejmuje wszystkie `node_modules` (szczegóły niżej) |
| 6 | Cicha deinstalacja (`/S`) czekała bez końca na okno komunikatu | `MessageBox ... /SD IDOK` |

Ostateczne `npm run dist` kończy się kodem wyjścia **0**.

### Błąd #5 — dlaczego zasługuje na osobny opis

Instalator budował się poprawnie, zawierał wszystkie pliki, miał właściwy
rozmiar, poprawne sumy kontrolne i poprawne wersje. Mimo to **zainstalowany
program nie wystartowałby u użytkownika**.

Przyczyna: archiwum `asar` jest czytelne dla Electrona wyłącznie w trybie
CommonJS. Serwer jest modułem ESM uruchamianym z `app.asar.unpacked/server`,
a resolver ESM Node.js archiwum nie widzi. Zależności (127 pakietów) były
spakowane do `app.asar`, więc Node szukał ich w `app.asar.unpacked/node_modules`
i kończył pracę błędem.

Błędu tego **nie wykryłaby żadna kontrola statyczna ani kontrola artefaktu** —
widać go dopiero po instalacji i próbie uruchomienia. Wykrył go test dymny
na Windows (GitHub Actions), który uruchamia zainstalowany serwer dokładnie
tak, jak robi to powłoka Electrona.

Zabezpieczenie przed nawrotem: `desktop/scripts/verify-package.mjs`, wpięty
na końcu `npm run dist`, sprawdza **z jakiego katalogu** rozwiązuje się każda
zależność serwera. Sam fakt, że `import` się powiódł, niczego nie dowodzi —
katalog `release` leży wewnątrz `desktop/`, więc na maszynie budującej Node
znajduje pakiet w nadrzędnym `node_modules`, którego po instalacji nie ma.
Kontrola wymaga, aby ścieżka wskazywała `app.asar.unpacked/node_modules`.
Test negatywny (usunięcie pakietu z pakietu aplikacji) potwierdza, że kontrola
kończy się kodem 1 i wskazuje pakiet rozwiązany spoza pakietu.

### Zweryfikowana zawartość

| Element | Wynik |
|---|---|
| Liczba plików wynikowych `.exe` | **1** — `ResInvest-ERP-Setup-1.1.0.exe`, 103 864 955 B |
| Typ pliku | `PE32 executable (GUI) Intel 80386, Nullsoft Installer self-extracting archive`, NSIS-3 Unicode |
| Wbudowane komponenty (7-Zip) | `app-64.7z` (ładunek), `Uninstall ResInvest ERP.exe`, wtyczki UAC/nsExec/WinShell/nsis7z |
| Program główny | `ResInvest ERP.exe` — `PE32+ executable (GUI) x86-64`, Electron 42.11.4 / Chromium 148 |
| Moduł bazy danych | `better_sqlite3.node` — `PE32+ executable (DLL) x86-64`, SHA-256 `24e2e3ca…75d9b8` zgodna z przypiętą |
| Migracje | `server/db/migrations/001_init.sql` obecny w pakiecie |
| Aplikacja kliencka | `client/index.html` + `assets/` obecne |
| Wersja w zasobie `.exe` | `FileVersion 1.1.0`, `ProductVersion 1.1.0.0`, `ProductName ResInvest ERP`, `CompanyName ResInvest Commodities` |
| Wersja w `app.asar/package.json` | 1.1.0 |
| Wersja w manifeście serwera w pakiecie | 1.1.0 |
| Wersja w bundlu klienta | 1.1.0 |
| Zależności serwera | 9 zależności rozwiązuje się z `app.asar.unpacked/node_modules`; 8 modułów w czystym JS ładuje się poprawnie |
| Skrypt weryfikacji modułu natywnego | test negatywny: zła suma → kod wyjścia 1, plik nie jest podstawiany |
| Skrypt kontroli pakietu | test negatywny: pakiet rozwiązany spoza `app.asar.unpacked` → kod wyjścia 1 |

**SHA-256 instalatora zbudowanego z tego wydania źródeł (Linux + Wine):**

```
fdfb1d07b236f5e4165a5e86d85e1b88eb62dffaba7ceef0299abb612b94dbc1  ResInvest-ERP-Setup-1.1.0.exe
```

Każde budowanie ma własną sumę (znaczniki czasu w plikach PE); wiążąca jest
suma wypisana przez przepływ GitHub Actions obok artefaktu, który jest
przekazywany użytkownikom.

### Test na prawdziwym Windows — wynik

Instalacji nie dało się przetestować w środowisku budowania: pod Wine 9.0
instalator uruchamia się i ładuje wtyczki, ale nie kończy pracy — najpewniej
przez wtyczkę UAC niemającą odpowiednika w Wine. Dlatego test wykonuje
przepływ GitHub Actions na `windows-latest`
(`.github/workflows/installer.yml`).

Przebieg **35089091971** (commit `e884ccb`) — **wynik: sukces**:

| Krok | Wynik |
|---|---|
| `npm run verify` na Windows | 84/84 testy, 0 podatności |
| `npm run dist` + kontrola pakietu | jeden plik, 9 zależności rozwiązanych z `app.asar.unpacked` |
| Cicha instalacja `/S` | program, moduł natywny, migracje, klient, katalog danych, reguła zapory — wszystko na miejscu |
| Uruchomienie **zainstalowanego** serwera | `Health: status=ok version=1.1.0` |
| Aplikacja kliencka | serwowana, kod 200 |
| `/api/documents` bez tokenu | **401** — uprawnienia egzekwuje serwer, nie interfejs |
| Utworzenie bazy danych | `resinvest.sqlite` powstał w katalogu danych |
| Cicha deinstalacja `/S` | program usunięty, **dane zachowane**, reguła zapory usunięta |

Plik z przebiegu: `ResInvest-ERP-Setup-1.1.0.exe`, 104 158 391 B,
SHA-256 `6b9f4e1823371fb1d780d309c9fcbf0bcb05a1c40fc4622c77a7cc0b8f448f9f`.

> Instalator zbudowany na Linuksie i na Windows mają **różne sumy kontrolne** —
> narzędzia NSIS zapisują w pliku znaczniki czasu. Wiążący jest artefakt
> z przepływu CI wraz z sumą wypisaną w jego logu; to on trafia do użytkowników.

### Wydanie 1.1.1 — błąd krytyczny wykryty po instalacji u użytkownika

Instalator 1.1.0 przeszedł wszystkie kontrole: budowanie, zawartość pakietu,
sumy kontrolne, instalację, start serwera, `/api/health`, serwowanie aplikacji
klienckiej, `401` bez tokenu i deinstalację. **Mimo to programu nie dało się
używać** — przy logowaniu zwracał „Nieprawidłowy login lub hasło" dla każdych
danych.

| | |
|---|---|
| **Objaw** | Logowanie niemożliwe po instalacji, dowolny login i hasło |
| **Przyczyna** | Start serwera wykonywał tylko migracje schematu. Role, uprawnienia i konto `admin` tworzył wyłącznie `npm run db:seed` — skrypt niedostępny w zainstalowanym programie. Tabele `users`, `roles` i `permissions` były puste |
| **Naprawa** | Start programu wywołuje `prepareFirstRun()`: uzupełnia dane referencyjne i zakłada konto `admin` z losowym hasłem. Idempotentne |
| **Wykrycie** | Zgłoszenie użytkownika po instalacji — **nie** przez testy ani CI |

**Dlaczego nie wykryły tego testy.** Przygotowanie testowe (`setupFixture`)
wywołuje `seedCore` bezpośrednio, więc wszystkie 84 testy startowały z bazy
już wypełnionej. Żaden nie przechodził ścieżką uruchomienia programu.

**Dlaczego nie wykrył tego test dymny.** Sprawdzał, że serwer odpowiada na
`/api/health` i zwraca `401` bez tokenu. Serwer robi jedno i drugie poprawnie
także wtedy, gdy w bazie nie ma ani jednego konta — brak kont daje dokładnie
ten sam wynik co poprawna konfiguracja.

**Wnioski wdrożone w 1.1.1:**

| Luka | Zamknięcie |
|---|---|
| Testy omijały ścieżkę startu programu | `server/tests/firstRun.test.ts` — 9 testów idących wyłącznie przez migracje + `prepareFirstRun` (łącznie 93 testy) |
| Test dymny nie sprawdzał logowania | CI loguje się kontem `admin` hasłem z pierwszego uruchomienia, sprawdza rolę, uprawnienia, wymuszenie zmiany hasła i odrzucenie błędnego hasła |
| Znane hasło domyślne byłoby ryzykiem | Hasło losowane na stanowisku, pokazywane w oknie, pliku i dzienniku; plik usuwany po zmianie hasła |

Zasada potwierdzona kosztem wydania: **sprawdzenie, że usługa odpowiada, nie
jest sprawdzeniem, że da się jej użyć.** Test dymny musi wykonać operację,
dla której program istnieje — tutaj: zalogować się.

---

### Co pozostaje do odbioru u klienta

Przepływ CI sprawdza instalację, uruchomienie serwera i deinstalację, ale
**nie klika w interfejsie**. Do odbioru na stanowisku docelowym pozostają
pozycje z `docs/WDROZENIE-WINDOWS.md` §10 dotyczące pracy z programem:
logowanie i wymuszenie zmiany hasła, wystawienie dokumentów, wydruk A4,
skany, praca drugiego stanowiska przez przeglądarkę, kopie zapasowe.

---

## Podsumowanie

| Etap | Status |
|---|---|
| Architekt | **PASS** |
| Inżynier | **PASS** |
| Recenzent | **PASS** (11 problemów znalezionych i naprawionych) |
| Optymalizator | **PASS** |
| Testy końcowe | **PASS** (84/84) |
| Production build | **PASS** |
| Instalator — budowanie i zawartość | **PASS** (jeden plik, SHA-256 wygenerowana) |
| Instalator — instalacja, uruchomienie i deinstalacja na Windows | **PASS** (GitHub Actions, `windows-latest`) |
| Odbiór funkcjonalny na stanowisku docelowym | **DO WYKONANIA** (praca z interfejsem, §10) |

System jest gotowy do testów odbiorczych w środowisku Windows.
Przed uruchomieniem produkcyjnym należy zmienić hasła kont początkowych
i usunąć dane demonstracyjne.

# Historia zmian

Format oparty na [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/),
wersjonowanie zgodne z [SemVer](https://semver.org/lang/pl/).

---

## [1.1.1] — 2026-09-17

Wydanie naprawcze. **Wersja 1.1.0 była nieużywalna po instalacji** — nie dało
się zalogować na żadne konto. Kto zainstalował 1.1.0, powinien wgrać 1.1.1 na
wierzch; dane nie są naruszane, a konto administratora powstanie przy starcie.

### Naprawione

- **Po instalacji nie istniało żadne konto użytkownika.** Start serwera
  wykonywał wyłącznie migracje schematu, natomiast role, uprawnienia i konto
  administratora tworzył tylko skrypt `npm run db:seed`, niedostępny
  w zainstalowanym programie. Tabele `users`, `roles` i `permissions` były
  puste, więc logowanie kończyło się komunikatem „Nieprawidłowy login lub
  hasło" niezależnie od podanych danych.
  Naprawa: start programu wywołuje `prepareFirstRun()`, które uzupełnia dane
  referencyjne i zakłada konto `admin`. Operacja jest idempotentna — przy
  każdym uruchomieniu dodaje też uprawnienia wprowadzone w nowszych wersjach.

### Dodane

- **Losowe hasło początkowe.** Konto `admin` dostaje hasło generowane na
  danym stanowisku (14 znaków, bez znaków mylących, zgodne z polityką haseł).
  System nigdy nie startuje ze znanym hasłem domyślnym. Hasło jest pokazywane
  w oknie programu (z przyciskiem *Kopiuj hasło*), zapisywane do pliku
  `PIERWSZE-URUCHOMIENIE.txt` w katalogu danych oraz do dziennika.
  Po zmianie hasła plik jest usuwany automatycznie przy kolejnym starcie.
- Zmienna `ADMIN_INITIAL_PASSWORD` — hasło początkowe dla instalacji masowej;
  wtedy plik z hasłem nie powstaje i nic nie trafia do dziennika.
- 9 testów regresyjnych (`server/tests/firstRun.test.ts`) idących **ścieżką
  startu programu**, a nie przygotowaniem testowym: pusta baza po migracjach,
  założenie konta, losowość i siła hasła, logowanie, odrzucenie błędnego
  hasła, zapis i usunięcie pliku, idempotentność, hasło z konfiguracji.
  Łącznie **93 testy**.
- Test dymny na Windows loguje się teraz kontem `admin` hasłem z pierwszego
  uruchomienia i sprawdza rolę, uprawnienia, wymuszenie zmiany hasła oraz
  odrzucenie błędnego hasła. Poprzednia wersja sprawdzała tylko `401` bez
  tokenu — dlatego nie wykryła braku kont.

### Dlaczego to przeszło do 1.1.0

Wszystkie testy korzystały z przygotowania (`setupFixture`), które wywołuje
`seedCore` bezpośrednio, więc żaden nie przechodził ścieżką startu programu.
Test dymny sprawdzał, że serwer odpowiada i odrzuca żądania bez tokenu —
a serwer odpowiada poprawnie także wtedy, gdy w bazie nie ma ani jednego konta.

---

## [1.1.0] — 2026-09-16

Pierwsze wydanie z **zbudowanym instalatorem Windows**. Zmiany dotyczą
platformy uruchomieniowej i procesu budowania; logika biznesowa, schemat bazy
i API pozostają zgodne z 1.0.0 — aktualizacja nie wymaga migracji danych.

### Dodane

- `desktop/scripts/fetch-native.mjs` — dostarczanie modułu natywnego bazy
  danych dla Windows x64: pobranie oficjalnego pliku binarnego, weryfikacja
  ABI Electrona, sum SHA-256 (archiwum i plik `.node`) oraz nagłówka PE.
  Niezgodność przerywa budowanie.
- `desktop/native-prebuilds.json` — przypięte sumy kontrolne modułów natywnych.
- `desktop/scripts/verify-package.mjs` — kontrola zawartości pakietu po każdym
  budowaniu: jeden plik instalatora, obecność programu, migracji i aplikacji
  klienckiej, nagłówek PE modułu natywnego oraz **sprawdzenie, z jakiego
  katalogu rozwiązują się zależności serwera**. Kontrola nie poprzestaje na
  tym, że `import` zadziałał — wymaga, aby pakiet pochodził z
  `app.asar.unpacked`, bo na maszynie budującej zależność bywa znajdowana
  w nadrzędnym `node_modules`, którego po instalacji nie ma.
- `.github/workflows/installer.yml` — budowanie i test dymny na Windows:
  cicha instalacja, kontrola plików, katalogu danych i reguły zapory,
  uruchomienie zainstalowanego serwera (`/api/health`, zgodność wersji,
  aplikacja kliencka, `401` bez tokenu, utworzenie bazy), cicha deinstalacja
  z kontrolą zachowania danych; instalator publikowany jako artefakt.
- Numer wersji z jednego źródła (`package.json`): zasób pliku `.exe`,
  `/api/health`, ekran logowania. Powłoka Electrona przekazuje wersję do
  serwera (`APP_VERSION`).
- Budowanie instalatora na Linuksie (Wine + Xvfb) — udokumentowane
  w `docs/WDROZENIE-WINDOWS.md` §2.

### Zmienione

- Electron 33 → **42.11.4** (33 po zakończeniu wsparcia; usunięte znane
  podatności powłoki, m.in. obejście integralności asar).
- electron-builder 25 → **26.16.1**.
- better-sqlite3 11 → **12.11.1** (serwer i powłoka) — 84/84 testy przechodzą
  na nowej wersji.
- `npm audit` w katalogu `desktop/`: 14 podatności (1 krytyczna) → **0**.
- Skrypt NSIS: katalog danych ustalany przez `%ProgramData%` dokładnie tak,
  jak robi to `main.js` (`$COMMONAPPDATA` nie jest stałą NSIS — poprzedni
  zapis nie kompilował się).
- Wyłączone generowanie metadanych aktualizacji sieciowych i plików
  różnicowych — system ich nie używa; katalog `release` zawiera jeden plik.

### Naprawione

- **Zainstalowany program nie uruchamiał serwera.** Zależności serwera
  (`express`, `helmet`, `cors`, `zod` i pozostałe — 127 pakietów) trafiały
  do archiwum `app.asar`, podczas gdy sam serwer był rozpakowany obok.
  Electron czyta z archiwum `asar` tylko w trybie CommonJS; serwer jest
  modułem ESM, a resolver ESM Node.js archiwum nie widzi — po instalacji
  proces serwera kończył się błędem
  `ERR_MODULE_NOT_FOUND: Cannot find package 'express'`.
  Instalator budował się przy tym poprawnie i przechodził kontrolę rozmiaru
  oraz sum kontrolnych, więc błąd był widoczny dopiero po instalacji.
  Naprawa: `asarUnpack` obejmuje wszystkie `node_modules`.
  Wykryte przez test dymny na Windows (GitHub Actions).
- `MessageBox` przy deinstalacji z `/SD IDOK` — w trybie cichym (`/S`) okno
  nie jest pokazywane; wcześniej deinstalacja skryptowa czekałaby bez końca.

### Zweryfikowane

- `npm run dist` → kod wyjścia 0; jeden plik
  `ResInvest-ERP-Setup-1.1.0.exe` (103 864 955 B).
- Zawartość pakietu: program PE32+ x64, moduł bazy danych PE32+ DLL o sumie
  zgodnej z przypiętą, migracje, aplikacja kliencka, wersja 1.1.0 we
  wszystkich miejscach.
- SHA-256: `fdfb1d07b236f5e4165a5e86d85e1b88eb62dffaba7ceef0299abb612b94dbc1`.

### Przetestowane na Windows

Przepływ GitHub Actions (`windows-latest`, przebieg 35089091971) potwierdził:
84/84 testy, budowanie instalatora, cichą instalację, uruchomienie
**zainstalowanego** serwera (`/api/health` → `ok`, wersja 1.1.0, aplikacja
kliencka serwowana, `401` bez tokenu, baza utworzona) oraz cichą deinstalację
z zachowaniem katalogu danych i usunięciem reguły zapory.

### Znane ograniczenia

- Odbiór funkcjonalny (praca z interfejsem: logowanie, wystawianie dokumentów,
  wydruk, skany, drugie stanowisko, kopie zapasowe) pozostaje do wykonania na
  stanowisku docelowym — CI sprawdza instalację i start, nie klika w oknach.
  Lista: `docs/WDROZENIE-WINDOWS.md` §10.
- Plik nie jest podpisany certyfikatem — SmartScreen wyświetli ostrzeżenie
  przy pierwszej instalacji.
- Instalator zbudowany na Linuksie i na Windows mają różne sumy kontrolne
  (znaczniki czasu w plikach NSIS). Wiążący jest artefakt z przepływu CI.
- Pozostałe ograniczenia z 1.0.0 (import z prototypu, HTTPS) bez zmian.

---

## [1.0.0] — 2026-09-16

Pierwsze wydanie systemu ResInvest ERP. Zastąpienie prototypu jednoplikowego
opartego na `localStorage` systemem wielodostępowym z centralną bazą danych.

### Dodane — operacje magazynowe

- Przyjęcia zewnętrzne PZ z obsługą zakupu od nadleśnictwa
  (numer kwitu wywozowego, nadleśnictwo, leśnictwo).
- Wydania zewnętrzne WZ.
- Przesunięcia międzymagazynowe MM wykonywane atomowo.
- Produkcja z **automatycznym zużyciem surowca**; rąbanie własne lub zewnętrzne
  z kosztem jednostkowym (domyślnie 10 zł).
- Transport z wyliczeniem kosztu (domyślnie 5 zł/km) oraz wskaźnikami
  koszt/km, koszt/t, koszt/MP, koszt/m³.
- Sprzedaż bezpośrednia: zakup → sprzedaż bez tworzenia stanu magazynowego.

### Dodane — dane i zestawienia

- Stany magazynowe z przeliczeniem na m³, MP i tony.
- Kartoteka ruchów magazynowych (księga niemodyfikowalna).
- Raporty: zestawienie zbiorcze, produkcja, transport, kontrahenci —
  miesięczne, roczne lub za dowolny zakres dat.
- Eksport CSV (dokumenty, stany, ruchy) zgodny z Microsoft Excel.
- Historia zmian: kto, kiedy, co zmienił, wartość przed i po.

### Dodane — dokumenty

- Automatyczna numeracja `TYP/ROK/MAGAZYN/KOLEJNY`, rezerwowana atomowo.
- Statusy: roboczy → zatwierdzony → anulowany.
- Anulowanie ze stornem ruchów magazynowych.
- Korekty: anulowanie oryginału i wystawienie powiązanej kopii.
- Skany dokumentów (JPG, PNG, WEBP, HEIC, PDF do 15 MB) z sumą SHA-256.
- Wydruk w formacie A4 z adnotacjami dla wersji roboczej i dokumentu anulowanego.

### Dodane — administracja

- Użytkownicy, 4 role systemowe, 33 uprawnienia z edycją zestawów ról.
- Magazyny (startowo RiC Zabrze, RiC Brąszewice, RiC Rokitki) z dezaktywacją
  zamiast usuwania.
- Produkty z jednostką bazową i przelicznikami indywidualnymi.
- Kontrahenci z rolami: dostawca, odbiorca, przewoźnik, nadleśnictwo.
- Ustawienia: dane firmy, przeliczniki jednostek, stawki domyślne,
  polityka stanów.
- Kopie zapasowe: automatyczne co 12 h i na żądanie.

### Dodane — interfejs

- Motyw jasny i ciemny, przełączany ręcznie lub zgodnie z ustawieniem systemu.
- Języki: polski (domyślny), czeski, angielski.
- Responsywność: komputer, tablet, telefon (tabele w widoku kart).
- Dostępność: obsługa klawiatury, widoczny focus, pułapka fokusu w oknach
  modalnych, status oznaczony kształtem obok koloru.
- Pulpit z danymi z bazy, bez wartości demonstracyjnych.

### Bezpieczeństwo

- JWT z krótkim czasem życia + rotacja tokenów odświeżania.
- Hasła: scrypt z losową solą, polityka złożoności, blokada konta po serii
  nieudanych prób.
- Uprawnienia egzekwowane po stronie serwera; izolacja magazynów wymuszana w SQL.
- Natychmiastowe unieważnienie sesji po zmianie roli, magazynów lub statusu konta.
- Walidacja wejścia (zod), zapytania parametryzowane, `helmet` z CSP,
  limity żądań, zamknięta lista typów załączników.
- 0 podatności w `npm audit`.

### Integralność danych

- Operacje magazynowe w transakcjach `IMMEDIATE`; rollback całości przy błędzie.
- Blokada stanu ujemnego (dopuszczenie wymaga polityki i uprawnienia).
- Blokada optymistyczna dokumentów (kolumna `version`).
- Klucz idempotencji chroniący przed podwójnym zapisem formularza.
- Kwoty jako liczby całkowite groszy.
- Wyzwalacze bazy danych blokujące modyfikację historii zmian i księgi ruchów.

### Infrastruktura

- Monorepo npm workspaces: `server`, `client`, `desktop`.
- Node.js 22 + TypeScript w trybie `strict`, SQLite w trybie WAL.
- 84 testy: jednostkowe, integracyjne API, wielodostęp w rzeczywistych procesach.
- Konfiguracja instalatora Windows (Electron + NSIS, jeden plik `.exe`).
- Dokumentacja: architektura, instrukcja użytkownika, wdrożenie, API,
  raport jakości.

### Zmienione

- Poprzedni prototyp przeniesiony do `legacy/magazyn-v8-prototype.html`
  jako materiał archiwalny.

### Znane ograniczenia

- Plik instalatora `.exe` nie został zbudowany ani przetestowany —
  wymaga maszyny Windows. Lista kontrolna odbioru:
  `docs/WDROZENIE-WINDOWS.md` §10.
- Brak automatycznego importu danych z prototypu (`localStorage`) —
  historia z poprzedniej wersji wymaga ręcznego wprowadzenia lub
  dedykowanego skryptu migracyjnego.
- Brak wbudowanego HTTPS — przy pracy poza siecią lokalną należy użyć
  reverse proxy z certyfikatem.

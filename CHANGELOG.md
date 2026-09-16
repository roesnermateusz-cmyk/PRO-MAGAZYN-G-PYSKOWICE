# Historia zmian

Format oparty na [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/),
wersjonowanie zgodne z [SemVer](https://semver.org/lang/pl/).

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

### Zweryfikowane

- `npm run dist` → kod wyjścia 0; jeden plik
  `ResInvest-ERP-Setup-1.1.0.exe` (103 856 460 B).
- Zawartość pakietu: program PE32+ x64, moduł bazy danych PE32+ DLL o sumie
  zgodnej z przypiętą, migracje, aplikacja kliencka, wersja 1.1.0 we
  wszystkich miejscach.
- SHA-256: `87fd3d1db3c512850817c7e7f4813cad571109ae755b521711b0a3212f06da08`.

### Znane ograniczenia

- Instalacja i uruchomienie na **fizycznym Windows** pozostają do odbioru
  (lista kontrolna: `docs/WDROZENIE-WINDOWS.md` §10). Próba instalacji pod
  Wine nie kończy się — nie jest to dowód błędu, ale nie zastępuje testu.
- Plik nie jest podpisany certyfikatem — SmartScreen wyświetli ostrzeżenie
  przy pierwszej instalacji.
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

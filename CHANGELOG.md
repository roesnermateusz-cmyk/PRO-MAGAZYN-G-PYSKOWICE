# Historia zmian

Format oparty na [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/),
wersjonowanie zgodne z [SemVer](https://semver.org/lang/pl/).

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

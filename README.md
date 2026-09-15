# PRO-MAGAZYN

System ewidencji magazynowej dla obrotu biomasą i drewnem (zrębka, drewno opałowe,
pozostałości tartaczne, PKS, CNCS). Skoroszyt Excel z makrami VBA, zaprojektowany
do wieloletniej pracy produkcyjnej: pełna historia operacji, dokumenty magazynowe,
raporty, korekty, kopie zapasowe i praca wielu użytkowników.

Wersja **2.0.0** — następca arkusza „Magazyn Zabrze”, z przebudowanym silnikiem,
nowym typem operacji **TRANSPORT** i listami rozwijanymi we wszystkich kolumnach.

---

## Spis treści

- [Co system potrafi](#co-system-potrafi)
- [Instalacja](#instalacja)
- [Pierwsze uruchomienie](#pierwsze-uruchomienie)
- [Praca z systemem](#praca-z-systemem)
- [Typy operacji](#typy-operacji)
- [Operacje równoległe](#operacje-równoległe)
- [Architektura](#architektura)
- [Budowanie ze źródeł](#budowanie-ze-źródeł)
- [Co zostało naprawione](#co-zostało-naprawione)
- [Licencja](#licencja)

---

## Co system potrafi

| Obszar | Zakres |
|---|---|
| Ewidencja | Zakup, sprzedaż, produkcja, zużycie, przesunięcia MM, **transport** |
| Kartoteka | 43 kolumny, w tym 13 wyliczanych automatycznie |
| Listy rozwijane | Wszystkie kolumny słownikowe kartoteki **oraz** wszystkie pola formularza |
| Autouzupełnianie | Podpowiedzi pojazdu, stawki, miejsca, produktu, jednostki i ceny na podstawie historii |
| Podpis operatora | Pole **Utworzył** — wybór z listy albo wpisanie imienia i nazwiska |
| Magazyn | Stan w rozbiciu na lokalizacje i produkty, w MP / tonach / GJ |
| Raporty | Szczegółowy z filtrami, zestawienie roczne (12 miesięcy), koszty transportu |
| Korekty | Storno z zachowaniem wpisu pierwotnego (pełna ścieżka audytu) |
| Historia | Dziennik zdarzeń: kto, kiedy, co i na czym |
| Import / eksport | CSV w UTF-8, separator średnik, przez te same reguły walidacji |
| Bezpieczeństwo | Automatyczne kopie zapasowe z rotacją, transakcyjny zapis operacji złożonych |

---

## Instalacja

### Wariant A — instalator Windows (zalecany)

1. Pobierz `PRO-MAGAZYN-Setup-2.0.0.exe` z katalogu `installer/wyjscie`.
2. Uruchom instalator i postępuj według kreatora.
3. System instaluje się domyślnie w `C:\Program Files\PRO-MAGAZYN`,
   a plik roboczy trafia do `Dokumenty\PRO-MAGAZYN`.

Instalator zakłada skrót na pulpicie, tworzy folder kopii zapasowych
i podpowiada, jak odblokować makra.

### Wariant B — plik ręcznie

1. Skopiuj `dist/PRO-MAGAZYN.xlsm` do wybranego folderu (np. `Dokumenty\PRO-MAGAZYN`).
2. Kliknij plik prawym przyciskiem → **Właściwości** → zaznacz **Odblokuj** → OK.
   Bez tego Windows zablokuje makra pobrane z internetu lub poczty.
3. Otwórz plik i kliknij **Włącz zawartość**.

### Wymagania

- Microsoft Excel 2016 lub nowszy (32- lub 64-bitowy), Microsoft 365
- Windows 10 lub 11
- Włączone makra VBA dla tego pliku

> Excel dla przeglądarki i aplikacja mobilna otworzą plik i pozwolą przeglądać
> dane oraz korzystać z list rozwijanych, ale makra działają wyłącznie
> w Excelu na komputerze.

---

## Pierwsze uruchomienie

1. Otwórz `PRO-MAGAZYN.xlsm` i włącz zawartość (makra).
2. Trafisz na arkusz **START** — panel z przyciskami wszystkich modułów.
3. Przejdź do **USTAWIENIA** i sprawdź parametry firmy:
   - `FIRMA`, `MAGAZYN` — dane Twojego oddziału,
   - `STAWKA_TRANSPORT_KM` — domyślnie **5 zł/km**,
   - `DOMYSLNY_AUTOR` — Twoje imię i nazwisko (podpowiedź w polu *Utworzył*).
4. Wróć na **START** i kliknij **NOWA OPERACJA**.

---

## Praca z systemem

### Skróty klawiszowe

| Skrót | Działanie |
|---|---|
| `Ctrl+Shift+N` | Nowa operacja (formularz) |
| `Ctrl+Shift+Z` | Zapisz operację z formularza |
| `Ctrl+Shift+M` | Stan magazynowy |
| `Ctrl+Shift+R` | Raporty |

### Wprowadzanie operacji

Formularz jest arkuszem, nie okienkiem — dzięki temu **każde pole ma natywną
listę rozwijaną Excela wraz z autouzupełnianiem podczas pisania**, a ekran
działa tak samo na komputerze i na telefonie.

1. Wybierz **Typ operacji** — formularz sam dostosuje widoczne pola.
2. Uzupełnij pola oznaczone `*`.
3. Wartość operacji i koszt transportu liczą się na bieżąco.
4. Kliknij **ZAPISZ OPERACJĘ**.

Jeżeli czegoś brakuje, system podświetli brakujące pola na czerwono
i wypisze listę problemów — nic nie zostanie zapisane połowicznie.

### Kartoteka

Podwójne kliknięcie wiersza w arkuszu **Dane** otwiera menu:

- **skoryguj wpis (storno)** — oznacza wiersz jako `SKORYGOWANY` i dopisuje wpis
  odwracający jego skutki; wiersz pierwotny zostaje w kartotece,
- **skopiuj dane do formularza** — wygodne przy operacjach seryjnych.

---

## Typy operacji

| Typ | Znaczenie | Wpływ na stan magazynu |
|---|---|---|
| `ZAKUP` | Przyjęcie towaru od dostawcy | `+` w magazynie odbiorcy (gdy *Czy magazynowane* = TAK) |
| `SPRZEDAŻ` | Wydanie towaru do klienta | `−` w magazynie dostawcy |
| `PRODUKCJA` | Wytworzenie wyrobu (np. zrębki) | `+` wyrób, `−` surowiec (wpis zużycia powstaje automatycznie) |
| `ZUŻYCIE` | Rozchód surowca | `−` |
| `MM` | Przesunięcie międzymagazynowe | `−` w źródłowym, `+` w docelowym |
| `TRANSPORT` | **Nowość** — sama usługa przewozu | brak ruchu towaru, sam koszt |

### Operacja TRANSPORT

Dedykowany typ dla kosztu logistycznego bez obrotu towarem. Wpisujesz:

- **przewoźnika** (lista rozwijana),
- **numer rejestracyjny** (lista rozwijana, zapis wielkimi literami),
- **odległość w km**,
- **stawkę zł/km** — domyślnie **5,00 zł**, do zmiany w `USTAWIENIA`.

**Koszt transportu = odległość × stawka** — wyliczany automatycznie po każdej
zmianie któregokolwiek z pól. Wartość można nadpisać ręcznie, gdy przewoźnik
rozliczył kurs ryczałtem.

Wybranie przewoźnika podpowiada jego najczęstszy pojazd i ostatnio stosowaną stawkę.

---

## Operacje równoległe

Przy operacji `ZAKUP` jednym zapisem rejestrujesz cały łańcuch zdarzeń.
W sekcji **OPERACJE RÓWNOLEGŁE** ustaw `TAK` przy wybranych pozycjach:

| Opcja | Co dopisuje system |
|---|---|
| **Produkcja** | wiersz `PRODUKCJA` (wyrób) + wiersz `ZUŻYCIE` (surowiec z zakupu) |
| **Sprzedaż** | wiersz `SPRZEDAŻ` do odbiorcy końcowego |
| **Transport** | wiersz `TRANSPORT` z danymi z sekcji transportowej |

Wszystkie powstałe wiersze dostają wspólne **ID powiązania**, więc w każdej chwili
widać, że pochodzą z jednej operacji gospodarczej. Towar przechodzący „w tranzycie”
dostaje znacznik *Czy magazynowane = NIE*, żeby nie został policzony podwójnie.

Zapis jest **transakcyjny** — jeżeli którykolwiek wiersz się nie powiedzie,
wszystkie dopisane w tej operacji wiersze są wycofywane.

---

## Architektura

```
PRO-MAGAZYN/
├── src/vba/                 Źródła VBA (23 moduły) — jedyne źródło prawdy dla kodu
│   ├── mod_Config.bas         konfiguracja, układ kolumn, kontrakt danych
│   ├── mod_Operacje.bas       silnik zapisu operacji i operacji równoległych
│   ├── mod_Walidacja.bas      reguły poprawności (wspólne dla formularza i importu)
│   ├── mod_Formularz.bas      obsługa ekranu wprowadzania
│   ├── mod_Autouzupelnianie.bas  podpowiedzi uczące się z historii
│   ├── mod_Magazyn.bas        stany magazynowe i przeliczniki jednostek
│   ├── mod_Raporty.bas        raporty miesięczne, roczne, transportowe
│   ├── mod_Korekty.bas        storno z zachowaniem audytu
│   ├── mod_ImportExport.bas   wymiana danych CSV
│   ├── mod_Backup.bas         kopie zapasowe z rotacją
│   ├── mod_Audyt.bas          dziennik zdarzeń
│   ├── mod_Slowniki.bas       słowniki i listy rozwijane
│   ├── mod_UI.bas             panel, przyciski, skróty klawiszowe
│   ├── mod_Narzedzia.bas      funkcje pomocnicze
│   └── *.cls                  moduły arkuszy i skoroszytu
├── build/
│   ├── build_workbook.py      generator skoroszytu .xlsm
│   └── uklad.py               deklaratywny układ arkuszy i formuł
├── tools/
│   ├── vbabuild/              kompilator projektu VBA (MS-OVBA + MS-CFB)
│   ├── lint_vba.py            statyczna kontrola źródeł VBA
│   ├── sprawdz_skoroszyt.py   kontrola wygenerowanego pliku
│   ├── migruj_dane.py         migracja ze starego arkusza
│   └── test_vbabuild.py       testy kompilatora VBA
├── config/ustawienia.ini      konfiguracja środowiska
├── data/                      kartoteka i dane przykładowe
├── docs/                      dokumentacja szczegółowa
├── installer/                 skrypt instalatora Windows (Inno Setup)
└── dist/PRO-MAGAZYN.xlsm      gotowy system
```

### Arkusze skoroszytu

| Arkusz | Nazwa kodowa | Rola |
|---|---|---|
| START | `wsStart` | Panel główny z przyciskami modułów |
| FORMULARZ | `wsFormularz` | Wprowadzanie nowej operacji |
| Dane | `wsDane` | Kartoteka `Tabela_dane` — 43 kolumny |
| MAGAZYN | `wsMagazyn` | Stan magazynowy wg lokalizacji i produktu |
| RAPORTY | `wsRaporty` | Raporty i zestawienia |
| SŁOWNIK | `wsSlownik` | Słowniki wszystkich list rozwijanych |
| HISTORIA | `wsHistoria` | Dziennik zdarzeń |
| USTAWIENIA | `wsUstawienia` | Parametry systemu |

---

## Budowanie ze źródeł

Kod VBA jest wersjonowany jako pliki tekstowe, a skoroszyt powstaje z nich
automatycznie. Nie trzeba mieć Excela ani Windowsa, żeby zbudować system.

```bash
pip install openpyxl oletools

python3 tools/test_vbabuild.py            # testy kompilatora VBA
python3 tools/lint_vba.py src/vba         # kontrola źródeł VBA
python3 build/build_workbook.py           # budowa dist/PRO-MAGAZYN.xlsm
python3 tools/sprawdz_skoroszyt.py dist/PRO-MAGAZYN.xlsm   # kontrola wyniku
```

Migracja danych ze starego arkusza:

```bash
python3 tools/migruj_dane.py stary_plik.xlsm data/kartoteka.csv
```

Szczegóły w [`docs/BUDOWANIE.md`](docs/BUDOWANIE.md).

---

## Co zostało naprawione

Poprzednia wersja miała błędy, które po cichu psuły dane. Pełny wykaz wraz
z dowodami liczbowymi znajduje się w [`docs/POPRAWKI.md`](docs/POPRAWKI.md).
Najważniejsze:

1. **Wartość operacji bywała zerowa.** Formularz odczytywał kwotę ze sformatowanej
   etykiety (`"6 747,00 zł"`), a `IsNumeric` zwracał dla niej `False` — do arkusza
   trafiało `0`. Wartość liczona jest teraz wprost z wolumenu i ceny.
2. **Ryzyko nadpisania danych.** Numer nowego wiersza wyznaczano po kolumnie B
   (*Miejsce załadunku*), która bywa pusta. Teraz dopisuje `ListRows.Add`.
3. **Przesunięcia MM nie ruszały stanów.** 78 wierszy nie wpływało na żadną
   lokalizację. Stan liczony jest per magazyn, z obustronnym księgowaniem MM.
4. **Błędne przeliczenie M3 → tony.** 111 wierszy liczonych jak MP, z pominięciem
   przelicznika M3 → MP.
5. **Błędna klasyfikacja transportu.** Reguła rozpoznawała tylko dwie nazwy —
   177 kursów własnych figurowało jako zewnętrzne.
6. **Pętla w polu numeru rejestracyjnego.** Zdarzenie `Change` przypisywało
   wartość do samego siebie, wywołując się w nieskończoność.

---

## Licencja

MIT — zobacz [`LICENSE`](LICENSE).

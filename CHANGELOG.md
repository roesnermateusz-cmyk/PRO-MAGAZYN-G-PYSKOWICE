# Historia zmian

Format według [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/).

---

## [2.0.0] — 2026-09-15

Przebudowa systemu „Magazyn Zabrze” w produkcyjny system PRO-MAGAZYN.

### Dodane

- **Typ operacji `TRANSPORT`** — ewidencja samej usługi przewozu (przewoźnik,
  numer rejestracyjny, odległość, stawka). **Koszt = odległość × stawka**,
  domyślnie 5,00 zł/km, wyliczany automatycznie i możliwy do nadpisania.
- **Transport jako operacja równoległa** — obok produkcji i sprzedaży.
  Zakup może jednym zapisem wygenerować do pięciu powiązanych wierszy.
- **Kolumna `Utworzył`** wraz z polem w formularzu: wybór z listy rozwijanej
  albo wpisanie imienia i nazwiska. Podpisy z pola *Uwagi* zostały przeniesione
  automatycznie (469 wpisów).
- **Listy rozwijane we wszystkich kolumnach słownikowych** kartoteki
  oraz na wszystkich polach formularza.
- **Autouzupełnianie uczące się z historii** — wybór przewoźnika podpowiada
  pojazd i stawkę, wybór dostawcy podpowiada miejsce i produkt, wybór produktu
  podpowiada jednostkę, a para kontrahent + produkt podpowiada ostatnią cenę.
- **Podpowiadanie kolejnego numeru WZ / PZ** na podstawie kartoteki.
- **Arkusz START** — panel z przyciskami wszystkich modułów i skrótami klawiszowymi.
- **Formularz jako arkusz** zamiast okna UserForm: natywne listy rozwijane
  z autouzupełnianiem, działa także w Excelu na telefonie i w przeglądarce.
- **Stan magazynowy per lokalizacja i produkt** w MP, tonach i GJ,
  z oznaczaniem pozycji ujemnych.
- **Raporty**: szczegółowy z sześcioma filtrami, zestawienie roczne (12 miesięcy),
  zestawienie kosztów transportu ze średnią stawką zł/km.
- **Korekty (storno)** — wiersz pierwotny zostaje, dopisywany jest wpis odwracający.
- **Dziennik zdarzeń** (arkusz HISTORIA) — kto, kiedy i co zmienił.
- **Import i eksport CSV** (UTF-8, średnik) przez wspólne reguły walidacji.
- **Kopie zapasowe** — automatyczne przy pierwszym zapisie w dniu i przed importem,
  z rotacją 30 ostatnich kopii.
- **Arkusz USTAWIENIA** — parametry firmy, przeliczniki i limity bez zmiany kodu.
- **Wykrywanie duplikatów** — ostrzeżenie przy powtórzonym numerze WZ.
- **Identyfikatory operacji i powiązań** (`OP-…`, `PW-…`).
- Kolumny wyliczane: `Kwartał`, `Miesiąc_nr`, `Stawka zł/km`, `Status`.
- Instalator Windows (Inno Setup) odblokowujący makra i chroniący plik roboczy
  przed nadpisaniem przy aktualizacji.
- Kompletna dokumentacja: `README.md`, `docs/INSTRUKCJA.md`, `docs/POPRAWKI.md`,
  `docs/BUDOWANIE.md`.

### Naprawione

Szczegóły wraz z dowodami liczbowymi w [`docs/POPRAWKI.md`](docs/POPRAWKI.md).

- **Wartość operacji zapisywana jako zero** — formularz czytał kwotę
  ze sformatowanej etykiety (`"6 747,00 zł"`), dla której `IsNumeric` zwraca
  `False`. Naprawiono 7 wierszy kartoteki.
- **Ryzyko nadpisania danych** — numer nowego wiersza wyznaczano po kolumnie
  *Miejsce załadunku*, która bywa pusta. Zapis korzysta z `ListRows.Add`.
- **Przesunięcia MM nie zmieniały stanów** — 78 wierszy bez wpływu na ewidencję.
- **Błędne przeliczenie M3 → tony** — 111 wierszy liczonych jak MP,
  z pominięciem przelicznika M3 → MP.
- **Wartość zakupu i sprzedaży** mnożona przez wolumen w MP zamiast
  w jednostce ceny — zawyżenie ok. trzykrotne dla pozycji rozliczanych w tonach.
- **Błędna klasyfikacja transportu** — 177 kursów własnych figurowało jako
  zewnętrzne (reguła rozpoznawała tylko dwie nazwy).
- **Nieskończona pętla** w polu numeru rejestracyjnego (`Change` przypisujące
  wartość do samego siebie).
- **Brak walidacji daty załadunku** — `CDate` na pustym polu przerywał zapis
  w połowie wiersza.
- **Sprzedaż i zużycie nie zdejmowały towaru ze stanu** przy operacjach równoległych.
- **Blokada pola *Czy magazynowane*** nie wracała do stanu aktywnego.
- **Nazwa arkusza słownika** wyszukiwana po nazwie — teraz po nazwie kodowej.
- **Surowiec produkcji** wpisany na stałe w kodzie — teraz parametr w USTAWIENIACH.

### Zmienione

- Kartoteka rozszerzona z 36 do **43 kolumn**.
- Zapis operacji złożonej jest **transakcyjny** — błąd w połowie wycofuje
  wszystkie dopisane wiersze.
- Kod VBA (23 moduły, ponad 4 500 wierszy) jest wersjonowany jako pliki tekstowe
  w `src/vba/`; skoroszyt powstaje z nich automatycznie.
- Usunięto okna UserForm `frmDane` i `frmDodatkowe` wraz z powiązanym kodem.

### Usunięte

- Tabele przestawne i fragmentatory zastąpione raportami liczonymi przez VBA
  (nie wymagają odświeżania i działają na danych filtrowanych).

---

## [1.x] — arkusz „Magazyn Zabrze”

Wersja wyjściowa: formularz `frmDane` z kreatorem `frmDodatkowe`,
kartoteka 36-kolumnowa, raporty na tabelach przestawnych.

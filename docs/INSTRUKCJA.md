# Instrukcja obsługi — PRO-MAGAZYN 2.0.0

Przewodnik dla osoby prowadzącej ewidencję magazynową.

---

## 1. Panel główny (START)

Po otwarciu pliku trafiasz na panel z przyciskami. Każdy przycisk uruchamia
jeden moduł systemu.

| Przycisk | Opis |
|---|---|
| **NOWA OPERACJA** | Formularz wprowadzania operacji |
| **STAN MAGAZYNOWY** | Aktualne stany wg lokalizacji i produktu |
| **KARTOTEKA OPERACJI** | Pełna tabela wszystkich operacji |
| **RAPORTY I ZESTAWIENIA** | Raporty miesięczne, roczne, transportowe |
| **SŁOWNIKI** | Listy używane w polach rozwijanych |
| **DZIENNIK ZDARZEŃ** | Kto, kiedy i co zmienił |
| **IMPORT / EKSPORT CSV** | Wymiana danych z innymi systemami |
| **KOPIA ZAPASOWA** | Ręczne wykonanie kopii |
| **USTAWIENIA SYSTEMU** | Parametry firmy i przeliczniki |
| **POMOC I SKRÓTY** | Ściąga ze skrótami klawiszowymi |
| **ODŚWIEŻ SYSTEM** | Przeliczenie stanów i odbudowa list |

Liczniki nad przyciskami pokazują liczbę operacji w kartotece i zdarzeń w dzienniku.

---

## 2. Wprowadzanie operacji

### Krok po kroku

1. **START → NOWA OPERACJA** (albo `Ctrl+Shift+N`).
2. Wybierz **Typ operacji**. Formularz od razu dostosuje pola — np. przy
   `SPRZEDAŻ` zablokuje cenę zakupu, a przy `TRANSPORT` ukryje sekcję operacji
   równoległych.
3. Uzupełnij pola oznaczone gwiazdką `*`.
4. Obserwuj pole **Wartość operacji** — liczy się na bieżąco.
5. Kliknij **ZAPISZ OPERACJĘ** (albo `Ctrl+Shift+Z`).

### Listy rozwijane i autouzupełnianie

Każde pole słownikowe ma listę rozwijaną. Możesz:

- kliknąć strzałkę i wybrać pozycję,
- **zacząć pisać** — Excel sam dokończy wpis pasujący do listy,
- wpisać **nową wartość** — system ją przyjmie i dopisze do słownika.

Dodatkowo system podpowiada na podstawie historii:

| Wypełnisz | System zaproponuje |
|---|---|
| Przewoźnik | najczęstszy pojazd tego przewoźnika + jego ostatnią stawkę zł/km |
| Nr rejestracyjny | przewoźnika, do którego zwykle należy ten pojazd |
| Dostawca | miejsce załadunku i najczęściej kupowany produkt |
| Produkt | jednostkę miary |
| Dostawca + Produkt | ostatnią cenę zakupu |
| Odbiorca + Produkt | ostatnią cenę sprzedaży |

Podpowiedzi **nigdy nie nadpisują** tego, co już wpisałeś — uzupełniają wyłącznie
puste pola.

### Pole „Utworzył”

Pole obowiązkowe (można wyłączyć ustawieniem `WYMAGAJ_POLA_UTWORZYL`).
Wybierz swoje nazwisko z listy albo wpisz je ręcznie — nowe nazwisko trafi do
słownika i następnym razem będzie już na liście.

Po zapisaniu operacji pole zostaje wypełnione, bo zwykle jedna osoba wprowadza
serię wpisów. Domyślną wartość ustawisz kluczem `DOMYSLNY_AUTOR`.

### Numer WZ

Przycisk **PODPOWIEDZ NUMER WZ** znajduje najwyższy numer użyty w kartotece
i proponuje kolejny (`PZ/128` → `PZ/129`). Dla sprzedaży używa prefiksu `WZ`.

### Gdy czegoś brakuje

System **nie zapisze** niekompletnej operacji. Brakujące pola podświetli na
czerwono i wypisze listę problemów, np.:

```
Nie można zapisać operacji:

- Nie wybrano produktu.
- Wolumen musi być liczbą większą od zera.
- Pole "Utworzył" jest wymagane (imię i nazwisko).
```

---

## 3. Operacja TRANSPORT

Typ `TRANSPORT` rejestruje **sam koszt przewozu**, bez ruchu towaru.

| Pole | Uwagi |
|---|---|
| Przewoźnik * | lista rozwijana |
| Nr rejestracyjny * | zapisywany wielkimi literami |
| Odległość [km] | podstawa wyliczenia |
| Stawka [zł/km] | domyślnie **5,00 zł** |
| Koszt transportu | **liczony automatycznie: odległość × stawka** |

Koszt przelicza się po każdej zmianie odległości lub stawki. Jeżeli przewoźnik
rozliczył kurs ryczałtem, wpisz kwotę ręcznie w pole *Koszt transportu* —
zostanie zachowana.

**Zmiana stawki dla całej firmy:** `USTAWIENIA` → `STAWKA_TRANSPORT_KM`.
Nowa wartość obowiązuje natychmiast, bez zamykania pliku.

---

## 4. Operacje równoległe

Dostępne przy typie `ZAKUP`. Pozwalają jednym zapisem zarejestrować cały
łańcuch zdarzeń gospodarczych.

### Przykład: zakup surowca, produkcja zrębki, sprzedaż i przewóz

| Pole | Wartość |
|---|---|
| Typ operacji | `ZAKUP` |
| Produkt | `Drewno opałowe z lasu` |
| Wolumen | `86,5` MP |
| Cena zakupu | `78,00 zł` |
| Dostawca | `Lander Agro` |
| Odbiorca | `Magazyn Zabrze` |
| **Produkcja równoległa** | `TAK` |
| → Produkt wyjściowy | `Zrębka Produkcyjna Leśna` |
| → Wolumen produkcji | `82` MP |
| **Sprzedaż równoległa** | `TAK` |
| → Odbiorca końcowy | `Re Alloys, Łaziska` |
| → Cena sprzedaży | `95,00 zł` |
| **Transport równoległy** | `TAK` |
| Przewoźnik / pojazd | `własny (Wilczak)` / `SK 7J884` |
| Odległość | `110` km |

Po zapisaniu system dopisze **5 powiązanych wierszy**:

| # | Typ | Produkt | Wolumen | Magazynowane |
|---|---|---|---|---|
| 1 | ZAKUP | Drewno opałowe z lasu | 86,5 MP | NIE |
| 2 | PRODUKCJA | Zrębka Produkcyjna Leśna | 82 MP | NIE |
| 3 | ZUŻYCIE | Drewno opałowe z lasu | 86,5 MP | NIE |
| 4 | SPRZEDAŻ | Zrębka Produkcyjna Leśna | 82 MP | NIE |
| 5 | TRANSPORT | — | — | NIE |

Wiersz 5 dostanie koszt `110 km × 5,00 zł = 550,00 zł`.
Wszystkie pięć wierszy otrzyma wspólne **ID powiązania**.

Znacznik *Czy magazynowane = NIE* jest prawidłowy: towar nie zatrzymał się
w magazynie, więc nie może podnosić stanu.

---

## 5. Kartoteka operacji

Arkusz **Dane** to pełna ewidencja. Kolumny słownikowe mają listy rozwijane,
więc ręczna poprawka nie wprowadzi literówki.

**Podwójne kliknięcie wiersza** otwiera menu:

- **TAK — skoryguj wpis (storno)**
- **NIE — skopiuj dane do formularza**
- **ANULUJ**

### Korekta (storno)

System nigdy nie kasuje ani nie nadpisuje wiersza. Korekta:

1. pyta o powód (trafia do dziennika zdarzeń),
2. oznacza wiersz pierwotny jako `SKORYGOWANY` (czerwone tło, przekreślenie),
3. dopisuje wiersz `KOREKTA` z odwrotnym wolumenem i kosztami,
4. przelicza stan magazynowy.

Poprawny wpis wprowadzasz normalnie przez formularz — najwygodniej korzystając
z opcji *skopiuj dane do formularza*.

Wiersze `SKORYGOWANY` są pomijane w stanach magazynowych i raportach.

---

## 6. Stan magazynowy

Arkusz **MAGAZYN** przelicza się przy każdym wejściu i po każdym zapisie.

Pokazuje stan w rozbiciu na **lokalizację i produkt**, w trzech jednostkach:
metry przestrzenne, tony i gigadżule.

> **Pozycje na czerwono** mają stan ujemny. Oznacza to lukę w ewidencji —
> najczęściej wydania z magazynu, do którego towar nigdy formalnie nie wpłynął
> (przyjęcie zapisano na inny magazyn). Sprawdź, czy przyjęcia wskazują właściwą
> lokalizację.

---

## 7. Raporty

Arkusz **RAPORTY** ma trzy tryby:

### Raport szczegółowy
Filtry w nagłówku: rok, miesiąc, typ operacji, produkt, kontrahent, lokalizacja.
Wpisanie `WSZYSTKIE` wyłącza dany filtr. Zmiana filtra przelicza raport od razu.

Podsumowanie pokazuje liczbę operacji, wolumen (MP i tony), wartość zakupu
i sprzedaży, koszty transportu i rąbania oraz **marżę**.

### Zestawienie roczne
Dwanaście miesięcy w jednym widoku dla roku z pola *Rok*: liczba operacji,
wolumen, zakup, sprzedaż, transport i marża miesięczna.

### Koszty transportu
Zestawienie przewoźników: liczba kursów, suma kilometrów, koszt,
**średnia stawka zł/km** i klasyfikacja (własny / zewnętrzny).

---

## 8. Import i eksport

Format: **CSV, UTF-8, separator średnik**, kropka jako separator dziesiętny
(plik jest niezależny od ustawień regionalnych).

- **Eksport** zapisuje całą kartotekę wraz z kolumnami wyliczanymi.
- **Import** dopisuje operacje do kartoteki. Przed importem system
  **automatycznie wykonuje kopię zapasową**.

Import przechodzi przez walidację: wiersze bez poprawnej daty, ze zerowym
wolumenem albo z nieznanym typem operacji są pomijane, a raport wskazuje,
które wiersze i dlaczego.

---

## 9. Kopie zapasowe

- Kopia powstaje **automatycznie przy pierwszym zapisie w danym dniu**
  oraz zawsze przed importem danych.
- Trafia do podfolderu `Kopie zapasowe` obok pliku roboczego
  (ścieżkę zmienisz kluczem `FOLDER_KOPII`).
- System zachowuje **30 ostatnich kopii** (`KOPIE_DO_ZACHOWANIA`), starsze kasuje.

Nazwa pliku zawiera datę i godzinę, np. `PRO-MAGAZYN_kopia_2026-09-15_081500.xlsm`.

**Przywrócenie:** zamknij plik roboczy, skopiuj wybraną kopię z folderu,
zmień jej nazwę na `PRO-MAGAZYN.xlsm` i otwórz.

---

## 10. Praca wielu użytkowników

System przewiduje pracę kilku osób:

- pole **Utworzył** przy każdej operacji,
- **dziennik zdarzeń** rejestrujący otwarcia, zapisy, korekty, importy i zmiany ustawień,
- **identyfikator operacji** (`OP-RRRRMMDD-GGMMSS-NNN`) unikalny dla każdego wiersza.

> Plik Excel nie obsługuje jednoczesnej edycji przez wiele osób.
> Zalecany tryb pracy: plik na dysku sieciowym lub OneDrive, jedna osoba
> wprowadza dane w danym momencie. Dziennik zdarzeń pozwala odtworzyć,
> kto co zmienił.

---

## 11. Ustawienia

Arkusz **USTAWIENIA** — kolumna *Klucz*, kolumna *Wartość*, kolumna *Opis*.
Zmiana działa natychmiast.

| Klucz | Domyślnie | Znaczenie |
|---|---|---|
| `FIRMA` | ResInvest Commodities | Nazwa firmy |
| `MAGAZYN` | Magazyn Pyskowice | Domyślna lokalizacja |
| `STAWKA_TRANSPORT_KM` | `5` | **Stawka za kilometr [zł/km]** |
| `PRZELICZNIK_MP_TONA` | `0,33` | Ile ton waży 1 MP |
| `PRZELICZNIK_M3_MP` | `4` | Ile MP daje 1 m³ |
| `PRZELICZNIK_GJ_TONA` | `8,5` | Ile GJ daje 1 tona |
| `MAX_DNI_ROBOCZYCH_WSTECZ` | `2` | Limit wstecznego datowania (0 = bez limitu) |
| `MAX_DNI_WPRZOD` | `30` | Limit datowania w przód |
| `FOLDER_KOPII` | *(puste)* | Folder kopii zapasowych |
| `KOPIA_AUTOMATYCZNA` | `TAK` | Kopia przy pierwszym zapisie w dniu |
| `KOPIE_DO_ZACHOWANIA` | `30` | Ile kopii zachować |
| `WYMAGAJ_POLA_UTWORZYL` | `TAK` | Czy podpis jest obowiązkowy |
| `OSTRZEGAJ_O_DUBLACH` | `TAK` | Ostrzeżenie przy powtórzonym numerze WZ |
| `DOMYSLNY_AUTOR` | *(puste)* | Podpowiedź do pola *Utworzył* |
| `SUROWIEC_DOMYSLNY` | `Zrzyna` | Surowiec zużywany przy produkcji |

---

## 12. Rozwiązywanie problemów

| Objaw | Przyczyna | Rozwiązanie |
|---|---|---|
| Przyciski nie działają | Makra wyłączone | Kliknij **Włącz zawartość** na żółtym pasku |
| Brak żółtego paska, makra nie działają | Plik zablokowany przez Windows | Prawy przycisk na pliku → Właściwości → **Odblokuj** |
| Listy rozwijane puste | Nazwane zakresy nieodświeżone | START → **ODŚWIEŻ SYSTEM** |
| Stan magazynowy wygląda źle | Stare przeliczenie | Wejdź na arkusz MAGAZYN (przelicza się automatycznie) lub kliknij dwukrotnie |
| „Nie można wprowadzić daty starszej niż…” | Limit wstecznego datowania | Zmień `MAX_DNI_ROBOCZYCH_WSTECZ` w USTAWIENIACH |
| Ostrzeżenie o duplikacie | Ten sam numer WZ, produkt i data | Sprawdź kartotekę; możesz potwierdzić zapis |
| Pozycje na czerwono w MAGAZYNIE | Stan ujemny | Sprawdź, czy przyjęcia wskazują właściwy magazyn |

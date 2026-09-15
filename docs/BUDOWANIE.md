# Budowanie i rozwój systemu

Kod VBA jest wersjonowany jako pliki tekstowe w `src/vba/`, a skoroszyt `.xlsm`
powstaje z nich automatycznie. Do zbudowania systemu **nie jest potrzebny
Excel ani Windows** — cały proces działa na Pythonie i jest odtwarzalny w CI.

---

## Wymagania

```bash
pip install openpyxl oletools
```

---

## Pełny przebieg

```bash
# 1. Testy kompilatora VBA (kodek MS-OVBA + zapis kontenera MS-CFB)
python3 tools/test_vbabuild.py

# 2. Statyczna kontrola źródeł VBA
python3 tools/lint_vba.py src/vba

# 3. Budowa skoroszytu
python3 build/build_workbook.py

# 4. Kontrola gotowego pliku
python3 tools/sprawdz_skoroszyt.py dist/PRO-MAGAZYN.xlsm
```

Wynik: `dist/PRO-MAGAZYN.xlsm`.

---

## Jak to działa

### `tools/vbabuild/` — kompilator projektu VBA

Excel przechowuje makra w pliku `xl/vbaProject.bin`, który jest kontenerem OLE
(Compound File Binary) ze skompresowanymi strumieniami źródeł. Biblioteki
Pythona potrafią taki plik tylko czytać, więc projekt zawiera własny zapis.

| Plik | Odpowiada za |
|---|---|
| `ovba_compression.py` | kodek kompresji strumieni wg **[MS-OVBA] 2.4.1** (LZ77 z tokenami kopiującymi) |
| `cfb_writer.py` | zapis kontenera **[MS-CFB]**: sektory, FAT, mini-FAT, drzewo katalogu |
| `vba_project.py` | złożenie strumieni `PROJECT`, `PROJECTwm`, `dir`, `_VBA_PROJECT` i modułów |

Strumień `_VBA_PROJECT` zapisywany jest z wersją `0xFFFF`, co wymusza na VBA
rekompilację ze źródeł przy pierwszym otwarciu — dzięki temu nie trzeba
generować skompilowanego p-code'u.

Poprawność kodeka jest sprawdzana testem porównującym wynik z niezależną
implementacją z pakietu `oletools`, także na prawdziwych strumieniach
z oryginalnego pliku.

### `tools/lint_vba.py` — kontrola źródeł

VBA nie da się skompilować poza Excelem, więc typowe błędy strukturalne
wychwytuje linter:

- deklaracje modułowe (`Const`, `Dim`, `Type`, `Enum`) po pierwszej procedurze —
  VBA wymaga ich w sekcji deklaracji,
- niedomknięte bloki `Sub`, `Function`, `If`, `For`, `With`, `Select Case`, `Do`,
- błędnie zapisana kontynuacja wiersza (`_` bez poprzedzającej spacji),
- odwołania do nieistniejących stałych, kolumn, pól i arkuszy
  (prefiksy `ws`, `kol`, `OP_`, `UST_`, `SL_`, `ST_`, `POLE_`),
- duplikaty nazw procedur, brak `Option Explicit`, zbyt długie wiersze.

### `build/build_workbook.py` — generator skoroszytu

1. Wczytuje kartotekę z `data/kartoteka.csv`.
2. Buduje osiem arkuszy według deklaratywnego układu z `build/uklad.py`.
3. Zakłada tabelę `Tabela_dane`, kolumny wyliczane, listy rozwijane
   i nazwane zakresy.
4. Kompiluje projekt VBA ze źródeł.
5. Przepakowuje wynik do `.xlsm`: typy zawartości, relacja do `vbaProject.bin`
   i **nazwy kodowe arkuszy** (`wsDane`, `wsFormularz`, …), które wiążą arkusze
   z modułami VBA.

### `tools/sprawdz_skoroszyt.py` — kontrola wyniku

Weryfikuje gotowy plik niezależnymi parserami:

- spójność archiwum ZIP i poprawność każdej części XML,
- kolejność części pakietu OPC (`[Content_Types].xml` musi być pierwszy),
- deklaracja skoroszytu z makrami i relacja do projektu VBA,
- komplet 23 modułów VBA odczytanych przez `olevba`, z właściwymi typami
  (moduły dokumentów kontra moduły standardowe),
- komplet nazw kodowych arkuszy,
- zgodność nazw kolumn tabeli z wierszem nagłówka (rozbieżność powoduje,
  że Excel zgłasza plik jako uszkodzony),
- poprawność formuł: nazwy funkcji i istnienie nazwanych zakresów,
- listy rozwijane wskazujące istniejące zakresy,
- spójność danych kartoteki.

---

## Zmiana kodu VBA

1. Edytuj plik w `src/vba/`.
2. `python3 tools/lint_vba.py src/vba`
3. `python3 build/build_workbook.py`
4. `python3 tools/sprawdz_skoroszyt.py dist/PRO-MAGAZYN.xlsm`

> Zmiany wprowadzone bezpośrednio w edytorze VBA w Excelu **nie wracają**
> do repozytorium. Po eksperymentach w Excelu przenieś kod z powrotem
> do `src/vba/`, w przeciwnym razie kolejna budowa je nadpisze.

---

## Dodanie nowej kolumny kartoteki

1. `src/vba/mod_Config.bas` — dopisz pozycję do `Enum kolDane` i zwiększ
   `KOL_OSTATNIA_DANA`.
2. Dodaj pole do `Public Type Operacja`.
3. `mod_Operacje.ZapiszWiersz` — zapis nowej kolumny.
4. `build/uklad.py` — dopisz nagłówek do `KOLUMNY_DANE`.
5. W razie potrzeby dopisz pole do `FORMULARZ` i mapowania `LISTY_FORMULARZA`.
6. Przebuduj i sprawdź.

## Dodanie nowego typu operacji

1. `mod_Config.bas` — stała `OP_...`.
2. `mod_Walidacja.CzyZnanyTyp` — dopisz typ.
3. `mod_Operacje.WartoscOperacji` — sposób liczenia wartości.
4. `mod_Magazyn.KierunekRuchu` — wpływ na stan magazynu.
5. `build/uklad.py` → `SLOWNIKI` → `TYP_OPERACJI` — dopisz do listy rozwijanej.

## Dodanie nowego słownika

1. `build/uklad.py` — nowa pozycja w `SLOWNIKI`.
2. `src/vba/mod_Slowniki.bas` — stała `SL_...` i wpis w `OdswiezNazwaneZakresy`.
3. Podepnij listę w `mod_Formularz.OdswiezListyFormularza`
   lub `mod_UI.OdswiezListyKartoteki`.

---

## Migracja danych ze starego arkusza

```bash
python3 tools/migruj_dane.py stary_plik.xlsm data/kartoteka.csv
```

Skrypt przenosi kartotekę do nowego układu kolumn i przy okazji naprawia błędy
zapisane w danych przez poprzednią wersję makr (szczegóły w `docs/POPRAWKI.md`):

- przelicza zerowe wartości operacji z wolumenu i ceny,
- wydziela podpis operatora z pola *Uwagi* do kolumny *Utworzył*,
- wylicza stawkę zł/km z kosztu i odległości.

Raport z migracji wypisywany jest na ekran.

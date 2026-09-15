# Dane

| Plik | Zawartość |
|---|---|
| `kartoteka.csv` | Kartoteka produkcyjna przeniesiona ze starego arkusza „Magazyn Zabrze” (577 operacji). Źródło danych dla `build/build_workbook.py`. |
| `dane_przykladowe.csv` | Dziesięć operacji pokazujących wszystkie typy i mechanizmy systemu. Do testów i szkolenia. |

## Format

CSV, kodowanie **UTF-8**, separator **średnik**, kropka jako separator dziesiętny.
Układ kolumn odpowiada kolumnom 1–30 kartoteki (kolumny wyliczane nie są zapisywane —
skoroszyt odtwarza je formułami).

## Co pokazują dane przykładowe

| # | Typ | Czego dotyczy |
|---|---|---|
| 1 | ZAKUP | Przyjęcie z transportem rozliczonym w wierszu |
| 2–3 | PRODUKCJA + ZUŻYCIE | Para powiązana wspólnym *ID powiązania* |
| 4 | SPRZEDAŻ | Wydanie rozliczane w tonach |
| 5 | MM | Przesunięcie Zabrze → Pyskowice (obustronny ruch stanu) |
| 6 | **TRANSPORT** | Sama usługa przewozu: 150 km × 5 zł = 750 zł |
| 7 | ZAKUP | Jednostka M3 — sprawdza przelicznik M3 → MP → tony |
| 8–9 | ZAKUP + KOREKTA | Wpis `SKORYGOWANY` wraz ze storno |
| 10 | ZAKUP | Poprawny wpis wprowadzony po korekcie |

## Wczytanie danych przykładowych

W systemie: **START → IMPORT Z PLIKU CSV** i wskaż `dane_przykladowe.csv`.
Przed importem system wykona kopię zapasową.

## Budowa skoroszytu na danych przykładowych

```bash
python3 build/build_workbook.py --dane data/dane_przykladowe.csv --wyjscie dist/PRO-MAGAZYN-DEMO.xlsm
```

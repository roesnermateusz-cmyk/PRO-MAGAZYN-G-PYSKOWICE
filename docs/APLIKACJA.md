# PRO-MAGAZYN — aplikacja desktopowa

Program na Windows z własnym interfejsem, który **zapisuje dane w pliku Excela
(.xlsx)**. Ten sam plik otwiera się w Excelu, więc aplikacja i skoroszyt
z makrami pracują na jednej ewidencji.

---

## Dwa sposoby użycia

### 1. Instalacja na laptopie

1. Uruchom `PRO-MAGAZYN-Setup-2.1.0.exe`.
2. Program instaluje się w `C:\Program Files\PRO-MAGAZYN`.
3. Plik danych powstaje w `Dokumenty\PRO-MAGAZYN\PRO-MAGAZYN-dane.xlsx`.
4. Kopie zapasowe trafiają do `Dokumenty\PRO-MAGAZYN\Kopie zapasowe`.

### 2. Wersja przenośna na dysku firmowym

1. Rozpakuj `PRO-MAGAZYN-portable.zip` na dysk sieciowy, np. `\\serwer\magazyn\PRO-MAGAZYN`.
2. Uruchom `PRO-MAGAZYN.exe` — **bez instalacji**.
3. Plik danych i kopie zapasowe leżą w podfolderze `dane` obok programu.

Tryb przenośny włącza plik `portable.txt` leżący obok programu. Usunięcie
go przełącza aplikację na tryb zainstalowany (dane w Dokumentach).

> Program działa z dysku sieciowego, ale **uruchamia się szybciej skopiowany
> lokalnie**. Typowy wariant: program zainstalowany na laptopach, a plik danych
> wspólny na dysku firmowym — otwórz go przez **Ustawienia → Otwórz inny plik**.

---

## Praca kilku osób na jednym pliku

Plik danych może leżeć na dysku firmowym i korzystać z niego kilka osób.
Aplikacja pilnuje, żeby nikt nikomu nie nadpisał zmian:

| Sytuacja | Zachowanie programu |
|---|---|
| Nikt nie edytuje pliku | Program zajmuje blokadę i pozwala zapisywać |
| Ktoś już edytuje | Program otwiera plik **tylko do odczytu** i pokazuje, kto go trzyma |
| Poprzednia sesja padła | Blokada wygasa po 15 minutach bez odświeżenia i plik znów jest dostępny |

Blokada to plik `PRO-MAGAZYN-dane.xlsx.lock` obok danych. Zawiera nazwę
użytkownika, stanowisko i czas ostatniego odświeżenia. Jest kasowany
automatycznie przy zamknięciu programu.

W trybie tylko do odczytu można przeglądać kartotekę, magazyn i raporty —
zablokowany jest wyłącznie zapis.

---

## Ekrany programu

| Ekran | Skrót | Do czego służy |
|---|---|---|
| **Pulpit** | — | Stan magazynu, obrót bieżącego miesiąca, ostatnie operacje |
| **Nowa operacja** | `Ctrl+N` | Wprowadzanie operacji wraz z operacjami równoległymi |
| **Kartoteka** | `Ctrl+K` | Pełna ewidencja, filtry, wyszukiwanie, korekty |
| **Magazyn** | `Ctrl+M` | Stany wg lokalizacji i produktu |
| **Raporty** | `Ctrl+R` | Szczegółowy, roczny, koszty transportu |
| **Dziennik zdarzeń** | — | Kto, kiedy i co zmienił |
| **Ustawienia** | — | Parametry, plik danych, kopie, import/eksport |

Dodatkowo: `Ctrl+S` zapisuje plik, `F5` odświeża bieżący ekran.

---

## Wprowadzanie operacji

Formularz dopasowuje się do wybranego typu operacji — przy `TRANSPORT` znikają
pola towarowe, przy `ZAKUP` pojawia się sekcja operacji równoległych.

### Listy rozwijane i autouzupełnianie

Każde pole słownikowe ma listę, która **filtruje po fragmencie tekstu**
(wpisanie „wilcz” znajdzie „własny (Wilczak)”). Można też wpisać nową wartość —
trafi do słownika.

System podpowiada na podstawie historii:

| Wypełnisz | Program uzupełni |
|---|---|
| Przewoźnik | najczęstszy pojazd i ostatnią stawkę zł/km |
| Nr rejestracyjny | przewoźnika, do którego zwykle należy pojazd |
| Dostawca | miejsce załadunku i najczęściej kupowany produkt |
| Produkt | jednostkę miary |
| Dostawca + Produkt | ostatnią cenę zakupu |
| Odbiorca + Produkt | ostatnią cenę sprzedaży |

Podpowiedzi **nie nadpisują** tego, co już wpisałeś.

### Transport

Koszt liczy się na bieżąco: **odległość × stawka za kilometr**
(domyślnie 5,00 zł/km). Wartość można nadpisać, gdy kurs rozliczono ryczałtem.

### Operacje równoległe

Przy zakupie ustaw `TAK` przy wybranych pozycjach — karta podsumowania pokazuje
na żywo, ile wierszy powstanie:

| Zaznaczone | Wiersze kartoteki |
|---|---|
| nic | zakup |
| Produkcja | zakup + produkcja + zużycie |
| Produkcja + Sprzedaż | zakup + produkcja + zużycie + sprzedaż |
| + Transport | jak wyżej + transport |

Wszystkie dostają wspólne **ID powiązania**.

---

## Korekty

W kartotece zaznacz wiersz i kliknij **Koryguj** (albo kliknij wiersz dwukrotnie).
Program pyta o powód, oznacza wpis jako `SKORYGOWANY` i dopisuje wiersz
odwracający jego skutki. **Nic nie jest kasowane** — pełna ścieżka audytu zostaje.

Wiersze skorygowane są pomijane w stanach i raportach.

---

## Zapis danych

- Zapis jest **atomowy**: plik powstaje najpierw jako tymczasowy, a dopiero
  gotowy podmienia poprzedni. Przerwanie zapisu nie uszkodzi ewidencji.
- Po każdej zapisanej operacji program **od razu zapisuje plik** — nie trzeba
  pamiętać o `Ctrl+S`.
- Przy pierwszym zapisie w danym dniu powstaje **kopia zapasowa**;
  program trzyma 30 ostatnich (wartość w Ustawieniach).

Zapisywany plik zawiera komplet arkuszy: `START`, `FORMULARZ`, `Dane`,
`MAGAZYN`, `RAPORTY`, `SŁOWNIK`, `HISTORIA`, `USTAWIENIA` — czyli dokładnie
to, co skoroszyt z makrami, wraz z formułami kolumn wyliczanych.

---

## Współpraca ze skoroszytem z makrami

| | Aplikacja desktopowa | Skoroszyt `.xlsm` |
|---|---|---|
| Format danych | `.xlsx` | `.xlsm` |
| Układ arkuszy i kolumn | identyczny | identyczny |
| Makra VBA | nie dotyczy | tak |
| Wymaga Excela | nie | tak |

Aplikacja **czyta oba formaty** (`Ustawienia → Otwórz inny plik`), więc można
wskazać jej istniejący plik `PRO-MAGAZYN.xlsm`. Zapis idzie zawsze do `.xlsx`.

> Wybierz jedno narzędzie jako główne dla danego pliku. Równoczesna edycja
> tego samego pliku w Excelu i w aplikacji nie jest wykrywana przez blokadę —
> Excel jej nie zna.

---

## Budowanie ze źródeł

```bash
python -m pip install -r desktop/requirements.txt

python3 desktop/testy/test_promagazyn.py   # testy rdzenia
python3 desktop/uruchom.py                 # uruchomienie ze źródeł
python desktop/build_windows.py            # paczka Windows (uruchom na Windows)
ISCC.exe installer\PRO-MAGAZYN-APP.iss     # instalator
```

Gotowy `.exe` powstaje też automatycznie na GitHubie: zakładka **Actions** →
przebieg **Aplikacja Windows** → **Artifacts** (instalator i wersja przenośna).

Paczka waży ok. 150 MB — to głównie biblioteki Qt, które program nosi ze sobą,
żeby nie wymagać niczego doinstalowanego na stanowisku.

### Architektura

```
desktop/promagazyn/
├── model/          logika dziedzinowa, niezależna od interfejsu
│   ├── operacja.py     model operacji i typy
│   ├── silnik.py       przeliczenia, operacje równoległe, storno
│   ├── walidacja.py    reguły poprawności
│   ├── magazyn.py      stany magazynowe
│   ├── raporty.py      zestawienia
│   ├── slowniki.py     słowniki i autouzupełnianie
│   └── ustawienia.py   parametry systemu
├── dane/           odczyt i zapis
│   ├── uklad.py        układ arkuszy (wspólny z generatorem .xlsm)
│   ├── zapis.py        budowa skoroszytu
│   ├── odczyt.py       wczytanie pliku
│   ├── kartoteka.py    warstwa łącząca model z plikiem
│   ├── blokada.py      blokada pliku sieciowego
│   ├── kopie.py        kopie zapasowe
│   └── sciezki.py      tryb przenośny / zainstalowany
└── ui/             interfejs
    ├── styl.py         motyw i arkusz stylów
    ├── ikony.py        ikony rysowane wektorowo
    ├── okno.py         okno główne
    ├── widgety/        komponenty wielokrotnego użytku
    └── widoki/         ekrany programu
```

Warstwa `model` nie importuje niczego z `ui` ani z `dane` — dzięki temu logikę
można testować bez uruchamiania interfejsu, co robi `testy/test_promagazyn.py`.

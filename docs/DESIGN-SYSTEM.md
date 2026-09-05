# System wizualny ResInvest ERP

Dokument projektowy pulpitu i całej warstwy wizualizacji danych: **instancja
palety**, **układ ekranu**, **styl znaczników i interakcji** oraz **kolejność,
w jakiej to powstaje**.

Zasada nadrzędna jest jedna i wyznacza kolejność wszystkich rozdziałów:

> **Najpierw forma, potem kolor. Kolor jest policzalny, więc go liczymy.**

Dobór kolorów „na oko” jest w tym systemie zabroniony. Każda barwa serii
przechodzi przez walidator sześciu kontroli; wyniki są w rozdziale 2 i mają
zostać odtworzone po każdej zmianie palety.

---

## Spis treści

1. [Parametry i metoda](#1-parametry-i-metoda)
2. [Instancja palety ResInvest](#2-instancja-palety-resinvest)
3. [Układ pulpitu](#3-układ-pulpitu)
4. [Styl wizualizacji danych](#4-styl-wizualizacji-danych)
5. [Interakcja](#5-interakcja)
6. [Dostępność](#6-dostępność)
7. [Dokładna sekwencja tworzenia](#7-dokładna-sekwencja-tworzenia)
8. [Rozbudowa](#8-rozbudowa)
9. [Pomiary](#9-pomiary)

---

## 1. Parametry i metoda

Metoda jest niezależna od marki. Marka dostarcza wyłącznie **parametry**:

| Parametr | Co dostarcza ResInvest |
|---|---|
| Rodziny barw | osiem rodzin wywiedzionych z tożsamości: zieleń świerkowa (marka), bursztyn, stal, róża, oliwka, morski, ceglany, śliwka |
| Motyw kategorialny | **„Bór”** — stała kolejność slotów, opisana niżej |
| Rampa sekwencyjna | świerk (barwa marki), 100 → 700 |
| Rampa porządkowa | świerk, sześć stopni z widocznym skokiem jasności |
| Para rozbieżna | stal ↔ ceglany, neutralny środek |
| Paleta statusów | cztery poziomy, stałe, nietematyzowane |
| Faktura | jeden kierunkowy wypełniacz 45°/135°, wyłącznie na żądanie |
| Powierzchnie | jasna `#FFFFFF`, ciemna `#131A16` |
| Krój | Inter (ten sam, co reszta interfejsu) |

Wszystko poza tą tabelą — dobór formy, specyfikacja znaczników, sześć kontroli,
reguły interakcji i dostępności — jest wspólne i nie zmienia się razem z marką.

### Pliki

| Plik | Rola |
|---|---|
| `web/assets/viz.css` | instancja palety jako właściwości niestandardowe + style kart, znaczników i siatki pulpitu |
| `web/src/ui/charts/scale.js` | skale, podziałki, ścieżki znaczników — czyste funkcje, bez DOM |
| `web/src/ui/charts/chart-core.js` | karta wykresu, legenda, kursor, klawiatura, widok tabelaryczny, przerysowanie |
| `web/src/ui/charts/LineChart.js` | przebieg w czasie, wiele serii |
| `web/src/ui/charts/ColumnChart.js` | wartość powyżej i poniżej linii bazowej |
| `web/src/ui/charts/WaterfallChart.js` | kaskada od stanu otwarcia do stanu zamknięcia |
| `web/src/ui/charts/BarChart.js` | porównanie kategorii nominalnych |
| `web/src/ui/charts/figures.js` | liczba wiodąca, kafel wskaźnika, iskierka, znacznik zmiany |
| `web/src/views/dashboard.js` | złożenie pulpitu z powyższych |

---

## 2. Instancja palety ResInvest

### 2.1 Paleta kategorialna — motyw „Bór”

Kolejność slotów jest **mechanizmem bezpieczeństwa, nie estetyką**. Sloty
przydziela się po kolei i nigdy nie zawija po ósmym.

| Slot | Rodzina | Jasny | Ciemny | Typowe zastosowanie |
|---|---|---|---|---|
| 1 | świerk | `#007e3f` | `#007b3d` | przyjęcia, surowiec, wartość główna |
| 2 | bursztyn | `#bf8b00` | `#bb8800` | wydania, sprzedaż |
| 3 | stal | `#006bc6` | `#1c7bd8` | produkcja |
| 4 | róża | `#dd6ca6` | `#cf5f99` | — |
| 5 | oliwka | `#6d8600` | `#728d00` | — |
| 6 | morski | `#0098a4` | `#009fac` | marża, wskaźniki pochodne |
| 7 | ceglany | `#d8463b` | `#e04d41` | biegun ujemny pary rozbieżnej |
| 8 | śliwka | `#7741b4` | `#8f5acf` | — |

Trzy pierwsze sloty są dobrane tak, by przechodziły również **ostrzejszy test
„wszystkie pary”**, wymagany dla wykresów, na których dowolne dwa znaczniki
mogą sąsiadować (punktowe, bąbelkowe, kartogramy, małe wielokrotności).
Powyżej trzech serii takie formy zwijają ogon do pozycji „Pozostałe” albo
rozpadają się na małe wielokrotności — nie dokładają barw.

**Zieleń marki jest na slocie 1 w stopniu ciemniejszym niż `--spruce` z chromu
aplikacji.** To celowe: `#2E9E5B` daje na bieli 3,16:1 i nie utrzymuje progu
rozdzielności wobec bursztynu przy protanopii. Stopień `#007e3f` trzyma
tożsamość marki i przechodzi wszystkie bramki.

### 2.2 Wynik walidatora

Polecenie (ścieżka względem katalogu umiejętności `dataviz`):

```
node scripts/validate_palette.js "<sloty>" --mode <tryb> --surface <powierzchnia>
```

Tryb jasny, powierzchnia `#FFFFFF`, pary sąsiednie:

```
  [PASS] Lightness band         all 8 inside L 0.43–0.77
  [PASS] Chroma floor           all 8 >= 0.1
  [PASS] CVD separation         worst adjacent #bf8b00↔#007e3f ΔE 10.3 (protan) · tritan 11.0
  [PASS] Normal-vision floor    worst adjacent #0098a4↔#6d8600 ΔE 17.0 (normal)
  [PASS] Contrast vs surface    all 8 >= 3:1
```

Tryb ciemny, powierzchnia `#131A16`, pary sąsiednie:

```
  [PASS] Lightness band         all 8 inside L 0.48–0.67
  [PASS] Chroma floor           all 8 >= 0.1
  [PASS] CVD separation         worst adjacent #cf5f99↔#1c7bd8 ΔE 10.1 (protan) · tritan 11.2
  [PASS] Normal-vision floor    worst adjacent #009fac↔#728d00 ΔE 17.6 (normal)
  [PASS] Contrast vs surface    all 8 >= 3:1
```

Trzy pierwsze sloty, test „wszystkie pary”: ΔE CVD **10,3** (jasny) i **10,2**
(ciemny), ΔE dla widzenia pełnego **21,8** i **21,5**. Cel dla ΔE CVD wynosi 8,
próg twardy dla widzenia pełnego 15 — obie wartości są z zapasem.

> Sloty dobrał solver przeszukujący kolejności i stopnie jasności rodzin przy
> twardych ograniczeniach bramek. Pierwsze trzy pozycje zostały przypięte do
> barw marki (świerk → bursztyn → stal), reszta znaleziona optymalizacją.

### 2.3 Rampa sekwencyjna (wielkość)

Jedna barwa, od jasnej do ciemnej. Barwa domyślna: **świerk**. Druga rampa,
gdy na ekranie występują dwie skale wielkości naraz: **bursztyn**.

| stopień | 100 | 200 | 300 | 400 | 500 | 600 | 700 |
|---|---|---|---|---|---|---|---|
| świerk | `#e0f7e5` | `#b6e5c1` | `#7fca94` | `#43aa67` | `#008a45` | `#006632` | `#00441f` |

### 2.4 Rampa porządkowa (kategorie uporządkowane)

Progi, przedziały, klasy jakości. Skok jasności między stopniami musi być
widoczny, a stopień najbliższy powierzchni musi trzymać 2:1.

| tryb | stopnie | kontrola |
|---|---|---|
| jasny | `#73bf88` `#50a96d` `#269451` `#007d3e` `#006430` `#004c23` | jasny koniec 2,20:1 — PASS |
| ciemny | `#93d5a4` `#73bf88` `#50a96d` `#269451` `#007d3e` `#006430` | ciemny koniec 2,41:1 — PASS |

Walidacja: `--ordinal`. Uruchomienie walidatora **kategorialnego** na rampie
sekwencyjnej zawsze zwróci FAIL — i tak ma być; to inna kontrola.

### 2.5 Para rozbieżna (biegunowość)

**stal `#006bc6` ↔ ceglany `#d8463b`**, środek neutralny `#e3e7e4`
(w trybie ciemnym `#1c7bd8` ↔ `#e04d41`, środek `#333634`).

Zieleń ↔ czerwień — w księgowości najbardziej oczywista — została **odrzucona
po pomiarze**, nie z ostrożności:

| para | ΔE widzenie pełne | ΔE protanopia | ΔE deuteranopia |
|---|---|---|---|
| świerk ↔ ceglany | 26,0 | 11,1 | **2,3** |
| stal ↔ ceglany | 27,3 | 20,8 | **23,1** |

ΔE 2,3 oznacza, że dla osoby z deuteranopią zysk i strata mają ten sam kolor.
Znak niosą więc trzy niezależne kanały: **kierunek słupka**, **barwa** oraz
**podpisana wartość**.

### 2.6 Paleta statusów (stała, nietematyzowana)

| rola | barwa | kontrast jasny | kontrast ciemny |
|---|---|---|---|
| dobry | `#12933F` | 3,98 | 4,44 |
| ostrzeżenie | `#E0A200` | 2,25 | 7,87 |
| poważny | `#E27A45` | 2,96 | 5,98 |
| krytyczny | `#CE3A2F` | 4,92 | 3,60 |

Na jasnej powierzchni „ostrzeżenie” i „poważny” schodzą poniżej 3:1 — świadomie.
**Kolor statusu nigdy nie występuje sam**: zawsze towarzyszy mu ikona i podpis,
i to ta para, nie barwa, niesie znaczenie. Barwa statusu nigdy nie jest używana
jako „seria numer 4”, a barwa serii nigdy nie oznacza stanu.

Kilka par status–seria dzieli mniej niż 15 ΔE (najbliższe: krytyczny ↔ slot 7
ceglany, 3,1). Jest to dopuszczalne z tego samego powodu: obok statusu zawsze
stoi ikona i podpis, a status i seria nigdy nie występują w jednym znaczniku.

### 2.7 Chrom i tusz

| rola | jasny | ciemny |
|---|---|---|
| powierzchnia wykresu | `#FFFFFF` | `#131A16` |
| płaszczyzna strony | `#F1F6F2` | `#0D120F` |
| tusz podstawowy | `#1B2B21` | `#F2F6F3` |
| tusz drugorzędny | `#66786C` | `#B4C2B8` |
| podpisy osi | `#8D9E94` | `#8D9E94` |
| siatka (włos) | `#EAF0EB` | `#23302A` |
| oś i linia bazowa | `#D2DDD4` | `#35443B` |
| wyciszenie / „Pozostałe” | `#B6C0B9` | `#56655C` |
| sumy kaskady | `#75887C` | `#8B9E92` |

### 2.8 Tryb ciemny

Stopnie dla trybu ciemnego są **dobrane i zwalidowane osobno**, nie są
automatycznym odwróceniem jasnych. Włącza je wyłącznie jawny znacznik
`data-theme="dark"` na elemencie głównym. Zapytanie `prefers-color-scheme`
celowo go **nie** włącza: reszta interfejsu ma dziś jeden, świadomie wybrany
wygląd, więc wykres nie może zciemnieć sam i rozjechać się z chromem aplikacji.
Instancja jest gotowa na dzień, w którym motyw ciemny obejmie cały system.

### 2.9 Faktura

Jeden kierunkowy wypełniacz, wyłącznie pod kątem 45° i lustrzanym 135°, w tonie
własnej rampy. Uruchamia go ustawienie dostępności, wydruk albo tryb wymuszonych
kolorów. **Nigdy nie jest włączona domyślnie i nigdy nie jest ozdobą.**

### 2.10 Typografia liczb

Wszystko — z liczbą wiodącą włącznie — stoi w Interze, tym samym, co reszta
interfejsu. Żadnego kroju ozdobnego.

Duże liczby stojące samotnie (liczba wiodąca, wartość kafla) używają cyfr
**proporcjonalnych**. `font-variant-numeric: tabular-nums` jest zarezerwowane
dla miejsc, gdzie liczby stoją jedna pod drugą: wiersze tabel i podziałka osi.

---

## 3. Układ pulpitu

### 3.1 Siatka

```
┌────────────────────────────────────────────────────────────────┐
│ Nagłówek: „Pulpit” · Nowa operacja · Drukuj                    │
├────────────────────────────────────────────────────────────────┤
│ PASEK FILTRÓW  [ miesiąc ] [ 6 / 12 / 24 m-ce ]     stan okresu│  ← jeden zakres
├────────────────────────────────────────────────────────────────┤     dla całego ekranu
│ Sygnały (tylko gdy są)                                         │
├───────────────────────┬────────────────────────────────────────┤
│  LICZBA WIODĄCA       │  KAFLE 3 × 2                           │
│  zapas ogółem [MP]    │  surowiec · zrębka · produkcja         │
│  zmiana + iskierka    │  zakupy · sprzedaż · marża             │
├───────────────────────┴─────────────────┬──────────────────────┤
│  OBRÓT MAGAZYNOWY (linie, 3 serie)      │  WYNIK MIESIĄCA      │
│                                         │  (kolumny rozbieżne) │
├─────────────────────────────────────────┴──────────────────────┤
│  BILANS MIESIĄCA — kaskada BO → przychody → rozchody → BZ      │
├─────────────────────────────┬──────────────────────────────────┤
│  STRUKTURA ZAPASU (słupki)  │  OSTATNIE DOKUMENTY              │
├─────────────────────────────┴──────────────────────────────────┤
│  KWIT PRODUKCJI DNIA (gdy istnieje)                            │
└────────────────────────────────────────────────────────────────┘
```

Kolumny: `1fr / 2,1fr` dla pasa wiodącego, `1,35fr / 1fr` dla pasa przebiegów,
`1,1fr / 1fr` dla pasa dolnego. Odstęp 16 px, promień 14 px.

### 3.2 Punkty przełamania

| szerokość | zmiana |
|---|---|
| > 1180 px | układ pełny, jak wyżej |
| ≤ 1180 px | wszystkie pasy dwukolumnowe schodzą do jednej kolumny |
| ≤ 720 px | kafle 2 × 3, mniejszy padding kart, mniejsza wartość kafla |
| ≤ 420 px | kafle w jednej kolumnie |

Wykresy nie mają stałej wysokości podanej „na oko”: **wysokość karty obejmuje
pasmo podpisów osi**, więc rysunek nigdy nie dostaje własnego, zagnieżdżonego
paska przewijania. Kontroluje to test przeglądarkowy (`przewijanie w rysunku 0`).

### 3.3 Kolejność czytania

Filtr → sygnał → stan → wynik → przyczyna → szczegół. Pulpit odpowiada w tej
kolejności na cztery pytania: **ile mam**, **czy miesiąc wyszedł na plus**,
**skąd się wziął ten stan**, **co się ostatnio działo**.

### 3.4 Filtry

Jeden rząd, nad wszystkim, co zawęża — nigdy wewnątrz karty wykresu i nigdy
per wykres. Zakres dat pierwszy, bo po niego sięga się najczęściej. Zmiana
filtra:

* **nie przebudowuje strony** — nagłówek i pasek filtrów są zbudowane raz,
* przygasza poprzedni rysunek zamiast go zdejmować (bez migotania i bez skoku
  układu),
* aktualizuje adres przez `history.replaceState`, więc link do konkretnego
  miesiąca da się wysłać, a ognisko klawiatury zostaje w pasku filtrów.

---

## 4. Styl wizualizacji danych

### 4.1 Dobór formy — decyzja przed kolorem

| Panel | Zadanie danych | Forma | Dlaczego nie inaczej |
|---|---|---|---|
| Zapas ogółem | jedna bieżąca liczba, którą ekran prowadzi | **liczba wiodąca** ≥ 48 px | wykres słupkowy o jednym słupku nie jest wykresem |
| Sześć wskaźników | garść liczb nagłówkowych | **rząd kafli** (wartość + zmiana + iskierka) | grupowany wykres słupkowy sześciu niezwiązanych wielkości niczego nie porównuje |
| Obrót magazynowy | przebieg w czasie, trzy serie do rozróżnienia | **linie** + paleta kategorialna | 12 miesięcy × 3 serie to 36 słupków — gęstwina bez poziomu i bez kierunku |
| Wynik miesiąca | biegunowość wobec zera | **kolumny rozbieżne** | linia nie pokazuje znaku tak wyraźnie jak słupek wyrastający w dół |
| Bilans miesiąca | z czego wynika stan | **kaskada** | jedyna forma pokazująca naraz stan i jego przyczynę |
| Struktura zapasu | porównanie kategorii nominalnych | **słupki poziome, jedna barwa** | nazwy produktów są długie; rampa „im większy, tym ciemniejszy” zużyłaby kanał tożsamości na powtórzenie długości słupka |
| Ostatnie dokumenty | zdarzenia, nie wielkości | **lista** | to nie są dane do wykresu |

Serie w formach kategorialnych nigdy nie przekraczają trzech. Powyżej — zwijamy
ogon do „Pozostałe” albo rozbijamy na małe wielokrotności; **nigdy nie
dokładamy barw**.

### 4.2 Specyfikacja znaczników (stała w całym systemie)

| Znacznik | Specyfikacja |
|---|---|
| Słupek | **maks. 24 px** grubości (kaskada 40 px); **zaokrąglenie 4 px od strony danych**, kwadratowo przy linii bazowej |
| Linia | **2 px**, zaokrąglone złącza i końce |
| Znacznik końcowy | promień 4,5 px (≥ 8 px średnicy), wypełniony barwą serii |
| Mycie pod linią | barwa serii przy **10 %** krycia, wyłącznie przy jednej serii |
| Siatka i osie | włos 1 px, **ciągły**, jeden stopień od powierzchni; linia zera o stopień mocniejsza |

### 4.3 Dwa odstępy — biel jako separator

* **Prześwit 2 px** w kolorze tła między stykającymi się słupkami.
* **Obwódka 2 px** w kolorze tła na znacznikach, żeby zostały czytelne tam,
  gdzie linie się krzyżują. Obwódka jest częścią obszaru trafienia, nie tylko
  odstępem.

Wokół znacznika **nigdy nie rysujemy obrysu** dla oddzielenia go od sąsiada.
Obrys dokłada tusz o wadze danych, który danymi nie jest.

### 4.4 Etykiety

* **Nigdy liczba przy każdym punkcie.** Podpisujemy koniec przebiegu, wartość
  skrajną i okres bieżący; resztę niesie podziałka, legenda i podpowiedź.
* **Etykieta, która się nie mieści, nie jest przycinana — mierzymy najpierw.**
  Margines osi wartości liczy się z najdłuższego podpisu, margines prawy z
  najdłuższej etykiety końcowej. To nie jest drobiazg: przy sztywnych 54 px
  podpis „2,5 tys.” tracił pierwszą cyfrę, a „9,3 tys. MP” ostatnią literę.
* **Kolidujących etykiet nie rozsuwamy.** Rozsunięta etykieta odrywa się od
  swojej linii i czyta się jak szum. Zamiast tego znikają wszystkie, a rolę
  przejmuje legenda i podpowiedź — wartość i tak zostaje w widoku tabelarycznym.
* **Tekst nigdy nie nosi barwy danych.** Barwę niosą znaczniki; podpisy,
  wartości i legendy stoją w tuszu (podstawowym, drugorzędnym albo osi).
  Tożsamość daje kolorowy znacznik **obok** tekstu, nigdy kolor samego tekstu.
* Na wąskim ekranie, gdy na pozycję przypada mniej niż ~46–66 px, podpisy
  wartości znikają w całości. Nic nie ginie: niesie je podpowiedź i tabela.

---

## 5. Interakcja

Wykres w przeglądarce **jest** interaktywny — warstwa najechania jest częścią
dostawy, nie dodatkiem.

| Element | Zachowanie |
|---|---|
| Kreska prowadząca | pionowa linia podąża za kursorem i przyskakuje do najbliższej pozycji; czytelnik celuje w miesiąc, nie w linię o grubości 2 px |
| Podpowiedź na przebiegach | jedna, wymienia **wszystkie** serie w danym punkcie |
| Podpowiedź na słupkach | własna dla każdego znacznika; znacznik pod kursorem rozjaśnia się |
| Obszar trafienia | **większy niż znacznik** — całe pasmo pozycji, minimum 24 px |
| Hierarchia w podpowiedzi | **wartość jest elementem mocnym**, nazwa serii drugorzędnym — odwrotnie niż w legendzie, bo tu czytelnik zna serię i chce liczbę |
| Klucz serii w podpowiedzi | krótka kreska w barwie serii, nie wypełniony kwadrat |
| Odświeżenie | poprzedni rysunek zostaje przygaszony; **bez szkieletu i bez skoku układu** |

Nazwy serii i kategorii pochodzą z bazy (nazwy produktów, kontrahentów), więc
do DOM trafiają przez `textContent`, **nigdy** przez sklejanie `innerHTML`.

---

## 6. Dostępność

| Wymóg | Realizacja |
|---|---|
| Żadna wartość tylko pod kursorem | **każdy wykres ma bliźniaczy widok tabelaryczny** przełączany przyciskiem w nagłówku karty |
| Klawiatura równa myszy | obszar rysunku jest ogniskowalny; strzałki przesuwają wskazanie, `Esc` chowa podpowiedź, treść identyczna jak przy najechaniu |
| Czytnik ekranu | rysunek ma `role="img"`, `aria-labelledby` (tytuł) i `aria-describedby` (opis zdaniem); tabela ma `<caption>` |
| Tożsamość nie tylko kolorem | legenda obecna zawsze przy dwóch i więcej seriach; etykiety bezpośrednie ją uzupełniają, nie zastępują |
| Stan wczytywania | `aria-busy` na karcie; komunikat stanu w obszarze `aria-live` |
| Kontrast | każdy slot ≥ 3:1 do powierzchni w obu trybach (patrz 2.2) |
| Zaburzenia widzenia barw | ΔE ≥ 10 dla par sąsiednich w obu trybach; para rozbieżna dobrana pomiarem, nie zwyczajem |
| Ograniczony ruch | `prefers-reduced-motion` wyłącza przejścia |
| Wydruk | karty nie łamią się w poprzek, cienie i narzędzia znikają, liczba wiodąca traci tło |

---

## 7. Dokładna sekwencja tworzenia

Kolejność nie jest dowolna — każdy krok korzysta z wyniku poprzedniego.
Odwrócenie kroków 1 i 3 jest najczęstszym źródłem ładnych wykresów, które
kłamią.

**Krok 0 — dane, zanim cokolwiek narysujesz.**
Ustal, co API faktycznie zwraca. Pulpit wymagał dołożenia szeregu miesięcznego
i bilansu miesiąca — bez nich każdy przebieg byłby zmyślony.
→ `computeDashboard` w `server/src/modules/reports/reports.service.js`.

**Krok 1 — forma z zadania danych.**
Dla każdego panelu odpowiedz: wielkość, tożsamość, biegunowość, przebieg czy
jedna liczba? Tabela z rozdziału 4.1 jest zapisem tej decyzji. Sprawdź też,
czy to w ogóle wykres — trzy z siedmiu paneli pulpitu nim nie są.

**Krok 2 — przypisz kolor do zadania, nie do gustu.**
Kategorialny (tożsamość), porządkowy (kolejność), sekwencyjny (wielkość),
rozbieżny (biegunowość), status (stan). Każdy ma jedną regułę.

**Krok 3 — POLICZ paletę. Nie oceniaj jej wzrokiem.**

```
node scripts/validate_palette.js "#007e3f,#bf8b00,#006bc6,#dd6ca6,#6d8600,#0098a4,#d8463b,#7741b4" \
     --mode light --surface "#FFFFFF"
node scripts/validate_palette.js "#007b3d,#bb8800,#1c7bd8,#cf5f99,#728d00,#009fac,#e04d41,#8f5acf" \
     --mode dark  --surface "#131A16"
node scripts/validate_palette.js "#007e3f,#bf8b00,#006bc6" --mode light --surface "#FFFFFF" --pairs all
node scripts/validate_palette.js "#73bf88,#50a96d,#269451,#007d3e,#006430,#004c23" --ordinal --mode light --surface "#FFFFFF"
```

Każdy FAIL naprawiamy **przed** napisaniem pierwszej linii kodu wykresu.

**Krok 4 — znaczniki i odstępy.**
Cienkie znaczniki, zaokrąglenie 4 px od strony danych, linia 2 px, prześwit
2 px, obwódka 2 px, siatka włosowa ciągła, etykiety wybiórczo.

**Krok 5 — warstwa najechania, domyślnie.**
Kreska prowadząca i podpowiedź na przebiegach, podpowiedź na znaczniku przy
słupkach. Obszar trafienia większy niż znacznik.

**Krok 6 — przejście po dostępności.**
Widok tabelaryczny, klawiatura, legenda, opisy dla czytnika, stopnie trybu
ciemnego dobrane osobno.

**Krok 7 — narysuj i POPATRZ.**
Walidator sprawdza kolor, nie geometrię. Zrzuty ekranu na 1440, 1180, 720,
520, 390 i 360 px; osobno na danych syntetycznych z 12 i 24 punktami, bo
zestaw testowy bywa krótszy niż rzeczywistość. W tym projekcie ten krok wykrył
cztery usterki, których żaden test jednostkowy by nie złapał:

| Usterka | Poprawka |
|---|---|
| podpisy osi wartości ucięte z lewej | margines liczony z najdłuższego podpisu |
| nazwy produktów ucięte do nierozróżnialnych ogonków | nazwa nad słupkiem, nie w kolumnie o stałej szerokości |
| etykieta końcowa „9,3 tys. MP” bez ostatniej litery | margines prawy liczony z najdłuższej etykiety końcowej |
| dwa ostatnie podpisy osi stykające się bokami | wspólny dobór indeksów podpisów, ostatni ma pierwszeństwo |

**Krok 8 — przejście po katalogu antywzorców.**
Dwie osie wartości, przemalowanie po filtrze, cyklowanie barw powyżej ośmiu,
rampa na kategoriach nominalnych, tęcza, barwa w środku pary rozbieżnej,
status w roli serii, liczba przy każdym punkcie, obrys zamiast prześwitu,
podpowiedź jako jedyne źródło wartości, filtry wewnątrz karty. W tym pulpicie
żaden nie występuje — dwa (rampa na kategoriach nominalnych, zieleń↔czerwień)
zostały świadomie odrzucone na etapie projektu i opisane wyżej.

**Krok 9 — pomiar.**
Węzły DOM, rozmiar odpowiedzi, czas odświeżenia filtra. Rozdział 9.

---

## 8. Rozbudowa

### Nowy wykres

1. Zadanie danych → forma (rozdział 4.1). Jeśli to jedna liczba — kafel, nie wykres.
2. Nowy moduł w `web/src/ui/charts/` dostarcza **wyłącznie geometrię**:
   `layout(width)` zwraca wysokość i marginesy, `render(box)` zwraca SVG oraz
   listę obszarów trafienia. Karta, legenda, kursor, klawiatura, tabela i
   przerysowanie przychodzą z `chart-core.js` za darmo.
3. `tooltip(index)` i `table()` są **obowiązkowe**, nie opcjonalne — bez nich
   wartość byłaby dostępna tylko pod kursorem.
4. Zrzut ekranu na trzech szerokościach przed uznaniem za skończone.

### Zmiana palety

Zmiana choćby jednego slotu wymaga ponownego uruchomienia walidatora dla
**obu** trybów oraz testu „wszystkie pary” dla pierwszych trzech slotów. Sloty
są dobrane parami, nie pojedynczo — podmiana jednej barwy „bo ładniejsza”
psuje rozdzielność sąsiada.

### Nowa marka

Wypełnij tabelę parametrów z rozdziału 1 własnymi rampami, przepuść je przez
walidator, przypnij pierwsze sloty do barw marki i zoptymalizuj resztę.
Metoda, znaczniki, interakcja i dostępność zostają bez zmian.

---

## 9. Pomiary

Pulpit na bazie kontrolnej (304 dokumenty, 3 miesiące danych), Chromium 1440 px:

| Miara | Wartość |
|---|---|
| Węzły DOM widoku | 437 |
| w tym węzły SVG | 105 |
| Rozmiar HTML widoku | 27,4 kB |
| Odpowiedź `/reports/dashboard` | 5,5 kB |
| Odświeżenie po zmianie filtra | 59–68 ms |

Kontrole automatyczne:

| Zestaw | Wynik |
|---|---|
| Testy jednostkowe i integracyjne (`npm test`) | 119 / 119 |
| Interakcja i dostępność wykresów | 17 / 17 |
| Regresja przeglądarkowa (desktop + telefon) | 13 / 13 |
| Przewijanie w poziomie na 1440 / 1180 / 390 px | 0 px |
| Zagnieżdżone przewijanie w rysunku | 0 kart |
| Błędy konsoli | 0 |

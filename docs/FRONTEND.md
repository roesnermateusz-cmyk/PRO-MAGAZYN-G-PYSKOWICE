# Warstwa kliencka: wydajność i architektura komponentów

Serwer dostał cztery fazy uwagi (budowa, przegląd, debugowanie, skalowanie).
Ten dokument opisuje piątą, poświęconą aplikacji w przeglądarce: pomiar
wydajności renderowania, znalezione wąskie gardła, warstwę komponentów
wielokrotnego użytku i uruchamianie systemu na Windows.

Liczby pochodzą z pomiarów na bazie z 304 dokumentami, przez sterowaną
przeglądarkę Chromium, nie z szacunków.

---

## 1. Metoda pomiaru

Aplikacja nie ma kroku budowania ani frameworka, więc nie ma też gotowych
narzędzi profilujących „przerenderowania”. Zbudowaliśmy je: podmieniony setter
`Element.prototype.innerHTML` liczy każdą przebudowę poddrzewa, jej rozmiar
w znakach i element docelowy. Do tego licznik węzłów DOM, zużycie sterty
i liczba żądań na przejście między ekranami.

Ta instrumentacja odpowiada wprost na pytanie „co się niepotrzebnie renderuje”,
bo pokazuje, ile HTML-a powstaje przy czynności, która zmienia jeden wiersz.

---

## 2. Problemy z wydajnością

### P1. Zmiana filtra przebudowywała cały ekran

**Pomiar:** 322 kB HTML i około 500 ms na jedno kliknięcie w filtr typu.

Widok listy miał jedną funkcję `refresh()`, która pobierała dane i wstawiała
cały ekran do `view.innerHTML`: nagłówek, przyciski, siedem filtrów, tabelę,
karty mobilne i stronicowanie. Zmieniały się wyłącznie wiersze.

**Skutki uboczne, dotkliwsze niż same milisekundy:**

* **Ginął fokus i kursor.** Magazynier wpisywał frazę, naciskał Enter — pole
  wyszukiwania było w tej samej chwili zastępowane nowym, pustym elementem.
  Kursor lądował poza formularzem, a dopisanie litery wymagało ponownego
  kliknięcia w pole. Przy dziesiątkach wyszukiwań dziennie to nie jest drobiazg.
* **Listy rozwijane produktów i magazynów** były serializowane od nowa przy
  każdym kliknięciu, choć kartoteka się nie zmieniła.
* **Skakało przewinięcie strony.**

### P2. Każdy wiersz renderowany dwa razy

Rejestr miał dwa równoległe szablony jednego wiersza: `rowHtml` dla tabeli
i `cardHtml` dla karty na telefonie. Oba budowane ZAWSZE; arkusz stylów ukrywał
ten niepasujący do szerokości ekranu.

Na komputerze powstawało pięćdziesiąt niewidocznych kart, na telefonie —
pięćdziesiąt niewidocznych wierszy po trzynaście kolumn. Połowa pracy przy
budowie drzewa DOM szła w nic, przy każdym odświeżeniu.

Drugi koszt jest trwalszy niż wydajnościowy: dwa szablony to dwa miejsca,
w których trzeba pamiętać o zmianie kolumny — i jedno, o którym się zapomni.

### P3. Ikony wklejane w każdy wiersz

Każdy przycisk akcji niósł pełny rysunek SVG — około 280 znaków. Cztery akcje
razy pięćdziesiąt wierszy to **dwieście identycznych rysunków** w kodzie strony,
przy każdej zmianie filtra. Pomiar: 36 kB z 120 kB przebudowy listy, czyli
blisko jedna trzecia.

### P4. Nieuporządkowane odpowiedzi serwera

Filtry zmienia się szybciej, niż serwer odpowiada. Dwa kliknięcia pod rząd mogą
wrócić w odwrotnej kolejności i wtedy na ekranie zostaje wynik STARSZEGO
zapytania, mimo że pasek filtrów pokazuje nowszy. Błąd cichy: liczby wyglądają
poprawnie, tylko nie odpowiadają temu, o co użytkownik prosił.

---

## 3. Strategie optymalizacji

| Problem | Strategia | Dlaczego ta |
|---|---|---|
| P1 | Aktualizacja częściowa: szkielet raz, dane wielokrotnie | Naprawia przyczynę (przebudowa całości), nie objaw |
| P2 | Jedna definicja kolumn, jeden wariant renderowany | Nie da się zbudować obu, bo nie ma dwóch szablonów |
| P3 | Wspólne definicje ikon i odwołania do nich | Przeglądarka parsuje kształt raz |
| P4 | Numer żądania; odpowiedź na porzucone jest wyrzucana | Jedyny sposób odporny na kolejność sieci |

Odrzucone świadomie:

* **Wirtualizacja listy** (renderowanie tylko widocznych wierszy). Strona ma
  pięćdziesiąt pozycji, a górny limit to pięćset. Wirtualizacja dokłada logikę
  przewijania, psuje wyszukiwanie w przeglądarce (Ctrl+F) i drukowanie —
  za zysk, którego przy tej liczbie wierszy nie widać.
* **Framework reaktywny.** Cały problem sprowadzał się do renderowania całości
  zamiast części. Rozwiązanie zajęło cztery pliki i nie dokłada zależności do
  produktu, który celowo nie ma żadnych.

---

## 4. Architektura komponentów

### 4.1 Struktura folderów

```
web/src/
├── core/               infrastruktura, bez wiedzy o wyglądzie
│   ├── api.js          klient HTTP, odświeżanie tokenu
│   ├── router.js       trasowanie po fragmencie adresu
│   ├── store.js        sesja, uprawnienia, kartoteki
│   ├── dom.js          ucieczka HTML, delegacja zdarzeń, formularze
│   └── format.js       liczby, daty, waluty
│
├── ui/                 ★ komponenty wielokrotnego użytku, bez wiedzy o domenie
│   ├── DataTable.js    lista: jedna definicja kolumn → tabela ALBO karty
│   ├── Toolbar.js      pasek filtrów z deklaracji
│   ├── Pager.js        stronicowanie
│   └── ListScreen.js   złożenie: nagłówek + filtry + lista + strony
│
├── components/         elementy szkieletu aplikacji
│   ├── layout.js       sidebar, pasek zakładek, panel „Więcej”
│   └── icons.js        ikony w dwóch postaciach (pełnej i odwołaniowej)
│
└── views/              ekrany: dane domenowe + skład komponentów
```

Kierunek zależności jest jednostronny: `views` → `ui` → `core`. Komponent
w `ui/` nie wie, że istnieje dokument magazynowy — dostaje kolumny i wiersze.
Dzięki temu ta sama lista obsługuje rejestr operacji, kartoteki i korekty.

### 4.2 Rozdzielenie odpowiedzialności

| Warstwa | Odpowiada za | NIE odpowiada za |
|---|---|---|
| `views/*.js` | Co pokazać: kolumny, filtry, akcje domenowe | Jak to zbudować w DOM |
| `ui/DataTable` | Zbudowanie listy, wybór wariantu, aktualizacja częściowa | Znaczenie danych |
| `ui/Toolbar` | Pola filtrów, zachowanie fokusu | Co filtry znaczą |
| `ui/ListScreen` | Przepływ: pobranie → podmiana, porzucanie odpowiedzi | Wygląd |
| `core/api` | Komunikacja, tokeny, błędy | Cokolwiek wizualnego |

Widok rejestru operacji po migracji **deklaruje** kolumny i filtry zamiast
budować HTML. Kod przeszedł z pisania znaczników na opisywanie danych.

---

## 5. Projektowanie propsów

Zasada: **props opisują dane i zamiary, nie wygląd.** Komponent nie przyjmuje
klas CSS ani fragmentów HTML układu — przyjmuje kolumny, akcje i zdarzenia.

### DataTable

```js
createDataTable({
  caption: 'Rejestr dokumentów magazynowych',   // dla czytnika ekranu, wymagane
  columns: [
    {
      key: 'docNo',                  // identyfikator kolumny
      label: 'Dokument',             // nagłówek
      cell: (row) => docStamp(row.docNo),   // treść komórki
      align: 'num',                  // wyrównanie liczb
      nowrap: true,                  // zakaz łamania
      cls: 'ellip',                  // klasa komórki
      card: 'title',                 // gdzie trafia na karcie mobilnej
      cardLabel: 'Wartość',          // etykieta przed wartością na karcie
    },
  ],
  rowKey: (row) => row.id,
  rowClass: (row) => (row.status === 'CANCELLED' ? 'cancelled' : ''),
  actions: (row) => [{ act: 'view', icon: 'eye', label: 'Podgląd', danger: false }],
  footer: (rows, totals) => '<td colspan="6">Razem</td>…',
  empty: { title: 'Nic nie znaleziono', hint: 'Zmień filtry.' },
  onAction: (act, row) => {},
  onRowActivate: (row) => {},
});
```

**Decyzje w tym interfejsie:**

* `cell` jest funkcją, nie ścieżką do pola. Kolumna „Kontrahent” zależy od typu
  dokumentu, „Wartość” od tego, czy to zakup czy sprzedaż. Ścieżka wymuszałaby
  przygotowywanie danych przed przekazaniem, czyli drugie miejsce z logiką.
* `card` przyjmuje nazwę obszaru (`title`, `meta`, `body`, `foot`), a nie
  `true`/`false`. Karta na telefonie ma pokazać kilka najważniejszych wartości
  w sensownym układzie, nie trzynaście kolumn jedna pod drugą.
* `actions` jest funkcją wiersza, bo zestaw przycisków zależy od statusu
  dokumentu i uprawnień użytkownika. Wpisy `false` są odsiewane, więc warunki
  zapisuje się wprost: ``editable && { act: 'edit', … }``.
* `label` w akcji jest **zdaniem**, nie słowem: „Storno dokumentu PZ/2026/000090”.
  To jest tekst, który usłyszy osoba niewidoma — samo „Storno” przy pięćdziesięciu
  wierszach nic nie mówi.

### Toolbar

```js
createToolbar({
  fields: [
    { type: 'chips',  name: 'type', label: 'Typ dokumentu', options: [...] },
    { type: 'search', name: 'q',    label: 'Szukaj w rejestrze', placeholder: '…' },
    { type: 'select', name: 'productId', label: 'Produkt', options: catalog.products },
    { type: 'month',  name: 'month', label: 'Miesiąc' },
  ],
  value: filters,                     // źródło prawdy, mutowane na miejscu
  onChange: (patch) => { … },         // wyłącznie zmienione pola
});
```

`onChange` dostaje **łatkę**, nie komplet filtrów. Ekran decyduje, co z nią
zrobić (tu: scalenie i zerowanie strony), a pasek nie musi znać zasad.

### ListScreen

```js
createListScreen({
  title, subtitle, headerActions,
  filters, fields, table,
  load:   (f) => api.get('/operations', f),
  select: (data) => ({ rows: data.items, page: data.page,
                       status: `${data.page.total} dokument(ów)`, extra: data.totals }),
  onMount: (view) => { /* podpięcia poza komponentami */ },
});
```

`load` i `select` są rozdzielone celowo: pierwsze wie, skąd wziąć dane, drugie —
jak z odpowiedzi wyłuskać to, czego potrzebują komponenty. Zmiana kształtu
odpowiedzi API dotyka jednej funkcji.

---

## 6. Dostępność

Sprawdzone automatycznie na zmigrowanym ekranie, wszystkie kontrole przechodzą:

| Sprawdzenie | Wynik |
|---|---|
| Tabela ma podpis dla czytnika ekranu | „Rejestr dokumentów magazynowych” |
| Każdy nagłówek ma `scope="col"` | 13/13 |
| Stan wczytywania ogłaszany (`aria-busy`) | tak |
| Każdy przycisk ma nazwę dostępną | 200/200 |
| Każde pole filtra ma etykietę | 5/5 |
| Filtry typu jako `role="group"` z `aria-pressed` | tak |
| Licznik wyników `aria-live="polite"` | tak |
| Stronicowanie jako obszar nawigacji z ogłaszanym zakresem | tak |
| Akcja wiersza osiągalna klawiaturą | po 7 naciśnięciach Tab |

Rozstrzygnięcia warte odnotowania:

* **Klasa `.sr-only` zamiast `display:none`.** Obie wersje ukrywają treść
  wzrokowo, ale `display:none` usuwa element z drzewa dostępności — czyli
  dokładnie stamtąd, gdzie podpis tabeli ma być słyszalny.
* **Przyciski wyłączane atrybutem `disabled`, nie stylem.** Inaczej fokus
  wędruje na element, który nic nie robi.
* **Lista przygasa zamiast znikać** na czas wczytywania. Znikająca lista zabiera
  kontekst i powoduje skok układu; `opacity` z `aria-busy` mówi to samo, nie
  ruszając strony.

---

## 7. Wyniki

### Renderowanie listy dokumentów

| Miara | Przed | Po |
|---|---:|---:|
| HTML przy zmianie filtra | 322 kB | **84 kB** |
| Przebudowane poddrzewa | cały ekran | 3 (wiersze, karty, podsumowanie) |
| Niewidoczne węzły DOM (komputer) | 50 kart | **0** |
| Niewidoczne węzły DOM (telefon) | 50 wierszy × 13 kolumn | **0** |
| Fokus po wpisaniu frazy i Enter | tracony | **zachowany** |
| HTML na 20 przejść między ekranami | 616 kB | 495 kB |

### Uruchamianie na Windows

| Miara | START.bat | ResInvestERP.exe |
|---|---|---|
| Okno konsoli | zostaje na ekranie | brak |
| Przypadkowe zamknięcie serwera | jedno kliknięcie w „X” | niemożliwe |
| Podwójne uruchomienie | druga kopia, konflikt portu | otwiera przeglądarkę |
| Ikona i obecność w systemie | brak | zasobnik + menu Start |
| Diagnostyka | brak | `--sprawdz` |

---

## 8. Uruchamianie na Windows

Instalator buduje `ResInvestERP.exe` **na miejscu**, kompilatorem C#, który jest
składnikiem systemu Windows od wersji 8 (`csc.exe` w katalogu .NET Framework).
Nic nie trzeba pobierać ani instalować.

**Dlaczego nie gotowy plik w archiwum.** Plik wykonywalny z pliku ZIP
pobranego z internetu dziedziczy blokadę systemu i bez podpisu cyfrowego
zostaje zatrzymany przez SmartScreen. Plik zbudowany lokalnie tego problemu
nie ma. Gdyby kompilatora zabrakło, instalator mówi to wprost, a system
uruchamia się dotychczasowym `START.bat`.

**Co robi launcher:**

1. Czyta port z `.env`.
2. Sprawdza, czy system już działa — jeśli tak, otwiera tylko przeglądarkę.
   Podwójne kliknięcie ikony nie uruchamia drugiego serwera.
3. Startuje serwer Node jako proces potomny **bez okna konsoli**.
4. Czeka na odpowiedź kontroli stanu, potem otwiera przeglądarkę.
5. Zostaje w zasobniku: menu z otwarciem aplikacji, folderem danych,
   dziennikiem serwera i zakończeniem pracy.

**Diagnostyka.** `ResInvestERP.exe --sprawdz` wypisuje stan środowiska —
czy jest Node, czy komplet plików, czy port wolny — bez uruchamiania czegokolwiek
i bez zdalnego dostępu do komputera. Kontrola działa przed inicjalizacją
interfejsu graficznego, żeby odpowiedziała także wtedy, gdy zawodzi właśnie
warstwa graficzna.

**Zatrzymanie serwera** jest twarde (`Kill`), ale bezpieczne dla danych: baza
pracuje w trybie WAL, a każdy zapis kończy się zatwierdzoną transakcją, więc
utracić można najwyżej żądanie w locie.

---

## 9. Zakres migracji

Warstwa komponentów jest wdrożona na **rejestrze operacji** — jedynym ekranie,
na którym wystąpił pełny zestaw zmierzonych problemów: filtry, stronicowanie,
dwa warianty wiersza i pięćdziesiąt pozycji na stronę.

Pozostałe ekrany świadomie zostały przy dotychczasowym sposobie renderowania:

| Ekran | Dlaczego bez zmian |
|---|---|
| Stan magazynowy | Kilka wierszy, filtry bez stronicowania; przebudowa całości kosztuje ułamek milisekundy |
| Korekty | To nie tabela, tylko kanał zmian ze stanem przed i po — inny wzorzec |
| Kartoteki | Cztery zakładki po kilkadziesiąt pozycji, bez filtrowania w locie |
| Użytkownicy, Okresy | Listy bez filtrów i bez stronicowania — problem P1 tam nie występuje |
| Pulpit, Raporty, Formularz | Nie są listami |

To nie jest dług do spłacenia „kiedyś”, tylko rozstrzygnięcie: komponent
wprowadza się tam, gdzie rozwiązuje zmierzony problem. Gdy któryś z tych
ekranów dorobi się filtrów i stronicowania, `createListScreen` czeka gotowy —
migracja to wtedy deklaracja kolumn, nie przepisywanie renderowania.

---

## Powiązane dokumenty

| Dokument | Zakres |
|---|---|
| [UI.md](UI.md) | System wizualny, responsywność, wydruk |
| [SCALING.md](SCALING.md) | Wydajność serwera: model odczytu, buforowanie |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Architektura całości |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Wdrożenie i utrzymanie |

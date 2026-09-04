# Architektura skalowania

Dokument opisuje, jak system znosi wzrost: ile danych i użytkowników obsłuży
w obecnym kształcie, co się zepsuje jako pierwsze, jakim kosztem przesuwa się
każdą kolejną granicę. Zawiera projekt architektury, strukturę komponentów,
przepływ danych, projekt API, schemat bazy i strategię buforowania.

Wszystkie liczby pochodzą z pomiarów na bazie odwzorowującej pięć lat pracy
(18 544 dokumenty, 63 miesiące), nie z szacunków.

---

## 1. Czym jest ten produkt

Skalowanie zależy od tego, co system faktycznie robi, więc zacznijmy od
charakterystyki obciążenia — bo to ona przesądza o wyborach niżej.

| Cecha | Wartość | Konsekwencja architektoniczna |
|---|---|---|
| Zapisy | 20–60 dokumentów dziennie | Ścieżka zapisu nie jest wąskim gardłem |
| Odczyty | Pulpit i stany odświeżane stale, przez wszystkich | Odczyt decyduje o odczuciu „szybkości” |
| Stosunek odczyt/zapis | około 200 : 1 | Opłaca się liczyć raz i podawać wielokrotnie |
| Wymóg poprawności | Bezwzględny — audyt KZR/SURE | Nieaktualny stan jest gorszy niż wolny |
| Przyrost danych | ~10 000 dokumentów rocznie | Po pięciu latach historia dominuje nad bieżącym miesiącem |
| Wdrożenie | On-premise, jedna lokalizacja | Brak Redisa, brak klastra, brak rejestru npm |

Dwa wnioski przesądzają o całej reszcie:

1. **Problemem jest odczyt, nie zapis.** Optymalizacja zapisu byłaby pracą
   w miejscu, gdzie nikt nie czeka.
2. **Nieaktualna liczba jest gorsza niż wolna.** Magazynier zobaczy, że system
   myśli. Nie zobaczy, że pokazał stan sprzed dwóch dokumentów.

---

## 2. Architektura

### 2.1 Warstwy

```
   Przeglądarka (SPA, natywne moduły ES, bez kroku budowania)
        │  JSON przez HTTPS · ETag na plikach aplikacji
        ▼
┌───────────────────────────────────────────────────────────┐
│  Warstwa HTTP        router · uwierzytelnianie · limity    │
│  lib/http.js         nagłówki bezpieczeństwa · żądania     │
│                      warunkowe · haki onRequest/onResponse │
├───────────────────────────────────────────────────────────┤
│  Warstwa odczytu     pamięć podręczna z unieważnianiem     │
│  lib/cache.js        po tagach · liczniki metryk           │
├───────────────────────────────────────────────────────────┤
│  Serwisy domenowe    reguły biznesowe, walidacja,          │
│  modules/*/          transakcje, audyt                     │
├───────────────────────────────────────────────────────────┤
│  Silnik domenowy     jednostki · numeracja · ruchy         │
│  domain/             magazynowe · łańcuch operacji         │
├───────────────────────────────────────────────────────────┤
│  Repozytorium        db.all/get/value/run/tx               │
│  db/index.js         przenośny SQL · statystyki planisty   │
├───────────────────────────────────────────────────────────┤
│  SQLite (WAL)        rejestr ruchów + model odczytu        │
│                      utrzymywany wyzwalaczami              │
└───────────────────────────────────────────────────────────┘
```

Każda warstwa zna wyłącznie warstwę pod sobą. Warstwa HTTP nie wie o istnieniu
bazy — synchronizacja pamięci podręcznej wchodzi przez hak `onRequest`
wstrzykiwany w `app.js`. Dzięki temu wymiana SQLite na PostgreSQL nie dotyka
niczego powyżej repozytorium.

### 2.2 Trzy poziomy obrony przed kosztem odczytu

To jest sedno projektu. Każdy poziom łapie to, czego nie łapie następny.

```
Żądanie GET
   │
   ├─ 1. Żądanie warunkowe (ETag)     klient ma aktualną kopię
   │                                  → 304, zero bajtów treści
   │                                  (pliki aplikacji, nie dane)
   │
   ├─ 2. Pamięć podręczna procesu     wynik policzony wcześniej
   │     lib/cache.js                 → zero zapytań do bazy
   │                                  ~0,015 ms zamiast 15–50 ms
   │
   └─ 3. Model odczytu                stan z tabeli sald
         stock_balances               → O(produkty) zamiast O(ruchy)
                                      0,1 ms zamiast 13,7 ms
```

Poziomy 2 i 3 nie zastępują się nawzajem, tylko uzupełniają, i to jest
najważniejsza decyzja w tym dokumencie:

* Sama pamięć podręczna nie wystarcza. Każdy zapis ją unieważnia, a przy
  czterdziestu dokumentach dziennie pierwsze wejście po każdym zapisie płaciłoby
  pełny koszt. Przy dziesięciu latach historii byłoby to pół sekundy — kilkadziesiąt
  razy dziennie, dla każdego użytkownika.
* Sam model odczytu też nie wystarcza. Przyspiesza stan magazynowy, ale nie
  raporty miesięczne (43 ms) ani wyszukiwanie (25 ms), bo te agregują dokumenty,
  a nie salda.

Razem dają: uzupełniony wynik w ułamku milisekundy, a pierwszy po zapisie —
w kilkunastu.

---

## 3. Struktura komponentów

```
server/src/
├── app.js                    złożenie routera i haków (metryki, synchronizacja)
├── index.js                  proces: nasłuch, zadania cykliczne, zamykanie
│
├── lib/
│   ├── cache.js              ★ pamięć podręczna, tagi, słownik obszarów
│   ├── metrics.js            ★ liczniki tras i czasów odpowiedzi
│   ├── http.js               router, żądania warunkowe, haki
│   └── validate.js           walidacja deklaratywna
│
├── db/
│   ├── index.js              repozytorium, statystyki planisty, data_version
│   ├── health.js             ★ kontrola niezmienników i rozmiaru bazy
│   └── migrations/
│       ├── 001_init.sql      schemat wyjściowy
│       └── 002_stock_balances.sql  ★ model odczytu + wyzwalacze
│
├── domain/                   reguły niezależne od bazy i HTTP
└── modules/<obszar>/
    ├── *.routes.js           trasy i uprawnienia
    └── *.service.js          reguły biznesowe, transakcje, unieważnianie
```

★ oznacza komponenty dodane w tej fazie.

### Odpowiedzialności warstwy odczytu

| Komponent | Odpowiada za | Nie odpowiada za |
|---|---|---|
| `lib/cache.js` | Przechowanie wyniku, unieważnianie po tagach, limit pamięci | Wiedzę, co jest w środku i kto pyta |
| `TAG` | Słownik obszarów danych | Mapowanie na punkty API |
| `invalidateDocument()` | Przełożenie zapisu na listę dotkniętych tagów | Moment wywołania |
| Serwis | Wywołanie po zatwierdzeniu transakcji | Wiedzę, które raporty czytają dane |
| `db/health.js` | Dowód, że model odczytu zgadza się z rejestrem | Naprawianie rozjazdu |

Serwis księgujący dokument nie wie, że istnieje raport miesięczny. Podbija
„stan magazynowy” i „miesiąc 2026-09”; wszystko, co od nich zależy, odpada samo.

---

## 4. Przepływ danych

### 4.1 Zapis dokumentu

```
POST /operations
   │
   ├─ uwierzytelnienie i uprawnienie operations:write
   ├─ walidacja (lib/validate.js)
   │
   ├─ TRANSAKCJA ─────────────────────────────────────────┐
   │    prepareRow()      produkt → ilości → magazyny      │
   │    assertDateAllowed()  reguła daty                   │
   │    assertPeriodOpen()   okres rozliczeniowy           │
   │    checkStock()         kontrola stanów ujemnych      │
   │    allocateDocNumber()  atomowy numer dokumentu       │
   │    INSERT operations                                  │
   │    INSERT stock_moves ──► WYZWALACZ ──► stock_balances│
   │    INSERT audit_log                                   │
   └────────────────────────────────────────── COMMIT ─────┘
   │
   ├─ invalidateDocument({ months, warehouseIds })
   │     └─ podbija: stock, documents, month:RRRR-MM,
   │                 warehouse:<id>, warehouse:*
   │                 oraz history, gdy data jest wsteczna
   │
   └─ odpowiedź 201 z gotowym dokumentem
```

Dwie rzeczy w tym przepływie są celowe i nieprzypadkowe:

**Saldo aktualizuje wyzwalacz, nie kod serwisu.** Wyzwalacz jest częścią bazy,
więc obowiązuje każdą ścieżkę zapisu — również import kopii zapasowej, generator
danych testowych i ręczne `INSERT` w konsoli. Ta sama reguła rozpisana po
serwisach obowiązywałaby tylko tych, którzy o niej pamiętają, a rozjazd sald
w systemie magazynowym jest usterką cichą i narastającą.

**Unieważnienie następuje PO zatwierdzeniu transakcji.** Unieważnienie
wcześniejsze pozwoliłoby równoległemu odczytowi wpisać z powrotem stan, którego
zapis jeszcze nie utrwalił. Unieważnienie nadmiarowe kosztuje jedno przeliczenie;
przedwczesne kosztuje błędną liczbę na ekranie.

### 4.2 Odczyt raportu

```
GET /reports/monthly?month=2026-09
   │
   ├─ uwierzytelnienie i uprawnienie reports:read   ← ZAWSZE przed pamięcią podręczną
   │
   ├─ onRequest: db.dataVersion() vs. ostatnia znana
   │     └─ różnica ⇒ ktoś pisał spoza procesu ⇒ czyszczenie całości
   │
   ├─ monthlyTags(query)
   │     ├─ okres ZAMKNIĘTY → [periods, settings, catalog:products, history, month:M]
   │     └─ okres OTWARTY   → [stock, documents, periods, settings,
   │                           catalog:products, month:M, warehouse:X]
   │
   ├─ cache.get(klucz)
   │     ├─ TRAFIENIE, generacje tagów zgodne → wynik   (~0,014 ms)
   │     └─ CHYBIENIE → 7 zapytań agregujących → zapis  (~50 ms)
   │
   └─ onResponse: recordRequest(metoda, wzorzec trasy, status, ms)
```

Kontrola uprawnień jest przed pamięcią podręczną, nie za nią. Buforujemy
wyłącznie odczyty, których wynik nie zależy od pytającego, więc klucz nie
zawiera użytkownika — i nie może go zawierać, dopóki ta zasada obowiązuje.

---

## 5. Projekt API

### 5.1 Zasady

| Zasada | Realizacja |
|---|---|
| Wersjonowanie | Wszystko pod `/api/v1`; zmiany łamiące → `/api/v2`, `v1` w okresie przejściowym |
| Kształt odpowiedzi | `{ items, page, totals }` dla list, obiekt wprost dla pojedynczego zasobu |
| Stronicowanie | `limit` (maks. 500) + `offset`; `page.total` liczone osobno |
| Błędy | `{ error: { code, message, details } }`, komunikat po polsku, gotowy do pokazania |
| Idempotencja | `GET` bez skutków ubocznych; numeracja dokumentu atomowa (`ON CONFLICT … RETURNING`) |
| Buforowanie po stronie klienta | Pliki aplikacji: `ETag` + `304`. Dane: `no-store` |

### 5.2 Dlaczego dane nie mają ETagu

Świadoma decyzja, nie przeoczenie. `ETag` na odpowiedziach z danymi wymagałby
`Cache-Control` pozwalającego przeglądarce przechować treść, żeby mogła ją
później zrewalidować. Na współdzielonym terminalu w magazynie oznacza to
rejestr dokumentów i stany w pamięci podręcznej dysku, dostępne po wylogowaniu.

Zysk byłby niewielki: w sieci lokalnej przesłanie 40 kB trwa poniżej milisekundy,
a prawdziwym kosztem było PRZELICZANIE odpowiedzi — i to usuwa pamięć podręczna
serwera. Płacenie za milisekundę transferu danymi handlowymi na cudzym dysku
jest złym kursem wymiany.

Pliki samej aplikacji to inna sprawa: to publiczny kod, nie dane. Tam żądanie
warunkowe działa i oszczędza około trzydziestu pobrań przy każdym wejściu —
zauważalnie przy pracy z telefonu w terenie.

### 5.3 Nowy punkt: diagnostyka

```http
GET /api/v1/metrics        (uprawnienie settings:read)
```

```json
{
  "uptimeSec": 86400,
  "requests": 15234,
  "errors": 0,
  "routes": [
    { "route": "GET /api/v1/reports/monthly", "count": 412, "avgMs": 1.2, "maxMs": 58.1, "errors": 0 }
  ],
  "cache": { "entries": 84, "hitRate": 0.988, "hits": 1201, "misses": 14, "stale": 3 },
  "database": {
    "operations": 18544, "moves": 18544, "balances": 6, "months": 63,
    "sizeMb": 41.2, "readModelSpeedup": 3091,
    "balancesConsistent": true, "nearingLimits": false
  }
}
```

Punkt istnieje po to, żeby „system działa wolno” dało się zamienić w zdanie
sprawdzalne: która trasa, jak długo, czy pamięć podręczna pomaga i czy model
odczytu nadal zgadza się z rejestrem ruchów.

---

## 6. Schemat bazy

### 6.1 Model zapisu (bez zmian)

Stan magazynu jest sumą tabeli `stock_moves` i niczym więcej. Nie ma
modyfikowalnego pola „stan” — takie pole rozjeżdża się z historią przy pierwszym
przerwanym zapisie, a w systemie podlegającym audytowi to defekt nie do obrony.

### 6.2 Model odczytu (migracja 002)

```sql
CREATE TABLE stock_balances (
  warehouse_id   TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  product_id     TEXT NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
  qty_mp, qty_m3, qty_tonne, energy_gj, value  REAL NOT NULL DEFAULT 0,
  moves          INTEGER NOT NULL DEFAULT 0,
  last_move_date TEXT,
  PRIMARY KEY (warehouse_id, product_id)
);
```

Utrzymywana trzema wyzwalaczami:

| Wyzwalacz | Działanie | Uzasadnienie |
|---|---|---|
| `AFTER INSERT` | Dodaje wartości ruchu do salda pary | Księgowanie dokumentu |
| `AFTER DELETE` | Odejmuje; przelicza `last_move_date`; usuwa saldo bez ruchów | Storno i przywrócenie korekty |
| `BEFORE UPDATE` | `RAISE(ABORT)` | Ruch jest faktem — powstaje i znika, nie zmienia się |

Zakaz aktualizacji nie jest ograniczeniem, tylko zapisaniem reguły, która i tak
obowiązywała: cały system koryguje dokumenty przez usunięcie i ponowne
utworzenie ruchów. Zapisany wprost pozwala utrzymać saldo dwoma prostymi
wyzwalaczami zamiast trzeciego, który musiałby rozbierać zmianę klucza na
odjęcie po staremu i dodanie po nowemu.

**Niezmiennik**, sprawdzany testem po każdej operacji i dostępny w `/metrics`:

```
dla każdej pary (magazyn, produkt):
    stock_balances.qty_* = SUM(stock_moves.qty_*)
    stock_balances.moves = COUNT(stock_moves)
```

Na bazie pięcioletniej: 18 544 ruchy zwijają się do **6 wierszy sald**.
Odczyt stanu przestaje przeglądać historię.

### 6.3 Indeksy i statystyki planisty

Migracja 002 dodaje `ix_operations_status_date(status, operation_date DESC,
created_at DESC)` — lista dokumentów otwiera się z filtrem statusu i sortowaniem
po dacie, a dotychczasowe indeksy zaczynały się od innych kolumn, więc `COUNT(*)`
i pierwsza strona przeglądały cały rejestr.

Migracja kończy się `ANALYZE`, i to nie jest kosmetyka. **Nowy indeks bez
świeżych statystyk potrafi pogorszyć wynik** — planista wybiera go na podstawie
nieaktualnego rozkładu danych. Zmierzone na tej właśnie migracji:

| Odczyt | Statystyki nieaktualne | Po `ANALYZE` |
|---|---|---|
| Raport miesięczny | 43,4 ms | 26,3 ms |
| Pulpit | 24,9 ms | 8,0 ms |

Dlatego `PRAGMA optimize` uruchamia się co sześć godzin i przy zamykaniu
procesu: rozkład danych zmienia się z każdym miesiącem pracy, a plan dobrany
do bazy sprzed roku bywa gorszy niż brak indeksu.

---

## 7. Strategia buforowania

### 7.1 Zasada nadrzędna: poprawność przed trafieniami

Wpis nie wygasa po czasie, tylko po **zdarzeniu**. Czas życia (2 minuty) jest
wyłącznie zabezpieczeniem na wypadek tagu, o którym ktoś zapomniał.

### 7.2 Mechanizm: generacje tagów

Każdy tag ma licznik. Wpis zapamiętuje generacje swoich tagów w chwili zapisu
i jest ważny, dopóki wszystkie się zgadzają. Zapis podbija liczniki dotkniętych
tagów — kosztem stałym, bez przeglądania zawartości.

```js
cache.wrap(
  keyFor('reports.monthly', { month: '2026-09' }),
  { tags: ['stock', 'documents', 'month:2026-09', 'warehouse:*'] },
  () => computeMonthlyReport(...),
);
```

### 7.3 Słownik tagów

| Tag | Znaczenie | Podbijany przez |
|---|---|---|
| `stock` | Ruchy magazynowe | Każdy zapis dokumentu |
| `documents` | Rejestr dokumentów | Każdy zapis dokumentu |
| `month:RRRR-MM` | Konkretny miesiąc | Zapis w tym miesiącu |
| `warehouse:<id>` | Konkretny magazyn | Zapis dotykający magazynu |
| `warehouse:*` | Odczyt bez filtra magazynu | Każdy zapis dokumentu |
| `history` | Księgowanie wstecz | Zapis w miesiącu wcześniejszym niż bieżący |
| `catalog:<tabela>` | Pojedyncza kartoteka | Zapis w tej kartotece |
| `catalog` | Dowolna kartoteka | Zapis w dowolnej kartotece |
| `settings`, `periods`, `users` | Odpowiednie obszary | Zapisy w nich |

### 7.4 Dlaczego tagi musiały być tak drobne

Pierwsza wersja miała jeden tag `catalog` i tag `warehouse:*` na każdym raporcie.
Pomiar pokazał, że **zaksięgowanie zrębki we wrześniu 2026 unieważniało raport
za lipiec 2021** — z dwóch niezależnych powodów naraz:

1. Nowy dostawca podbijał `catalog`, a raport zależał od kartoteki *produktów*,
   nie kontrahentów. Rozwiązanie: tag na kartotekę, nie na wszystkie naraz.
2. Raport bez filtra magazynu miał `warehouse:*`, który podbija każdy zapis.
   Rozwiązanie: raport zamkniętego miesiąca nie potrzebuje tagów magazynu —
   do zamkniętego okresu nie da się nic dopisać.

To prowadzi do najciekawszej reguły w całej strategii.

### 7.5 Zamknięty okres jako granica niezmienności

Raport zamkniętego miesiąca zależy od zupełnie innych rzeczy niż raport miesiąca
otwartego, bo do zamkniętego okresu nie da się nic zaksięgować:

```js
function monthlyTags(q) {
  if (periodStatus(q.month) === 'CLOSED') {
    return ['periods', 'settings', 'catalog:products', 'history', `month:${q.month}`];
  }
  return [...LEDGER_TAGS, `month:${q.month}`, `warehouse:${q.warehouseId ?? '*'}`];
}
```

Zamknięty raport przeżywa więc całą bieżącą pracę magazynu. Zmienić go może
tylko otwarcie okresu, zmiana nazwy produktu albo księgowanie wstecz w miesiącu,
który nigdy nie został zamknięty — i ten ostatni, rzadki ale realny przypadek
łapie tag `history`.

Zysk jest tam, gdzie potrzebny: audytor przeglądający czterdzieści miesięcy
zamkniętych raportów nie traci ich przy każdym przyjęciu towaru na placu.

### 7.6 Trzy warstwy ochrony przed nieaktualnością

| Warstwa | Chroni przed | Koszt |
|---|---|---|
| Generacje tagów | Zapisem przez aplikację | Stały, przy zapisie |
| Czas życia (2 min) | Tagiem, o którym zapomniano | Zero |
| `PRAGMA data_version` | Zapisem spoza procesu | Jedno pragma na żądanie |

Trzecia warstwa zasługuje na wyjaśnienie. SQLite podbija `data_version`
wyłącznie wtedy, gdy dane zmieniło **inne połączenie**: przywrócenie kopii
zapasowej z konsoli, skrypt konserwacyjny, druga instancja serwera wskazana na
ten sam plik. Bez tego sprawdzenia pamięć podręczna przeżyłaby przywrócenie
kopii i podawała dane sprzed niego — cicho i bez końca.

### 7.7 Czego nie buforujemy

| Odczyt | Powód |
|---|---|
| Pojedynczy dokument (`GET /operations/:id`) | Otwierany raz, tuż po zapisie; klucz na każdy dokument zapchałby limit |
| Stan magazynowy bieżący | Model odczytu daje 0,1 ms — buforowanie nic nie wnosi |
| Dziennik audytu, sesje, załączniki | Odczyty rzadkie albo zależne od użytkownika |
| Cokolwiek zależnego od pytającego | Zasada: klucz nie zawiera użytkownika |

---

## 8. Wyniki pomiarów

Baza pięcioletnia: 18 544 dokumenty, 18 544 ruchy, 63 miesiące.

### 8.1 Model odczytu i indeksy (bez pamięci podręcznej)

| Odczyt | Przed | Po | Zysk |
|---|---:|---:|---:|
| Stan magazynowy | 13,7 ms | 0,1 ms | **137×** |
| Pulpit | 43,1 ms | 8,0 ms | 5,4× |
| Lista dokumentów, strona 1 | 26,1 ms | 8,8 ms | 3,0× |
| Wyszukiwanie w rejestrze | 39,6 ms | 25,3 ms | 1,6× |
| Raport miesięczny | 27,6 ms | 26,3 ms | — |

### 8.2 Pamięć podręczna (odczyt powtórzony)

| Odczyt | Chybienie | Trafienie | Zysk |
|---|---:|---:|---:|
| Raport miesięczny | 50,5 ms | 0,013 ms | 3 917× |
| Wyszukiwanie | 39,3 ms | 0,015 ms | 2 584× |
| Pulpit | 18,7 ms | 0,010 ms | 1 830× |
| Kartoteka produktu | 15,1 ms | 0,012 ms | 1 224× |
| Lista dokumentów | 14,7 ms | 0,016 ms | 945× |
| **Pełny obieg ekranu** | **141,7 ms** | **0,15 ms** | **943×** |

Skuteczność trafień w symulacji typowej pracy: **98,9%**.

### 8.3 Żądania warunkowe na plikach aplikacji

| Wejście do aplikacji | Plików | Pobrane |
|---|---:|---:|
| Pierwsze | 24 | 192 kB |
| Kolejne (`304 Not Modified`) | 24 | **0 B** |

### 8.4 Poprawność

| Sprawdzenie | Wynik |
|---|---|
| Stan magazynowy odświeżony po zapisie | zgodne |
| Lista dokumentów odświeżona po zapisie | zgodne |
| Pulpit odświeżony po zapisie | zgodne |
| Raport zamkniętego miesiąca **nie** przeliczony | zgodne |
| Storno przywróciło stan | zgodne |
| Saldo zgodne z rejestrem ruchów | zgodne |

---

## 9. Drabina skalowania

| Etap | Granica | Co zaczyna boleć | Dźwignia | Koszt wdrożenia |
|---|---|---|---|---|
| **S1** wyjściowy | ~50 tys. dokumentów, 5 użytkowników | Stan magazynowy przegląda historię | — | — |
| **S2** obecny | ~500 tys. dokumentów, 20 użytkowników | Wyszukiwanie pełnotekstowe | model odczytu + pamięć podręczna + indeksy | wdrożone |
| **S3** | ~2 mln dokumentów | Zapis blokuje odczyt przy imporcie masowym | FTS5 · PostgreSQL · kilka procesów | 2–4 tygodnie |
| **S4** | wiele lokalizacji | Jeden proces to pojedynczy punkt awarii | repliki odczytu · Redis · wielodostępność | 1–2 miesiące |

### Kiedy przejść do S3

`GET /metrics` odpowiada wprost: pole `nearingLimits` zapala się przy 500 tys.
ruchów albo 2 GB bazy. Wcześniejszym sygnałem jest `avgMs` wyszukiwania powyżej
100 ms w `routes`.

### Co trzeba będzie zrobić w S3

**Wyszukiwanie pełnotekstowe (FTS5).** Rejestr przeszukuje dziewięć kolumn
przez `LIKE '%fraza%'`, czego żaden indeks B-drzewa nie obsłuży. Przy 18 tys.
dokumentów to 25 ms, przy 100 tys. będzie około 140 ms. SQLite w Node 22 ma
FTS5 skompilowane, więc rozwiązanie jest w zasięgu — świadomie odłożone,
bo dokłada zależność od możliwości środowiska uruchomieniowego do produktu,
który celowo nie ma żadnych zależności, a wyszukiwanie jest działaniem
świadomym (naciśnięcie Enter), nie kosztem wczytania ekranu.

**PostgreSQL.** Cały dostęp do bazy przechodzi przez `db/index.js` i używa
przenośnego SQL. Zmiany wymagają: sterownika, składni upsert dla numeracji
dokumentów, wyzwalaczy sald w PL/pgSQL. Reszta kodu pozostaje bez zmian.

**Kilka procesów.** Pamięć podręczna w procesie przestaje wtedy być spójna.
Interfejs (`get` / `set` / `wrap` / `bump`) jest dobrany tak, żeby podmiana
implementacji na wspólny magazyn (Redis) nie sięgnęła serwisów — zmienia się
`lib/cache.js`, nie dwadzieścia miejsc wywołań.

### Czego świadomie NIE robimy teraz

| Pomysł | Dlaczego nie |
|---|---|
| Materializacja stanu na każdy dzień | „Stan na dzień” to rzadkie, świadome zapytanie; 12 ms wystarcza, a tabela rosłaby liniowo z czasem |
| Pamięć podręczna pojedynczych dokumentów | Otwierane raz; zapchałyby limit, wypierając raporty, które naprawdę się powtarzają |
| Rozdzielenie odczytu i zapisu (CQRS) | Model odczytu daje ten sam zysk bez drugiej bazy i bez opóźnienia synchronizacji |
| Kolejka zadań w tle | Nie ma operacji dłuższych niż 60 ms; kolejka dołożyłaby stan, którego nie ma po co pilnować |

---

## 10. Utrzymanie

| Zadanie | Kiedy | Kto uruchamia |
|---|---|---|
| `PRAGMA optimize` | Co 6 godzin i przy zamykaniu | Automatycznie (`index.js`) |
| Kopia zapasowa bazy | Raz na dobę | Automatycznie (`index.js`) |
| Sprzątanie wygasłych sesji | Raz na dobę | Automatycznie (`index.js`) |
| Kontrola `balancesConsistent` | Po awarii zasilania, przed audytem | `GET /metrics` |
| Zamykanie okresów | Po rozliczeniu miesiąca | Kierownik — zamknięte miesiące zwalniają pamięć podręczną z ciągłego przeliczania |

Ostatni wiersz ma znaczenie wydajnościowe, nie tylko księgowe: zamknięcie
miesiąca sprawia, że jego raport przestaje być unieważniany bieżącą pracą.
Firma zamykająca okresy na czas dostaje szybszy system.

---

## Powiązane dokumenty

| Dokument | Zakres |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Architektura wyjściowa i decyzje projektowe |
| [DATABASE.md](DATABASE.md) | Schemat, indeksy, migracja na PostgreSQL |
| [API.md](API.md) | Punkty końcowe i uprawnienia |
| [REFACTORING.md](REFACTORING.md) | Przegląd kodu i strategie refaktoryzacji |
| [DEBUGGING.md](DEBUGGING.md) | Usterki produkcyjne i ich przyczyny źródłowe |

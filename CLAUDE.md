# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Czym jest ten projekt

**ResInvest ERP** — system magazynowy biomasy drzewnej dla firmy ResInvest Commodities
(Pyskowice/Zabrze). Obsługuje dokumenty PZ/WZ/PW/RW/MM/BO, produkcję zrębki, raporty
miesięczne, korekty, okresy księgowe, import/eksport CSV i kopie zapasowe.

Wdrożenie docelowe: **komputer w firmie**, uruchamiany z pakietu `.ZIP`
(`ResInvestERP.exe` na Windows). Nie jest to usługa chmurowa.

## Język projektu

**Cały projekt jest po polsku i ma taki pozostać**: komentarze w kodzie, komunikaty
błędów, nazwy w interfejsie, dokumentacja, opisy commitów. Identyfikatory w kodzie są
angielskie (`createOperation`, `qtyMp`), ale wszystko, co czyta człowiek — po polsku.
Komentarze wyjaśniają **dlaczego**, nie **co**.

---

## Polecenia

```bash
npm start                  # serwer produkcyjny (domyślnie 127.0.0.1:4173)
npm run dev                # serwer z przeładowaniem (--watch)
npm run migrate            # migracje SQL z server/src/db/migrations/
npm run seed               # dopisuje dane demonstracyjne
npm run seed:reset         # czyści rejestr i generuje od nowa
npm run user:create        # konto użytkownika z wiersza poleceń
npm run backup             # kopia zapasowa bazy
npm test                   # 119 testów (node:test)
npm run check              # składnia serwera + zgodność importów frontu
npm run build:installer    # ikona .ico + pakiet dist/ResInvest-ERP-<wersja>.zip
npm run build:html         # wersja jednoplikowa → dist/ResInvestERP.html
npm run vendor:fonts       # ponowne pobranie krojów do web/assets/fonts/
```

**Pojedynczy plik testowy albo pojedynczy test:**

```bash
node --test server/tests/operations.test.mjs
node --test --test-name-pattern "bilans miesiąca" server/tests/operations.test.mjs
```

**Uruchomienie na osobnej bazie** (do prób, nie ruszając `data/resinvest.db`):

```bash
DB_FILE=/tmp/proba.db PORT=4599 npm start
```

Konfiguracja idzie z `.env` (wzór w `.env.example`), a zmienne środowiskowe mają
pierwszeństwo. Kluczowe: `DB_FILE`, `PORT`, `AUTH_SECRET`, `ATTACHMENTS_DIR`,
`BACKUP_DIR`, `LOG_LEVEL`.

---

## Twarde ograniczenia

1. **Zero zależności produkcyjnych z npm.** Serwer stoi wyłącznie na module
   standardowym Node 22: `node:http`, `node:sqlite`, `node:crypto`, `node:zlib`,
   `node:test`. Front nie ma kroku budowania — przeglądarka ładuje moduły ESM wprost.
   Powód: pakiet instaluje się na komputerze bez dostępu do rejestru npm.
   **Nie dodawaj zależności**, dopisz brakującą funkcję do `server/src/lib/`.
2. **Zero odwołań do sieci w czasie pracy.** Ta sama zasada po stronie klienta:
   żadnego CDN-u, czcionek z Google, skryptów ani obrazów z zewnątrz. Wszystko,
   czego potrzebuje przeglądarka, leży w repozytorium (kroje w `web/assets/fonts/`
   — SIL OFL 1.1, wendorowane przez `npm run vendor:fonts`).
   Wagi pośrednie `650`/`680` w arkuszu **muszą** zaokrąglać się do 700 — dlatego
   Inter, mimo że jest krojem zmiennym, ma **pięć reguł `@font-face` po jednej
   wadze**, a nie jedną z zakresem. Szczegóły: `web/assets/fonts/README.md`.
3. **SQL ma zostać przenośny.** Baza to SQLite (WAL), ale zapytania mają przejść na
   PostgreSQL bez przepisywania — bez `sqlite_*`, bez `rowid` w logice domenowej.
4. **Historia jest niezmienna.** Przeliczniki użyte przy księgowaniu zapisują się
   w dokumencie (kolumny `factor_*`). Zmiana ustawień nigdy nie przelicza dokumentów
   już zaksięgowanych.

---

## Architektura — rzeczy, których nie widać z jednego pliku

### Model księgi: stan magazynu to suma ruchów

Nie ma kolumny „stan”. `stock_moves` jest księgą tylko do dopisywania i usuwania:

* dokument tworzy ruchy (`domain/stock.js` → `deriveMoves`),
* **korekta** usuwa stare ruchy i wstawia nowe,
* **storno** usuwa ruchy, zostawiając dokument w rejestrze ze statusem `CANCELLED`,
* wyzwalacz `tr_stock_moves_no_update` **odrzuca każdy UPDATE** na ruchu.

Nigdy nie modyfikuj wiersza w `stock_moves`. Usuń i wstaw ponownie.

### Model odczytu: `stock_balances` utrzymują wyzwalacze bazy, nie kod

Tabela sald jest aktualizowana przez wyzwalacze `AFTER INSERT` / `AFTER DELETE`
w `002_stock_balances.sql`. To celowe: gdyby robił to kod serwisu, każda nowa ścieżka
zapisu byłaby okazją do zapomnienia. `checkStockBalances()` w `server/src/db/health.js`
porównuje model odczytu z księgą — testy to sprawdzają.

### Pamięć podręczna: unieważnianie po tagach, obowiązkowe przy każdym zapisie

`server/src/lib/cache.js` trzyma wyniki raportów i list z przypisanymi tagami
(`TAG.STOCK`, `TAG.month('2026-09')`, `TAG.catalog('products')` …). Wpis pamięta
**pokolenie** każdego swojego tagu; zapis podbija licznik i unieważnia wszystko naraz,
w czasie stałym.

**Każda ścieżka zapisu musi wołać `invalidateDocument({month, months, warehouseIds})`.**
Pominięcie tego to najgroźniejszy możliwy błąd w tym projekcie — użytkownik zobaczy
nieaktualny stan magazynu i nie będzie miał jak się zorientować.

Dodatkowo `syncCacheWithDatabase()` (w `app.js`, na każde żądanie) porównuje
`PRAGMA data_version` i czyści wszystko, gdy bazę zmienił ktoś spoza procesu
(przywrócenie kopii, skrypt konserwacyjny).

Raporty zamkniętych miesięcy mają **węższy** zestaw tagów (`monthlyTags` w
`reports.service.js`) — do zapieczętowanego okresu nic nie wejdzie, więc zwykłe
księgowanie nie ma prawa go unieważniać.

### Rejestr pól dokumentu — jedno źródło prawdy

`server/src/domain/operation-fields.js` opisuje każde pole dokumentu raz: nazwa
w API, kolumna w bazie, etykieta po polsku, reguła walidacji, czy to kwota.
Z tego jednego rejestru wyprowadzają się schemat walidacji, lista kolumn INSERT-a,
mapowanie wiersza na API i etykiety w historii korekt.

**Dodanie pola do dokumentu = edycja tego jednego pliku.** Jeśli łapiesz się na
dopisywaniu nazwy pola w drugim miejscu, coś poszło nie tak.

### Dziennik audytu — porównanie stanów, nie lista pól

`auditChange()` z `middleware/audit.js` zapisuje **wartość przed i po**
(`{pole: {przed, po}}`), pomijając pola przysłane bez zmiany. Zapis robi
**warstwa serwisowa**, nie trasa — fabryka `createCatalog` audytuje każdą
kartotekę sama, więc nowa kartoteka nie może wypaść z dziennika przez
przeoczenie w trasie (pojazdy i nadleśnictwa wypadły dokładnie tak).

Kontekst żądania (`ctx`) przekazuj w głąb aż do miejsc zakładających pozycje
„przy okazji” dokumentu (`ensure`, `ensureDictionaries`) — taka pozycja ma
mieć w dzienniku autora.

**Skrót hasła nie ma prawa trafić do dziennika.** Notowany jest sam fakt zmiany
(`haslo: poprzednie → nowe`) i musi siedzieć **wewnątrz** porównania stanów:
wpis bez żadnej zmiany jest pomijany, więc dopisek obok zniknąłby razem z nim.

### Historia zmian i wydruki

Widok `web/src/views/history.js` (`#/historia`, uprawnienie `audit:read`)
pokazuje cały dziennik z porównaniem przed/po. **Etykiety pól przychodzą
z serwera** — `listAudit` rozwija `zmiany` w `changes: [{field, label,
before, after}]`, a `label` bierze się z `domain/field-labels.js`, zasilanego
schematami walidacji. Widok nie ma własnego słownika nazw pól i mieć nie ma.

`audit:read` jest osobne od `users:read`: historię czytają audytor
i księgowość, które kartoteki kont nie widzą.

Pięć wydruków (historia, rejestr, dokument, stany, kwit produkcji) używa
`printHeader()` z `core/ui.js` — bloku widocznego **wyłącznie** na papierze,
z nazwą firmy, zakresem opisanym słowami, datą i autorem wydruku.
Dokładając szósty wydruk, dołóż i główkę: kartka bez niej to anonimowa tabela
liczb. Szczegóły: `docs/FRONTEND.md`, punkty 4.4 i 4.5.

### Warstwa dostępu do bazy

`server/src/db/index.js` eksportuje fasadę `db.all / get / value / run / tx / exec`.
Dwie rzeczy nieoczywiste:

* **`node:sqlite` odrzuca nieużyte parametry nazwane.** Fasada sama skanuje SQL
  (po usunięciu literałów tekstowych) i odsiewa nadmiarowe klucze — dlatego można
  swobodnie przekazywać cały obiekt filtrów.
* **`db.tx()` zagnieżdża się** przez SAVEPOINT, więc serwisy komponują się bez
  wiedzy o kontekście wywołania.

Do wyszukiwarek używaj `likePattern(text)` + stałej `LIKE_ESCAPE` — surowy tekst
użytkownika w `LIKE` wpuszcza metaznaki `%` i `_` (naprawiona usterka B4).

### Warstwa HTTP

`server/src/lib/http.js` to własny router i serwer. Trasa wygląda tak:

```js
r.get('/reports/dashboard', ...guard('reports:read'), (ctx) => reports.dashboard(ctx.query));
```

`guard(permission)` z `middleware/auth.js` składa uwierzytelnienie (JWT) i RBAC.
Role: `ADMIN`, `KIEROWNIK`, `MAGAZYNIER`, `KSIEGOWY`, `AUDYTOR`. Uchwyt zwraca
obiekt — serializacja, ETag i kody błędów są wspólne.

### Wielu użytkowników: blokada optymistyczna na dokumencie

Kolizja edycji nie dzieje się w bazie (jeden proces, synchroniczny sterownik),
tylko **między otwarciem formularza a jego wysłaniem** — czyli w minutach.
Formularz odsyła komplet pól z migawki, więc bez kontroli zapis drugiej osoby
cicho cofa poprawkę pierwszej i wygląda na jej świadomą decyzję.

Dlatego `PATCH /operations/:id` **wymaga** pola `revision`, a
`assertNotStale()` odrzuca zapis z 409, podając kto i kiedy zmienił dokument.
Wywołania wewnętrzne rewizji nie podają — czytają stan świeżo w tej samej
transakcji. Dokładając kolejny formularz edytujący byt, który może ruszyć
ktoś inny, dołóż i tę blokadę.

Numeracja dokumentów jest atomowa (`INSERT … ON CONFLICT DO UPDATE …
RETURNING` w `domain/documents.js`). Nie przepisuj tego na „odczytaj, dodaj
jeden, zapisz” — testy w `concurrency-processes.test.mjs` uruchamiają cztery
procesy piszące do jednej bazy właśnie po to, żeby to złapać.

### Okresy księgowe

`periods.service.js` → `assertPeriodOpen(month)`; kontrola daty księgowania siedzi
osobno, w `operations.service.js` → `assertDateAllowed(date, user)`.
Zamknięty miesiąc blokuje zapisy i usuwanie załączników. `backdate_days` z ustawień
ogranicza księgowanie wstecz i **czytane jest dosłownie** (0 = tylko dzisiaj).
Data z przyszłości jest odrzucana dla każdej roli, z tolerancją jednego dnia
(kierowca wraca po północy).

### Front bez kroku budowania

`web/src/` ładuje się jako moduły ESM wprost z dysku. Konwencje:

* widoki budują HTML jako tekst; **każda wartość przechodzi przez `esc()`**,
* interaktywność przez delegację zdarzeń po `data-*` (`on()` z `core/dom.js`);
  wiązanie jest **idempotentne** — para typ+selektor ma na kontenerze jeden
  uchwyt, więc widok może wołać `on()` przy każdym renderze i nie sprząta po
  sobie (router woła `detachAll()` przy zmianie widoku),
* router hash-owy (`#/operacje/123?tab=x`) — działa z podkatalogu i zza proxy,
* widok trzyma instancję komponentu w zmiennej modułu i woła `destroy()` na starcie
  kolejnego renderu (wzorzec z `views/operations.js`),
* `ui/DataTable.js` opisuje kolumnę **raz** i renderuje **wyłącznie** wariant pasujący
  do szerokości ekranu — nie ma osobnego szablonu karty mobilnej.

### Warstwa wykresów — kolor jest policzalny

`web/src/ui/charts/` + `web/assets/viz.css`. Paleta w `viz.css` nie jest dobrana
wzrokiem: przeszła walidator sześciu kontroli (pasmo jasności, próg chromy,
rozdzielność przy protanopii i deuteranopii, próg dla widzenia pełnego, kontrast)
w trybie jasnym i ciemnym.

**Zmiana choćby jednego slotu wymaga ponownej walidacji obu trybów** — sloty są
dobrane parami, nie pojedynczo. Procedura, wyniki i dokładna sekwencja tworzenia:
`docs/DESIGN-SYSTEM.md`.

Nowy wykres dostarcza wyłącznie geometrię (`layout(width)`, `render(box)`); karta,
legenda, kursor, klawiatura, widok tabelaryczny i przerysowanie przychodzą
z `chart-core.js`. `tooltip()` i `table()` są obowiązkowe — żadna wartość nie może
być dostępna tylko pod kursorem.

---

## Testy

`server/tests/helpers.mjs` → **`prepareEnv(nazwa)` musi być wywołane przed pierwszym
importem modułów aplikacji** (konfiguracja czyta środowisko przy imporcie). Stąd
wzorzec z dynamicznym `await import(...)` na górze każdego pliku testowego:

```js
prepareEnv('operations');
const { default: db } = await import('../src/db/index.js');
```

Każdy plik testowy dostaje własną bazę w katalogu tymczasowym.
`operationInput(overrides)` daje poprawny dokument do księgowania — uważaj na `unit`,
domyślnie `M3`, więc ilość zostanie przemnożona przez przelicznik.

Seed jest **powtarzalny**: generator liczb losowych ma stałe ziarno, więc ten sam
plik wejściowy uruchomiony **tego samego dnia** daje zawsze ten sam komplet
dokumentów co do grosza. Liczba dokumentów zależy od daty uruchomienia (historia
sięga 60 dni wstecz, a soboty i niedziele wypadają inaczej), więc nie porównuj jej
między dniami — porównuj dwa przebiegi z tego samego dnia. Różnica między nimi
oznacza regresję w silniku.

Testów przeglądarkowych nie ma w repozytorium — pisz je doraźnie w katalogu
roboczym sesji (Playwright, `executablePath: '/opt/pw-browsers/chromium'`), uruchamiając
serwer na osobnej bazie i osobnym porcie.

---

## Wersja jednoplikowa

`dist/ResInvestERP.html` to cały system w jednym pliku — otwierany podwójnym
kliknięciem, bez instalacji i bez sieci. Zasada, której **nie wolno naruszyć**:
wersja jednoplikowa wykonuje **ten sam kod serwera**, tylko na SQLite
skompilowanym do WebAssembly (`standalone/vendor/`, MIT). Nie ma drugiego
silnika i nie ma go być — dwa silniki liczące te same salda rozjeżdżają się,
a w systemie magazynowym oznacza to dwa różne stany magazynu.

Podmieniane jest sześć plików i moduł `node:fs` — tabela `SUBSTITUTIONS`
w `standalone/build.mjs`. Dodając cokolwiek do tej tabeli, zapytaj najpierw,
czy różnica naprawdę wynika ze środowiska, czy tylko z wygody.

Po każdej zmianie w silniku albo w warstwie zastępczej:

```bash
npm run build:html && node standalone/verify.mjs
```

`verify.mjs` generuje te same dane po obu stronach i porównuje liczby co do
grosza. Rozjazd jest błędem blokującym.

Pułapka sterownika: **`Database.export()` w sql.js zwalnia wszystkie
przygotowane instrukcje**, więc bufor instrukcji trzeba porzucić po każdym
zrzucie bazy (`forgetStatements` w `standalone/src/runtime/db.js`). Bez tego
zapytanie potrafi cicho zwrócić cudzy wynik.

Szczegóły: `docs/STANDALONE.md`.

---

## Dokumentacja

| Plik | Zawartość |
|---|---|
| `README.md` | instalacja, role, jak system liczy, konfiguracja |
| `docs/ARCHITECTURE.md` | decyzje projektowe i kierunki rozwoju |
| `docs/DATABASE.md` | schemat, indeksy, migracja na PostgreSQL |
| `docs/API.md` | punkty końcowe i macierz uprawnień |
| `docs/SCALING.md` | model odczytu, buforowanie, drabina S1–S4 |
| `docs/DEBUGGING.md` | usterki produkcyjne: przyczyny źródłowe i poprawki |
| `docs/FRONTEND.md` | wydajność klienta, komponenty, launcher Windows |
| `docs/DESIGN-SYSTEM.md` | paleta z walidacją, układ pulpitu, styl wykresów |
| `docs/STANDALONE.md` | wersja jednoplikowa: podmianki, dane w przeglądarce, ograniczenia |
| `docs/UI.md`, `docs/DEPLOYMENT.md`, `docs/REFACTORING.md` | interfejs, wdrożenie, przegląd kodu |

Zmiana architektury albo naprawa usterki produkcyjnej **trafia do odpowiedniego
dokumentu w tym samym commicie**.

---

## Gałąź robocza

Prace idą na `claude/fullstack-app-architecture-mvp-ivrdst`. Nie wypychaj na inną
gałąź bez wyraźnej zgody i nie zakładaj pull requesta, jeśli nikt o niego nie prosił.

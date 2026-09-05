# Przegląd kodu i refaktoryzacja

Dokument z przeglądu przeprowadzonego na kodzie ResInvest ERP: co system robi,
gdzie leżały problemy, co zostało zmienione i co zmierzono przed i po.

**Zasada nadrzędna: funkcjonalność bez zmian, jakość wyżej.** Wyjątkiem są trzy
błędy opisane w rozdziale 4 — tam zmiana zachowania jest celem, bo poprzednie
było nieprawidłowe.

---

## 1. Podsumowanie architektury

### Co system robi

Obsługuje obrót biomasą leśną: zakup drewna od nadleśnictw, przerób na zrębkę
w lesie, magazynowanie i sprzedaż do elektrowni — wraz z dokumentacją wymaganą
przy certyfikacji KZR INiG / SURE.

### Przepływ danych

```
  przeglądarka (SPA, moduły ES)
        │  fetch + JWT
        ▼
  lib/http.js  ──►  middleware (auth · RBAC · audyt · limity)
        │
        ▼
  modules/*/routes.js         mapowanie HTTP, kontrola uprawnień
        │
        ▼
  modules/*/service.js        reguły biznesowe, transakcje
        │
        ├──►  domain/         czysta logika: jednostki, numeracja, ruchy
        │
        ▼
  db/index.js  ──►  SQLite (WAL)
```

Zależności biegną w jedną stronę. Weryfikacja narzędziowa: **0 cykli importów**
w 34 plikach serwera.

### Trzy filary modelu danych

| Filar | Konsekwencja |
|---|---|
| Stan magazynu = `SUM(stock_moves)` | Rozjazd stanu niemożliwy; stan na dowolny dzień tym samym zapytaniem |
| Dokument pamięta użyte przeliczniki | Zmiana ustawień nie przepisuje historii |
| Dokumenty nieusuwalne (storno + korekty) | Pełna ścieżka audytu |

Te trzy decyzje oceniam jako trafne i nie były ruszane.

---

## 2. Obszary problemowe

Ustalone przez odczyt kodu i pomiar — nie z wrażenia.

### 2.1 Problemy strukturalne

**S1. Opis pola dokumentu rozsypany po pięciu strukturach** *(największe ryzyko)*

`operations.service.js` (742 linie) trzymał ten sam zestaw pól w pięciu
równoległych miejscach: schemacie walidacji, mapie etykiet, liście kolumn
INSERT-a, mapowaniu na API i mapowaniu odwrotnym.

Pomiar — ile wystąpień jednego pola trzeba spójnie zmienić:

```
haulage_note_no   → 7 wystąpień w operations.service.js
chipping_price    → 8 wystąpień
carrier_name      → 10 wystąpień
```

Dodanie kolumny to było **do dziesięciu zmian w jednym pliku**, plus migracja,
plus kolumny CSV. Pominięcie którejkolwiek nie wywoływało błędu — pole po prostu
cicho nie zapisywało się albo nie wracało w API.

**S2. Czterokrotnie powtórzony cykl życia kartoteki**

`catalog.service.js` (507 linii): magazyny, produkty, kontrahenci i pojazdy
miały osobne, niemal identyczne `list/get/create/update/ensure`, każde z własnym
mapowaniem i własną listą kolumn INSERT-a.

**S3. `prepareRow` — funkcja o 150 liniach**

Robiła naraz: walidację, rozwiązywanie kartotek, przeliczenia jednostek,
wyliczenia kwotowe, dobór magazynów, kontrolę podpisu i złożenie wiersza.
Wzorzec `d.x ?? existing?.x_y ?? default` powtarzał się ~30 razy.

**S4. Przecieki granic modułów**

`operations.routes → backup.service` (eksport CSV) oraz
`corrections.service → operations.service` (etykiety pól) — cykli na poziomie
plików nie było, ale zależność pojęciowa krążyła.

**S5. Duplikacja we froncie**

* 5 kopii tej samej obsługi pobierania pliku (`try / api.download / toast / catch`),
* 3 hand-made zestawy nagłówków `Content-Disposition` w trasach,
* 3 różne zapisy mapowania jednostek (`M3 → m³`).

### 2.2 Wąskie gardła wydajności

Zmierzone licznikiem zapytań wpiętym w warstwę `db`:

| Operacja | Zapytań | Skąd |
|---|---:|---|
| Zapis 1 dokumentu (słowniki istnieją) | **19** | 8× wyszukiwanie w kartotekach + 4× odczyt zwrotny |
| Łańcuch 4 dokumentów | **92** | powyższe ×4 |
| `listCorrections` — 30 korekt pól `*_id` | **61** | klasyczne N+1 w rozwiązywaniu nazw |
| Eksport CSV | 3/stronę | `COUNT(*)` i 5 sum liczonych od nowa dla każdej strony |

**P1.** Po każdym zapisie wołane było `getOperation()`, które doczytywało
załączniki, liczbę korekt i ogniwa łańcucha — dla dokumentu właśnie utworzonego,
o którym wiadomo, że nic z tego nie ma.

**P2.** `displayValue` w rejestrze korekt rozwiązywał nazwę kartoteki osobnym
zapytaniem, dla każdego pola każdego wiersza — i próbował trzech tabel po kolei.

**P3.** `uniqueCode()` sprawdzał kolizję kodu osobnym `SELECT`-em w pętli.

**P4.** Cache instrukcji SQL rósł bez ograniczenia.

### 2.3 Ryzyka utrzymania

**M1. ~100 linii martwego kodu** — wykryte skanem eksportów bez odbiorcy:
`attachmentCounts`, `parseCsv`, `parseNumber`, `unitLabel`, `stockAt`,
`store.subscribe` / `emit` / `refreshUser`, `dom.render`, `dom.attr`,
`router.currentRoute`.

`store.js` miał kompletny mechanizm publikacji zdarzeń — z zerową liczbą
subskrybentów. Kod, który wygląda na używany, ale nie jest, kosztuje przy
każdym czytaniu pliku.

---

## 3. Strategie refaktoryzacji

### R1. Rejestr pól zamiast pięciu struktur → `domain/operation-fields.js`

Pole opisane raz:

```js
{ api: 'haulageNoteNo', col: 'haulage_note_no', label: 'Nr kwitu wywozowego',
  rule: { type: 'string', max: 60 }, fallback: null }
```

Z tego wyprowadzane są automatycznie: `OPERATION_SCHEMA`, `FIELD_LABELS`,
`CONTENT_COLUMNS`, `rowToApi`, `rowToInput` oraz funkcja `carry`, która zastąpiła
~30 powtórzeń wzorca „żądanie → dokument edytowany → domyślna”.

**Dodanie pola dziś: jeden wpis w rejestrze i jedna kolumna w migracji.**

### R2. Fabryka kartotek → `createCatalog(spec)`

Cykl życia napisany raz; kartoteki różnią się deklaracją:

```js
export const products = createCatalog({
  table: 'products', label: 'produktu w kartotece', schema: PRODUCT_SCHEMA,
  columns: { code: 'code', name: 'name', category: 'category', /* … */ },
  toApi: (r) => ({ id: r.id, code: r.code, /* … */ }),
});
```

Zachowania nietypowe (magazyn domyślny, dezaktywacja produktu ze stanem, filtr
kontrahentów) dołączane są jako nazwane rozszerzenia obok fabryki — widać, co
odstaje od standardu.

### R3. `prepareRow` rozbite na nazwane kroki

```
resolveProduct → computeAmounts → resolveWarehouses → assembleRow → ensureDictionaries
```

Każdy krok czyta się osobno i osobno testuje.

### R4–R6. Wydajność

* **R4** — zapis zwraca `readOperation()` (jedno zapytanie ze złączeniami)
  zamiast `getOperation()` (cztery). Załączniki, korekty i łańcuch pozostają
  w `GET /operations/:id`, gdzie mają sens.
* **R5** — `ensureDictionaries()` porównuje wartość z dokumentem edytowanym
  i pracuje wyłącznie nad tym, co się zmieniło; `resolvePartners()` rozwiązuje
  wszystkich kontrahentów dokumentu jednym `IN`.
* **R6** — `resolveReferenceNames()` zbiera klucze ze wszystkich wierszy strony
  i rozwiązuje je jednym zapytaniem na tabelę.
* **R7** — `listOperations(query, { withTotals: false })` dla stronicowanego
  eksportu; `uniqueCode()` pobiera zajęte kody jednym zapytaniem;
  cache instrukcji ograniczony do 256 pozycji (LRU).

### R8. Duplikacja

* `ctx.sendFile({ filename, mime, body })` w warstwie HTTP — jeden komplet nagłówków.
* `views/_shared.js` — `downloadHandler()` i `UNIT_LABEL` dla całego frontu.

---

## 4. Błędy znalezione przy okazji

Przegląd nie miał ich szukać, ale trafiły się trzy. Wszystkie naprawione,
wszystkie objęte testem regresyjnym.

### C1 — raport miesięczny ignorował filtr magazynu w obrotach *(poważny)*

`GET /reports/monthly?warehouseId=X` zawężał do magazynu tylko bilans otwarcia
i zamknięcia (liczone z ruchów), natomiast obroty, koszty i zestawienia
kontrahentów szły **po całej firmie**.

Skutek: raport dla pojedynczego magazynu pokazywał BO i BZ jednego placu przy
obrotach wszystkich — bilans produktu się nie domykał, a błąd był cichy.
Przy wielu magazynach i kontroli to trudna do wyjaśnienia rozbieżność.

Naprawa: filtr rozdzielony na `moveFilter` (ruchy) i `docFilter` (dokumenty),
zastosowany konsekwentnie we wszystkich siedmiu zapytaniach raportu.

### C2 — martwy odsyłacz do łańcucha dokumentów

Podgląd dokumentu prowadził do `#/operacje?chain=PZ/2026/000123`, ale lista
w ogóle nie czytała parametru `chain` — pokazywała pełny rejestr.

Naprawa: parametr wczytywany do filtrów, widok z komunikatem o zawężeniu.

### C3 — przywrócenie korekty nie cofało zmiany magazynu

`toInput()` nie przenosiło magazynów, więc przywrócenie stanu sprzed korekty
odtwarzało wszystko poza magazynem — dokument zostawał w bieżącym.

Naprawa: rejestr pól przenosi `warehouseFromId` / `warehouseToId`, więc migawka
korekty niesie komplet danych.

---

## 5. Wyniki

### Wydajność

| Operacja | Przed | Po | Zmiana |
|---|---:|---:|---|
| `listCorrections` (30 korekt na polach `*_id`) | 61 | **4** | **−93 %** |
| Zapis dokumentu (słowniki istnieją) | 19 | **15** | −21 % |
| Łańcuch 4 dokumentów | 92 | **72** | −22 % |
| Eksport CSV (na stronę) | 3 | **1** | −67 % |

Największa zmiana dotyczy rejestru korekt: koszt przestał rosnąć z liczbą
wierszy i pól. Przy stu korektach różnica to kilkaset zapytań.

### Struktura

| Miara | Przed | Po |
|---|---:|---:|
| `operations.service.js` | 742 linie | **620** |
| Miejsc do zmiany przy dodaniu pola | do 10 | **1** |
| Bloków CRUD w kartotekach | 4 kopie | **1 fabryka** |
| Kopii obsługi pobierania pliku | 5 | **1** |
| Kompletów nagłówków pliku w trasach | 3 | **1** |
| Martwy kod | ~100 linii | **0** |
| Cykle importów | 0 | **0** |

### Weryfikacja niezmienności zachowania

1. **77 testów przechodzi** (74 wcześniejsze + 3 regresyjne dla C1–C3).
2. **Generator danych testowych daje bit w bit ten sam wynik** — 78 łańcuchów,
   304 dokumenty, identyczne stany magazynowe i identyczne kwoty. Seed jest
   deterministyczny, więc to mocny dowód, że ścieżka księgowania liczy tak samo.
3. **Test przeglądarkowy** — 12 widoków, zero błędów JavaScript, brak poziomego
   przewijania na 390 px, podgląd przeliczeń i podgląd łańcucha bez zmian.

### Jedyna zamierzona zmiana kontraktu API

Odpowiedź na **zapis** dokumentu (`POST`/`PATCH /operations`,
`POST /operations/:id/cancel`) nie zawiera już pól `attachments`, `corrections`
i `chain`. Pozostają one w `GET /operations/:id`, gdzie są odczytem właściwym.

Powód: odpowiedź zapisu doczytywała trzy dodatkowe zapytania po dane, których
żaden klient w tym miejscu nie czytał. Aplikacja kliencka i testy używają
z tej odpowiedzi wyłącznie samego dokumentu.

---

## 6. Czego świadomie nie zmieniono

* **Model danych** — trzy filary z rozdziału 1 są trafne; migracja nietknięta.
* **Brak zależności npm** — uzasadniony wdrożeniem on-premise.
* **Renderowanie widoków przez `innerHTML`** — przy tej skali (setki wierszy)
  szybsze niż warstwa różnicowania DOM, a `esc()` pilnuje bezpieczeństwa.
* **Powtórzony wzorzec `loading → fetch → render → bind` w 11 widokach** —
  napisałem dla niego helper, ale go usunąłem: przepisanie jedenastu ekranów
  to duży diff o małej wartości, a abstrakcja bez odbiorcy jest sama w sobie
  kosztem. Do zrobienia przy najbliższej realnej zmianie w tych widokach.

## 7. Następne kroki

1. Indeks `operations(created_at)` — sortowanie wtórne listy go nie ma.
2. `dashboard()` ładuje pełne stany i filtruje w pamięci procesu — do przeniesienia
   do SQL, gdy liczba produktów urośnie.
3. Limity żądań w pamięci procesu — do wyniesienia przy wdrożeniu wieloinstancyjnym.
4. Deduplikacja załączników po `sha256` — skrót jest liczony, ale nieużywany.

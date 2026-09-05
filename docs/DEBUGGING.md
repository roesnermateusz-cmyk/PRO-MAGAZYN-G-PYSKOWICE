# Sesja debugowania — usterki produkcyjne

Dokument opisuje siedem usterek znalezionych podczas celowego polowania na błędy
w kodzie po refaktoryzacji, ich przyczyny źródłowe i wprowadzone poprawki.
Każda usterka została najpierw **odtworzona** skryptem na pełnych danych
testowych, a dopiero potem naprawiona i obłożona testem regresyjnym.

Kolejność opisu odpowiada ciężarowi skutku dla firmy, nie kolejności znalezienia.

| # | Usterka | Skutek | Status |
|---|---------|--------|--------|
| 1 | Pusta wartość w korekcie nie czyściła pola | Błędna dana zostawała w dokumencie na zawsze | naprawione |
| 2 | Kartoteka magazynowa pokazywała urwane saldo | Stan końcowy 40 MP zamiast 200 MP | naprawione |
| 3 | Literówka w nazwie magazynu zakładała magazyn widmo | Towar znikał ze stanu | naprawione |
| 4 | Metaznaki `%` i `_` w wyszukiwarce | Wynik zawierał cudze dokumenty | naprawione |
| 5 | Zamknięty okres nie chronił załączników | Usuwalny dowód z rozliczonego miesiąca | naprawione |
| 6 | Data z przyszłości i `backdate_days = 0` | Dokument na przyszły miesiąc, wyłączona kontrola | naprawione |
| 7 | Brak dostępu do połowy systemu na telefonie | Kierownik nie zamknie okresu z placu | naprawione |

Weryfikacja zaokrągleń kwot (ceny × wolumen, koszt rąbania, koszt transportu)
przebiegła bez zastrzeżeń — opisana na końcu dokumentu.

---

## 1. Pusta wartość w korekcie nie czyściła pola

### Funkcjonalność

`PATCH /operations/:id` przyjmuje **częściowy** zestaw pól. Pole pominięte
w żądaniu ma zostać bez zmian, pole przysłane — nadpisać wartość. Na tej
mechanice stoi cały rejestr korekt: każda różnica wpada do tabeli `corrections`
z migawką stanu sprzed zmiany.

### Czym jest problem

Magazynier wpisał numer kwitu wywozowego przy niewłaściwym dokumencie.
Kierownik otwiera korektę, kasuje zawartość pola, zapisuje — i numer zostaje.
Odtworzenie:

```
po zapisie   : kwit='KW-BLEDNY-999' uwagi='uwaga do usunięcia' przewoźnik='Przewoźnik X'
po korekcie  : kwit='KW-BLEDNY-999' uwagi='uwaga do usunięcia' przewoźnik='Przewoźnik X'
zmian w korekcie: 0
```

System nie zgłaszał błędu. Formularz po odświeżeniu pokazywał starą wartość,
a rejestr korekt — zero zmian. Dokument pozostawał trwale zanieczyszczony daną,
której nie dało się usunąć inaczej niż przez storno i przepisanie dokumentu.

### Dlaczego zawodzi

`lib/validate.js` traktował „brak klucza” i „klucz z pustą wartością” identycznie:

```js
if (value === undefined || value === null || value === '') {
  if (rule.required) { /* błąd */ }
  return rule.default !== undefined ? rule.default : undefined;   // ← undefined w obu razach
}
…
if (value !== undefined) out[field] = value;                       // ← klucz wypada z wyniku
```

Warstwa zapisu korzysta z `carry(input, existing, api)`, które przy braku klucza
sięga po wartość z edytowanego dokumentu. Skoro pusty wpis dawał `undefined`,
`carry` odczytywał to jako „nie ruszaj” i przywracał starą wartość.
Informacja o intencji użytkownika ginęła jedno piętro niżej, w walidatorze,
zanim jakikolwiek kod biznesowy mógł ją zobaczyć.

### Przypadki brzegowe

| Wejście | Oczekiwanie | Zachowanie po poprawce |
|---|---|---|
| klucz nieobecny | bez zmian | pole pominięte w wyniku (`undefined`) |
| `''`, `null` | wyczyść | `null` — jawny sygnał wyczyszczenia |
| `'   '` (same spacje) | wyczyść | `null` — spacje to wartość pusta, nie napis |
| pole `required` puste | błąd formularza | `ValidationError` z nazwą pola |
| pole z `default` puste | wartość domyślna | `certificate → 'BRAK'`, kwoty → `0`, tryby → `'AUTO'` |
| `0`, `false` | wartość, nie pustka | zapisane jako `0` / `false` |

Osobno zabezpieczone zostały pola, których kolumny nie dopuszczają `NULL`:
`isActive` i `isDefault` w kartotekach dostały wartości domyślne, a wszystkie
reguły ustawień systemowych — `required`, bo ustawienie nie ma stanu „puste”
(wyczyszczony przelicznik wywróciłby przeliczenia przyszłych dokumentów).

### Naprawiony kod

`server/src/lib/validate.js`:

```js
function resolveEmpty(field, rule, errors, present) {
  if (rule.required) {
    errors.push({ field, message: `Pole „${rule.label || field}” jest wymagane.` });
    return undefined;
  }
  if (rule.default !== undefined) return rule.default;
  return present ? null : undefined;
}
```

`validate()` przekazuje teraz informację, czy klucz w ogóle wystąpił
(`Object.hasOwn(source, field)`), i przepuszcza `null` do wyniku.
`carry()` nie wymagał zmian — `null !== undefined`, więc jawne wyczyszczenie
przechodzi przez nie poprawnie.

---

## 2. Kartoteka magazynowa pokazywała urwane saldo

### Funkcjonalność

`GET /stock/ledger` zwraca chronologiczny ciąg ruchów produktu ze stanem
narastającym — podstawa uzgodnień z dokumentami papierowymi i kontroli
inwentaryzacyjnej. Parametr `limit` ogranicza długość wypisu.

### Czym jest problem

Przy historii dłuższej niż `limit` kartoteka pokazywała inny stan końcowy niż
lista stanów magazynowych, która sumuje wszystko:

```
rzeczywisty stan produktu       : 200 MP
kartoteka bez limitu  → closing : 200 (41 ruchów)
kartoteka z limitem 10 → closing:  40 (10 ruchów)
```

Dwa ekrany tego samego systemu podawały dwie różne liczby dla tego samego
produktu. Przy 300 ruchach (limit ustawiony w interfejsie) różnica pojawia się
po kilku miesiącach normalnej pracy — czyli dokładnie wtedy, gdy kartoteka jest
potrzebna do rozliczenia rocznego.

### Dlaczego zawodzi

`closing` był efektem ubocznym pętli po wyświetlonych wierszach:

```js
let running = roundQty(opening);
const items = rows.map((r) => { running = roundQty(running + r.qty_mp); … });
return { opening: roundQty(opening), closing: running, items };
```

Zapytanie sortowało `ORDER BY m.move_date, m.created_at LIMIT :limit`, czyli
rosnąco — `LIMIT` obcinał **najnowsze** ruchy. `running` był więc saldem po
dziesiątym ruchu od początku historii, przedstawianym jako stan bieżący.
Parametr prezentacyjny decydował o liczbie księgowej.

### Przypadki brzegowe

- Ruchów mniej niż `limit` → saldo i wypis bez zmian względem poprzedniej wersji.
- Ruchów więcej niż `limit` → widoczne najnowsze, bo kartotekę czyta się od
  bieżącego stanu wstecz; saldo pierwszego wiersza okna wynika z odjęcia obrotu
  okna od stanu końcowego, więc kolumna „Saldo MP” pozostaje ciągła.
- Filtr `dateFrom` → bilans otwarcia liczony osobnym agregatem, jak dotąd.
- Filtr `dateTo` → stan końcowy dotyczy końca okresu, nie dnia dzisiejszego.
- Zerowa liczba ruchów → `closing === opening`, pusty wypis.

### Naprawiony kod

`server/src/modules/stock/stock.service.js` — bilanse liczone agregatem po całym
okresie, niezależnie od `limit`:

```js
const period = db.get(
  `SELECT COUNT(*) AS moves, COALESCE(SUM(m.qty_mp), 0) AS qty_mp
     FROM stock_moves m WHERE ${whereSql}`, params,
);
const closing = roundQty(opening + period.qty_mp);
const truncated = period.moves > f.limit;
```

Okno pobierane jest malejąco i odwracane do porządku chronologicznego, a odpowiedź
niesie `moves` i `truncated`. Interfejs dopisuje wtedy do nagłówka kartoteki
„wypis skrócony do N z M ruchów (najnowsze)”, żeby skrót był widoczny, a nie
domyślny.

---

## 3. Literówka w nazwie magazynu zakładała magazyn widmo

### Funkcjonalność

Dokument wskazuje magazyn nazwą (`warehouseFrom` / `warehouseTo`) albo kluczem
kartoteki. Nazwa jest wygodna w terenie — magazynier wpisuje to, co widzi.

### Czym jest problem

```
magazynów przed: 1 → po: 2
magazyny: Magazyn RiC Zabrze | Magazyn RiC Zabzre
```

Przestawione litery w nazwie zakładały nowy magazyn i księgowały na niego towar.
Dokument zapisywał się bez ostrzeżenia, stan magazynu właściwego był zaniżony,
a różnica siedziała w kartotece, do której nikt nie zaglądał. Wykrycie następowało
przy inwentaryzacji — kilka tygodni i kilkadziesiąt dokumentów później.

### Dlaczego zawodzi

```js
if (d[nameKey] !== undefined) return d[nameKey] ? warehouses.ensure(d[nameKey]).id : null;
```

`ensure` zakłada pozycję, gdy jej nie znajdzie. Dla kontrahentów i produktów to
zachowanie właściwe: nowa nazwa jest normalnym zdarzeniem, magazynier nie ma
przerywać pracy, żeby dodać dostawcę, a pomyłka daje najwyżej zduplikowaną
pozycję w słowniku. Dla magazynu skutek jest inny w rodzaju, nie w stopniu:
**towar trafia w nieistniejące miejsce**. Kartoteka magazynów opisuje fizyczne
place składowe — tych nie przybywa przez literówkę w formularzu.

### Przypadki brzegowe

- Nazwa istniejąca, inna wielkość liter → rozpoznana (`COLLATE NOCASE`), jak dotąd.
- Nazwa nieistniejąca → błąd formularza z listą dostępnych magazynów.
- Pusta nazwa → wyczyszczenie strony dokumentu (patrz usterka 1).
- Nieistniejący **klucz** magazynu → wcześniej błąd klucza obcego (HTTP 500),
  teraz błąd formularza (HTTP 422) przy tym samym polu.
- Magazyn nieaktywny → nadal rozpoznawany, żeby dało się korygować historię.

### Naprawiony kod

`server/src/modules/operations/operations.service.js`, krok „magazyny”:

```js
const byName = (name, field) => {
  const found = warehouses.findByName(name);
  if (found) return found.id;
  const available = warehouses.list().map((w) => w.name);
  errors.push({ field, message:
    `Nie ma magazynu o nazwie „${name}”. Dostępne: ${available.join(', ') || 'brak'}. `
    + 'Nowy magazyn zakłada się w kartotece magazynów.' });
  return null;
};
```

Gdy magazyn nie został rozpoznany, funkcja nie podstawia magazynu domyślnego —
to byłaby ta sama pomyłka przeniesiona w inne miejsce. Kontrahenci i produkty
zachowują dotychczasowe zakładanie w locie.

---

## 4. Metaznaki `%` i `_` w wyszukiwarce

### Funkcjonalność

Wyszukiwarka rejestru dokumentów, kartoteki kontrahentów i rejestru korekt
działa jak „zawiera”: `LIKE '%fraza%'` po kilku kolumnach naraz.

### Czym jest problem

```
szukam dosłownie "A_B" → trafień: 2 (zlecenie AXB | zlecenie A_B)
```

W `LIKE` znak `_` pasuje do dowolnego znaku, a `%` do dowolnego ciągu. Numery
kwitów i oznaczenia zleceń zawierają podkreślenia, a uwagi — znak procenta.
Wynik wyglądał poprawnie i był krótki, więc nikt nie sprawdzał, czy nie zawiera
cudzych dokumentów. Wpisanie samego `%` zwracało cały rejestr jako „wynik
wyszukiwania”.

### Dlaczego zawodzi

Wzorzec był składany bez neutralizacji metaznaków: ``params.q = `%${f.q}%` ``.
To nie jest podatność na wstrzyknięcie SQL — zapytania są parametryzowane —
tylko błąd semantyczny: użytkownik pisze tekst, a system czyta wzorzec.

### Przypadki brzegowe

| Zapytanie | Przed | Po |
|---|---|---|
| `A_B` | `A_B` i `AXB` | tylko `A_B` |
| `50%` | wszystko zaczynające się od `50` | tylko `50%` |
| `%` | cały rejestr (304 dokumenty) | 0 trafień |
| `C:\dane` | pominięty ukośnik | dosłownie `C:\dane` |
| `PZ/2026` | poprawnie | poprawnie (bez zmian) |

### Naprawiony kod

`server/src/db/index.js` — jedno miejsce dla wszystkich wyszukiwarek:

```js
export const LIKE_ESCAPE = "ESCAPE '\\'";

export function likePattern(text) {
  return `%${String(text).replace(/[\\%_]/g, '\\$&')}%`;
}
```

Zastosowane w trzech wyszukiwarkach: rejestr dokumentów (9 kolumn), kartoteka
kontrahentów (3 kolumny), rejestr korekt (3 kolumny). Generator kodów pozycji
kartotekowych używa `LIKE` na wzorcu własnej produkcji (`slugCode` przepuszcza
wyłącznie `A-Z`, `0-9` i `-`), więc nie wymagał zmiany.

---

## 5. Zamknięty okres nie chronił załączników

### Funkcjonalność

Zamknięcie miesiąca (`periods`) blokuje zapisy wstecz i utrwala migawkę stanów
magazynowych, dzięki czemu raport miesięczny pozostaje odtwarzalny.

### Czym jest problem

Blokada obejmowała dokumenty, ale nie ich załączniki:

```
edycja dokumentu: zablokowana ✓ (PERIOD_CLOSED)
usunięcie skanu : PRZESZŁO  ✗
```

Skan kwitu wywozowego jest dowodem tak samo jak sam dokument — kontrola
KZR/SURE sięga do miesięcy dawno rozliczonych. Skoro dokumentu z zamkniętego
okresu nie da się zmienić, jego dowodu nie powinno dać się usunąć.

### Dlaczego zawodzi

`addAttachment` i `deleteAttachment` po prostu nie wołały `assertPeriodOpen`.
Kontrola okresu została dodana w serwisie operacji i nie objęła serwisu
załączników, który powstał obok.

### Rozstrzygnięcie: dodawanie tak, usuwanie nie

Dwie operacje mają różny ciężar, więc dostały różne reguły:

- **Usunięcie jest blokowane.** Ubytek dowodu z rozliczonego miesiąca to
  nieodwracalna strata. Droga wyjścia jest ta sama co dla dokumentu: otwarcie
  okresu przez kierownika, odnotowane w dzienniku audytu.
- **Dodanie pozostaje dozwolone.** Uzupełnienie dokumentacji (certyfikat, który
  przyszedł pocztą po zamknięciu miesiąca) nie zmienia żadnej liczby — ani stanu,
  ani wartości, ani sald okresu. Wymuszanie tu otwarcia okresu odwracałoby
  zamknięcie z powodu, który go nie dotyczy. Wpis trafia do dziennika audytu.

Konsekwencją jest to, że omyłkowo wgranego skanu nie da się usunąć z zamkniętego
miesiąca — poprawia się go dodaniem właściwego. To ta sama zasada, według której
dokumentu nie usuwamy, tylko stornujemy.

### Przypadki brzegowe

- Załącznik dokumentu bez okresu (dokument usunięty kaskadowo) → brak blokady.
- Magazynier i cudzy załącznik → nadal `ForbiddenError`, kontrola sprawdzana
  przed okresem, żeby komunikat dotyczył właściwej przyczyny.
- Okres otwarty ponownie → usuwanie działa jak dotąd.

---

## 6. Data z przyszłości i `backdate_days = 0`

### Funkcjonalność

Ustawienie `rules.backdate_days` ogranicza księgowanie wstecz dla magazyniera
i księgowego. Kierownik i administrator mają księgować także starsze dokumenty.

### Czym jest problem

Dwie usterki w jednej funkcji:

```
ADMIN: dokument zaksięgowany na 2026-10-04  ✗ (data 30 dni w przód)
```

1. Kontrola daty przyszłej dotyczyła tylko ról bez uprawnień, więc administrator
   i kierownik mogli zaksięgować dokument na przyszły miesiąc. Taki dokument psuje
   stan na dzień, raport miesięczny i migawkę zamknięcia okresu.
2. Ustawienie `backdate_days = 0` wyłączało **całą** funkcję, razem z kontrolą
   daty przyszłej — dla wszystkich ról naraz.

### Dlaczego zawodzi

```js
const limitDays = Number(getSetting('rules.backdate_days')) || 0;
if (!limitDays) return;                                   // ← zero kończy funkcję
if (user.role === 'ADMIN' || user.role === 'KIEROWNIK') return;   // ← i tu też
…
if (diffDays < -1) throw new ValidationError('Data operacji nie może być z przyszłości.');
```

Kontrola daty przyszłej stała na końcu funkcji, za dwoma wyjściami wcześniejszymi.
Zero było czytane jako „brak limitu”, choć administrator wpisuje zero, żeby
furtkę **zamknąć** — ustawienie działało odwrotnie do zamiaru.

### Przypadki brzegowe

| Sytuacja | Zachowanie po poprawce |
|---|---|
| Data jutrzejsza, dowolna rola | odrzucona |
| Data dzisiejsza w strefie UTC+2 wieczorem | przyjęta (doba tolerancji na strefę) |
| `backdate_days = 0`, magazynier, wczoraj | odrzucone — zero znaczy „tylko dzisiaj” |
| `backdate_days = 0`, magazynier, dzisiaj | przyjęte |
| `backdate_days = 0`, kierownik, rok wstecz | przyjęte (rola bez limitu wstecz) |
| `backdate_days = 3650` | praktyczny brak ograniczenia |
| Ustawienie uszkodzone / nieliczbowe | wartość zapasowa 90 dni |

### Naprawiony kod

Reguły rozdzielone, kontrola daty przyszłej postawiona przed wszystkimi wyjściami
i niezależna od roli oraz od ustawienia:

```js
function assertDateAllowed(date, user) {
  const diff = daysBack(date);
  if (diff < -FUTURE_TOLERANCE_DAYS) throw new ValidationError(…);   // każda rola
  if (user.role === 'ADMIN' || user.role === 'KIEROWNIK') return;
  const setting = Number(getSetting('rules.backdate_days'));
  const limitDays = Number.isFinite(setting) && setting >= 0 ? setting : 90;
  if (diff > limitDays) throw new ForbiddenError(…);
}
```

Podpowiedź w ustawieniach mówi teraz wprost, że `0` to wyłącznie dzień bieżący,
`3650` to praktyczny brak ograniczenia, a daty przyszłej nie przyjmuje żadna rola.

---

## 7. Połowa systemu nieosiągalna na telefonie

Znalezione przy weryfikacji przeglądarkowej poprawek, nie w kodzie serwera.

### Czym jest problem

Poniżej 860 px sidebar jest ukryty, a dolny pasek zakładek mieści pięć pozycji
z dwunastu. Okresy, korekty, kartoteki, użytkownicy i ustawienia nie miały na
telefonie **żadnej** ścieżki dostępu — poza ręcznym wpisaniem adresu z `#`.
Kierownik stojący przy pryzmie nie zamknie miesiąca, choć ma do tego uprawnienia.

### Dlaczego zawodzi

Nawigacja mobilna powstała jako filtr listy `NAV` po fladze `tab`. Pozycje bez
tej flagi nie trafiały nigdzie — brakowało drugiego poziomu.

### Naprawiony kod

Szósta pozycja paska („Więcej”) otwiera panel dolny z **pełną** listą sekcji,
składaną z tej samej tablicy `NAV`, z tymi samymi separatorami grup i tą samą
kontrolą uprawnień. Panel zamyka się po wyborze pozycji, kliknięciu tła
i klawiszem `Escape`; nie pojawia się na wydruku ani na desktopie.
Nowa pozycja dopisana do `NAV` pojawia się odtąd we wszystkich trzech miejscach
naraz: w sidebarze, w pasku zakładek (gdy ma `tab`) i w panelu „Więcej”.

---

## Sprawdzone bez zastrzeżeń: zaokrąglenia kwot

Osobny skrypt porównał wartości liczone przez system z liczeniem w pełnej
precyzji dla ~300 dokumentów: `value_purchase`, `value_sale`, `chipping_cost`
i `transport_cost`, w tym przypadki brzegowe cen z trzema miejscami po przecinku
i wolumenów ułamkowych. Rozbieżności groszowe nie wystąpiły — `roundMoney`
stosowane jest konsekwentnie przed zapisem, a sumy raportów liczą się z wartości
już zaokrąglonych, nie z iloczynów odtwarzanych na nowo.

---

## Weryfikacja

| Sprawdzenie | Wynik |
|---|---|
| Testy automatyczne | 96 z 96 (było 77; +19 testów regresyjnych i jednostkowych) |
| Cykle importów | 0 |
| Determinizm danych testowych | 78 łańcuchów, 304 dokumenty, identyczne stany i wartości jak przed poprawkami |
| Test przeglądarkowy (desktop 1440×900) | 6 z 6 |
| Test przeglądarkowy (telefon 390×844) | 7 z 7 |
| Poziome przewijanie strony | 0 px na obu szerokościach |
| Błędy w konsoli przeglądarki | brak |

Nowe testy regresyjne (`server/tests/operations.test.mjs`) odtwarzają każdą
z usterek 1–6 w postaci, w jakiej wystąpiła. `server/tests/validate.test.mjs`
opisuje kontrakt walidatora wprost — rozróżnienie „brak pola” od „pole
wyczyszczone” jest założeniem, na którym stoi cały rejestr korekt, więc ma
własny zestaw testów, niezależny od warstwy dokumentów.

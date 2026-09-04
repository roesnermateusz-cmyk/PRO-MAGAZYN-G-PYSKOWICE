# Schemat bazy danych

Silnik: **SQLite** w trybie WAL. Migracje: `server/src/db/migrations/*.sql`,
uruchamiane automatycznie przy starcie (`DB_AUTO_MIGRATE=true`) lub ręcznie
poleceniem `npm run migrate`.

---

## 1. Model pojęciowy

```
   users ──┐
           ├──< operations >──< stock_moves >── warehouses
 partners ─┤        │  │                    └── products
 products ─┘        │  └──< attachments
                    └──< corrections

 periods · stock_snapshots · document_counters · settings · audit_log · sessions
```

Rdzeń stanowi para:

* **`operations`** — głowa dokumentu: co, kiedy, od kogo, za ile, na czyj podpis.
* **`stock_moves`** — wyliczone skutki magazynowe dokumentu.

Stan magazynu to **zawsze** suma `stock_moves`. Nigdzie w systemie nie ma pola
przechowującego bieżący stan.

---

## 2. Tabele

### 2.1 `users` — konta użytkowników

| Kolumna | Typ | Opis |
|---|---|---|
| `id` | TEXT PK | UUID v4 |
| `email` | TEXT UNIQUE | login |
| `full_name` | TEXT | imię i nazwisko — trafia na dokumenty |
| `password_hash` | TEXT | `scrypt$N$r$p$sól$hash` |
| `role` | TEXT | ADMIN, KIEROWNIK, MAGAZYNIER, KSIEGOWY, AUDYTOR |
| `is_active` | INTEGER | 0/1 — konta nie są usuwane, tylko dezaktywowane |
| `must_change_password` | INTEGER | wymusza zmianę przy najbliższym logowaniu |
| `failed_logins`, `locked_until` | INTEGER, TEXT | ochrona przed atakiem słownikowym |

### 2.2 `sessions` — tokeny odświeżania

Token przechowywany wyłącznie jako `token_hash` (SHA-256). Rotacja przy każdym
użyciu — token użyty ponownie jest odrzucany, co ujawnia próbę kradzieży sesji.

### 2.3 Kartoteki

| Tabela | Rola | Uwagi |
|---|---|---|
| `warehouses` | magazyny | jeden oznaczony `is_default` |
| `products` | produkty | opcjonalne przeliczniki indywidualne |
| `partners` | kontrahenci | `kind`: DOSTAWCA / ODBIORCA / OBA / PRZEWOZNIK |
| `vehicles` | pojazdy | numer rejestracyjny + przewoźnik |
| `forest_districts`, `forest_ranges` | nadleśnictwa i leśnictwa | wymagane przy KZR/SURE |
| `loading_places` | miejsca załadunku | uzupełniane automatycznie |

Kartoteki uzupełniają się „w locie”: magazynier wpisujący nowego kontrahenta w
formularzu nie musi przerywać pracy — pozycja powstaje przy zapisie dokumentu.

### 2.4 `operations` — rejestr dokumentów

Grupy kolumn:

**Identyfikacja**
`doc_no` (`PZ/2026/000123`, UNIQUE), `doc_series`, `doc_year`, `doc_number`,
`type`, `status` (`POSTED` / `CANCELLED`).

**Daty**
`operation_date`, `loading_date`, `operation_month` — kolumna generowana
(`substr(operation_date,1,7)`) z indeksem, podstawa raportów miesięcznych.

**Ilości i przeliczniki**

| Kolumna | Znaczenie |
|---|---|
| `quantity`, `unit` | to, co wpisał magazynier |
| `qty_m3`, `qty_mp`, `qty_tonne`, `energy_gj` | pełne przeliczenie, wyliczone przy zapisie |
| `m3_mode` / `m3_manual` (analogicznie MP i tony) | nadpisania wartościami rzeczywistymi |
| `factor_m3_mp`, `factor_mp_tonne`, `factor_tonne_gj` | **przeliczniki użyte przy księgowaniu** |

Ostatnia grupa jest kluczowa: dzięki niej zmiana ustawień nie przepisuje historii.

**Strony operacji**
`warehouse_from_id`, `warehouse_to_id`, `partner_from_id`, `partner_to_id` oraz
migawki nazw (`supplier_name`, `recipient_name`, `product_name`) — dokument
pozostaje czytelny nawet po zmianie nazwy w kartotece.

**Pochodzenie (KZR / SURE)**
`forest_district`, `forest_range`, `haulage_note_no`, `loading_place`,
`origin_place`, `certificate`.

**Wartości**
`price_purchase`, `price_sale`, `value_purchase`, `value_sale`,
`chipping_mode`, `chipping_price`, `chipping_cost`.

**Transport**
`carrier_name`, `vehicle_plate`, `distance_km`, `transport_cost`.

**Łańcuch i metryka**
`chain_ref`, `parent_id`, `revision`, `created_by/at`, `updated_by/at`,
`cancelled_by/at`, `cancel_reason`.

**Indeksy**

```sql
ix_operations_date     (operation_date DESC)      -- lista domyślna
ix_operations_month    (operation_month, type)    -- raporty miesięczne
ix_operations_type     (type, status)             -- filtr typu
ix_operations_product  (product_id, operation_date)
ix_operations_chain    (chain_ref)
ix_operations_partner  (partner_to_id, partner_from_id)
ix_operations_plate    (vehicle_plate)
```

### 2.5 `stock_moves` — ruchy magazynowe

Jeden dokument → 1 ruch (PZ/WZ/PW/RW/BO) albo 2 ruchy (MM: `-1` i `+1`).
Ilości zapisane **ze znakiem kierunku**, więc stan to zwykłe `SUM`.

```sql
ix_moves_stock (warehouse_id, product_id)   -- stan bieżący
ix_moves_month (move_month, product_id)     -- obroty miesiąca
ix_moves_op    (operation_id)               -- przeliczenie po edycji
ix_moves_date  (move_date)                  -- stan na dzień
```

`ON DELETE CASCADE` od `operations` gwarantuje, że ruch nie przeżyje dokumentu.

### 2.6 `corrections` — rejestr korekt

| Kolumna | Opis |
|---|---|
| `changes_json` | `[{field, label, from, to}]` — czytelne dla kontrolera |
| `snapshot_before` | pełny wiersz dokumentu sprzed zmiany (JSON) |
| `reason` | uzasadnienie podane przez użytkownika |

`snapshot_before` pozwala przywrócić stan sprzed dowolnej korekty — operacja
przywrócenia sama zapisuje kolejną korektę.

### 2.7 `periods` i `stock_snapshots` — okresy rozliczeniowe

Zamknięcie miesiąca blokuje zapisy i utrwala migawkę stanów na jego koniec.
Miesiąc bez wpisu w `periods` jest traktowany jako otwarty. Okresy zamyka się
chronologicznie, otwiera od najnowszego.

### 2.8 `document_counters` — numeracja

Klucz `(series, year)`; numeracja startuje od 1 każdego roku. Przydział numeru
jest atomowy:

```sql
INSERT INTO document_counters(series, year, last_number) VALUES (?, ?, 1)
ON CONFLICT(series, year) DO UPDATE SET last_number = last_number + 1
RETURNING last_number;
```

### 2.9 `audit_log`, `settings`, `attachments`

* `audit_log` — dopisywalny dziennik zdarzeń (logowania, zapisy, storno, eksporty).
* `settings` — pary klucz/wartość JSON z pamięcią podręczną w procesie.
* `attachments` — metadane plików; zawartość na dysku (`data/attachments/RRRR/MM/`),
  w bazie `sha256` do kontroli integralności.

---

## 3. Widoki

```sql
v_stock_current    -- stan bieżący: magazyn × produkt
v_monthly_turnover -- obroty miesięczne: miesiąc × typ × produkt
```

Widoki upraszczają zapytania raportowe i stanowią stabilny punkt integracji dla
narzędzi zewnętrznych (Excel, Power BI) — także po zmianach w tabelach.

---

## 4. Typowe zapytania

```sql
-- Stan bieżący produktu w magazynie
SELECT SUM(qty_mp) FROM stock_moves WHERE warehouse_id = :w AND product_id = :p;

-- Stan na koniec marca
SELECT SUM(qty_mp) FROM stock_moves WHERE product_id = :p AND move_date <= '2026-03-31';

-- Obroty miesiąca według typu dokumentu
SELECT type, SUM(qty_mp), SUM(value_sale)
  FROM operations WHERE status='POSTED' AND operation_month='2026-03' GROUP BY type;

-- Pochodzenie surowca do audytu KZR
SELECT forest_district, forest_range, SUM(qty_m3)
  FROM operations WHERE type='ZAKUP' AND status='POSTED'
  GROUP BY forest_district, forest_range;
```

---

## 5. Kopie zapasowe i odtwarzanie

| Metoda | Zakres | Kiedy |
|---|---|---|
| Kopia pliku bazy | pełny stan | automatycznie raz na dobę, przed importem, na żądanie |
| Eksport JSON | dane logiczne (bez haseł) | ręcznie, przy migracji lub przekazaniu danych |
| Eksport CSV | rejestr operacji | dla księgowości |

Kopia wykonuje `PRAGMA wal_checkpoint(TRUNCATE)` przed skopiowaniem pliku, więc
archiwum zawiera wszystkie zatwierdzone transakcje.

**Odtworzenie:** zatrzymać aplikację, podmienić `data/resinvest.db` plikiem kopii
(usuwając `-wal` i `-shm`), uruchomić ponownie.

---

## 6. Migracja na PostgreSQL

Schemat jest pisany przenośnie. Kroki migracji:

1. **Typy** — `TEXT` → `text`/`uuid`, `REAL` → `numeric(14,3)` dla ilości i
   `numeric(14,2)` dla kwot (dokładność dziesiętna zamiast zmiennoprzecinkowej).
2. **Kolumny generowane** — `GENERATED ALWAYS AS (substr(...)) STORED` ma
   bezpośredni odpowiednik w PostgreSQL 12+.
3. **`datetime('now')`** → `now()`; `substr` → `substring`.
4. **`INSERT … ON CONFLICT … RETURNING`** — składnia identyczna.
5. **`db`** — podmiana `server/src/db/index.js` na klienta `pg` z zachowaniem
   interfejsu `all/get/value/run/tx`. Reszta kodu pozostaje bez zmian.
6. **Dane** — `npm run backup -- --json`, następnie import przez `/backup/import`
   na nowej instancji.

Warstwy `service` i `domain` nie zawierają SQL-a specyficznego dla SQLite.

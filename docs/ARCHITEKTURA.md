# Architektura systemu ResInvest ERP

Dokument opisuje budowę systemu, model danych i decyzje projektowe wraz
z uzasadnieniem. Przeznaczony dla osób rozwijających system.

---

## 1. Warstwy

```
┌──────────────────────────────────────────────────────────────┐
│  PRZEGLĄDARKA / POWŁOKA DESKTOPOWA                           │
│  React + TypeScript, routing, i18n (pl/cs/en), motywy        │
│  Uprawnienia wpływają wyłącznie na widoczność akcji          │
└───────────────────────────┬──────────────────────────────────┘
                            │ HTTPS/HTTP, JSON
                            │ Authorization: Bearer <token>
                            │ X-Warehouse-Id: <magazyn roboczy>
┌───────────────────────────▼──────────────────────────────────┐
│  SERWER API (Express)                                        │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ helmet · CORS · kompresja · limity żądań               │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │ authenticate  – token → użytkownik, rola, uprawnienia, │  │
│  │                 lista magazynów (odczyt z bazy przy    │  │
│  │                 każdym żądaniu)                        │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │ requirePermission – kontrola uprawnień                 │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │ walidacja zod – kształt i zakres danych wejściowych    │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │ WARSTWA SERWISOWA – reguły biznesowe, transakcje       │  │
│  │   documents.service  – cykl życia dokumentu            │  │
│  │   stock.engine       – ruchy magazynowe i salda        │  │
│  │   core/audit         – historia zmian                  │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │ centralna obsługa błędów → { error: { code, message } }│  │
│  └────────────────────────────────────────────────────────┘  │
└───────────────────────────┬──────────────────────────────────┘
                            │ better-sqlite3 (synchronicznie)
┌───────────────────────────▼──────────────────────────────────┐
│  SQLite: WAL · synchronous=FULL · foreign_keys=ON            │
│  Wyzwalacze chroniące audyt i księgę ruchów                  │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Decyzje projektowe

### 2.1 SQLite jako baza produkcyjna

**Decyzja:** SQLite w trybie WAL zamiast PostgreSQL/MySQL.

**Uzasadnienie:** system obsługuje kilku–kilkunastu równoczesnych użytkowników
w sieci lokalnej firmy. SQLite w trybie WAL zapewnia pełną transakcyjność ACID,
równoczesny odczyt podczas zapisu i wydajność wystarczającą dla tej skali, a przy
tym pozwala dostarczyć system jako **jeden instalator bez osobnego serwera bazy**.
To eliminuje najczęstszą przyczynę nieudanych wdrożeń w małych firmach.

**Ustawienia:**

| Pragma | Wartość | Powód |
|---|---|---|
| `journal_mode` | `WAL` | równoczesny odczyt w trakcie zapisu |
| `synchronous` | `FULL` | trwałość commitu przy zaniku zasilania |
| `foreign_keys` | `ON` | integralność referencyjna |
| `busy_timeout` | `10000` | kolejkowanie zamiast błędu przy równoczesnym zapisie |

**Granice:** przy ponad ~50 równoczesnych użytkownikach zapisujących lub pracy
przez WAN należy przejść na PostgreSQL. Model danych używa wyłącznie standardowego
SQL — migracja wymaga zmiany warstwy dostępu, nie przeprojektowania schematu.

### 2.2 Kwoty jako liczby całkowite groszy

Kolumny z sufiksem `_gr` przechowują `INTEGER`. Arytmetyka zmiennoprzecinkowa
kumuluje błąd przy sumowaniu — w systemie finansowym jest to niedopuszczalne.
Konwersja na złote następuje dopiero na granicy API (`core/money.ts`).

Test regresyjny: zsumowanie 1000 pozycji po 0,10 zł daje dokładnie 100,00 zł.

### 2.3 Ilości w jednostce bazowej produktu

Stan magazynowy prowadzony jest **wyłącznie** w jednostce bazowej produktu
(m³ dla drewna, MP dla zrębki, t dla pelletu). Wartości m³ / MP / t na pozycji
dokumentu są informacją prezentacyjną i mogą zostać nadpisane ręcznie jako
wartość rzeczywista — flagi `qty_*_manual` odróżniają je od wyliczonych.

Dzięki temu ręczna korekta masy nie zafałszowuje stanu magazynowego.

### 2.4 Jedna tabela dokumentów

Wszystkie typy operacji (PZ, WZ, MM, PROD, TR, SD) korzystają z jednej tabeli
`documents` z polami specyficznymi dla typu. Alternatywa — osobna tabela na typ —
wymagałaby sześciu niemal identycznych zestawów zapytań dla list, raportów,
numeracji i audytu.

Kolumny nieużywane przez dany typ pozostają puste; walidacja typu odbywa się
w warstwie serwisowej (`validateByType`).

### 2.5 Powiązanie zużycia z produkcją przez role pozycji

Produkcja to **jeden dokument** zawierający pozycje o rolach `INPUT` (zużyty
surowiec) i `OUTPUT` (powstały wyrób). Wspólne `document_id` jest powiązaniem —
nie potrzeba osobnej tabeli `production_consumption`.

Zapytanie „z jakiego zużycia powstała ta produkcja” to odczyt pozycji jednego
dokumentu. Ruchy magazynowe wskazują konkretną pozycję (`document_line_id`),
więc ślad jest pełny aż do poziomu pojedynczego ruchu.

### 2.6 Kontrahenci w jednej encji

Dostawca, odbiorca, przewoźnik i nadleśnictwo to flagi (`is_supplier`,
`is_customer`, `is_carrier`, `is_forestry`) na wspólnej tabeli `partners`.
Ten sam podmiot bywa jednocześnie dostawcą i odbiorcą — rozdzielenie na
osobne tabele prowadziłoby do duplikatów danych adresowych i NIP.

### 2.7 Saldo zmaterializowane obok księgi ruchów

`stock_movements` to niemodyfikowalna księga wszystkich ruchów.
`stock` przechowuje saldo aktualizowane **w tej samej transakcji**.

Powód: odczyt stanu to jedno zapytanie po kluczu głównym zamiast agregacji
całej historii. Spójność obu struktur weryfikuje `verifyStockIntegrity()`
udostępniona jako `GET /api/stock/integrity`.

### 2.8 Audyt chroniony wyzwalaczami bazy danych

```sql
CREATE TRIGGER trg_audit_no_update
BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
```

Ochrona w kodzie aplikacji zawodzi przy dostępie do bazy z pominięciem aplikacji.
Wyzwalacz działa zawsze. Te same wyzwalacze chronią `stock_movements` — storno
realizowane jest wpisem odwrotnym, nigdy modyfikacją oryginału.

---

## 3. Model danych

### 3.1 Uprawnienia i dostęp

```
roles ──< role_permissions >── permissions
  │
  └──< users ──< user_warehouses >── warehouses
         │
         └──< refresh_tokens
```

Role systemowe: `ADMIN`, `MANAGER`, `WAREHOUSE`, `VIEWER`.
Zestaw uprawnień ról innych niż `ADMIN` jest edytowalny w aplikacji.

### 3.2 Dokumenty i magazyn

```
documents ──< document_lines ──< stock_movements >── stock
    │              │                    │
    │              └── products ────────┘
    ├── warehouses (warehouse_id / from / to)
    ├── partners   (supplier / customer / carrier)
    ├── attachments
    └── documents  (correction_of_id, parent_document_id)
```

### 3.3 Wpływ typu dokumentu na stan

| Typ | Ruch magazynowy |
|---|---|
| `PZ` | `+` do `warehouse_id` |
| `WZ` | `−` z `warehouse_id` |
| `MM` | `−` z `warehouse_from_id` **i** `+` do `warehouse_to_id` (nierozłącznie) |
| `PROD` | `−` pozycje `INPUT`, `+` pozycje `OUTPUT`, w `warehouse_id` |
| `TR` | brak — operacja kosztowa |
| `SD` | brak — towar nie trafia do magazynu |

---

## 4. Cykl życia dokumentu

```
                 ┌─────────┐
    utworzenie → │  DRAFT  │ ← edycja (kontrola wersji)
                 └────┬────┘
                      │ zatwierdzenie: walidacja → kontrola stanu
                      │ → ruchy → salda → audyt → commit
                 ┌────▼─────┐
                 │  POSTED  │ ← dokument obowiązujący, bez edycji
                 └────┬─────┘
          ┌───────────┴───────────┐
   anulowanie                 korekta
   (storno ruchów)      (storno + nowa kopia DRAFT)
          │                       │
    ┌─────▼──────┐          ┌─────▼─────┐
    │ CANCELLED  │          │   DRAFT   │ (correction_of_id)
    └────────────┘          └───────────┘
```

Kroki zatwierdzenia wykonywane są w jednej transakcji `IMMEDIATE`:

1. ponowny odczyt dokumentu wewnątrz transakcji (ochrona przed wyścigiem),
2. kontrola statusu i wersji,
3. wyznaczenie ruchów magazynowych,
4. **agregacja netto per magazyn i produkt**, kontrola dostępności przed zapisem,
5. zapis ruchów do księgi,
6. aktualizacja sald,
7. zmiana statusu z inkrementacją wersji,
8. wpis do historii zmian,
9. `COMMIT` — lub `ROLLBACK` całości przy dowolnym niepowodzeniu.

---

## 5. Praca wielu użytkowników

| Zagrożenie | Mechanizm ochrony |
|---|---|
| Dwóch użytkowników edytuje ten sam dokument | Blokada optymistyczna — kolumna `version`, `UPDATE ... WHERE version = ?`, przy niezgodności `VERSION_CONFLICT` |
| Podwójne zatwierdzenie | Warunek `status = 'DRAFT'` wewnątrz transakcji; drugie żądanie otrzymuje `INVALID_STATE` |
| Równoległe wydania przekraczające stan | Transakcja `IMMEDIATE` serializuje zapisy; kontrola stanu wykonywana jest wewnątrz transakcji |
| Podwójne kliknięcie „Zapisz” | Klucz idempotencji `client_request_id` z ograniczeniem `UNIQUE` — powtórzone żądanie zwraca istniejący dokument |
| Ten sam numer dokumentu | `UPDATE doc_sequences ... RETURNING` w transakcji zapisu |
| Nieaktualne uprawnienia w tokenie | Rola, uprawnienia i magazyny czytane z bazy przy **każdym** żądaniu |

Weryfikacja: `server/tests/concurrency.test.ts` uruchamia **rzeczywiste procesy
systemowe** konkurujące o tę samą bazę danych.

---

## 6. Rozbudowa

### Nowy typ dokumentu

1. Dodaj kod do `CHECK` w `documents.doc_type` (nowa migracja).
2. Rozszerz `DOC_PERMISSION_PREFIX` w `core/permissions.ts`.
3. Dodaj walidację w `validateByType` (`documents.service.ts`).
4. Jeśli wpływa na stan — rozszerz `planMovements` i `STOCK_AFFECTING`.
5. Dodaj tłumaczenia `doc.<TYP>` w trzech słownikach.
6. Dodaj test przepływu.

### Nowa migracja

Nowy plik `server/src/db/migrations/00X_opis.sql`. Migracje wykonują się
w kolejności alfabetycznej, jednorazowo, w transakcji, z zapisem w tabeli
`schema_migrations`. **Nie modyfikuj już zastosowanych migracji.**

### Nowy język

1. `client/src/i18n/<kod>.ts` typowany jako `Dictionary` — kompilator wskaże
   brakujące klucze.
2. Wpis w `LOCALES` w `client/src/i18n/index.tsx`.
3. Rozszerzenie `CHECK (locale IN (...))` w tabeli `users` (nowa migracja).

---

## 7. Wydajność

- Indeksy na kolumnach filtrowanych i sortowanych (typ + data, status, magazyny,
  kontrahenci, produkt w pozycjach, znacznik czasu audytu).
- Stronicowanie wszystkich list po stronie bazy (`LIMIT`/`OFFSET`).
- Brak problemu N+1 — listy pobierane jednym zapytaniem ze złączeniami
  i podzapytaniami agregującymi.
- Filtrowanie po magazynach wykonywane w SQL, nie po pobraniu danych.
- Opóźnienie wyszukiwania w interfejsie ogranicza liczbę żądań podczas pisania.
- Anulowanie nieaktualnych żądań (`AbortController`) przy zmianie filtrów.
- Podział bundle: biblioteki w osobnym pliku (lepsze wykorzystanie cache).
  Rozmiar produkcyjny: ~345 kB, ~101 kB po kompresji gzip.

# API ResInvest ERP

Bazowy adres: `/api` (domyślnie `http://localhost:4000/api`)

Format: JSON, kodowanie UTF-8.

---

## Uwierzytelnianie

Każde żądanie poza `/auth/login`, `/auth/refresh` i `/health` wymaga nagłówka:

```
Authorization: Bearer <accessToken>
```

Magazyn roboczy przekazywany jest opcjonalnym nagłówkiem:

```
X-Warehouse-Id: 1
```

Serwer weryfikuje, czy użytkownik ma dostęp do wskazanego magazynu.
Rola, uprawnienia i lista magazynów odczytywane są z bazy **przy każdym
żądaniu**, dlatego odebranie uprawnień działa natychmiast.

### Cykl życia sesji

```
POST /auth/login       → accessToken (30 min) + refreshToken (14 dni)
   ↓ accessToken wygasa
POST /auth/refresh     → nowa para tokenów, poprzedni refreshToken unieważniony
   ↓
POST /auth/logout      → unieważnienie sesji
```

Ponowne użycie zużytego tokenu odświeżania unieważnia cały łańcuch sesji
(ochrona przed przejęciem tokenu).

---

## Format błędów

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Niewystarczający stan magazynowy do wykonania operacji.",
    "details": [
      {
        "warehouseId": 1,
        "warehouseName": "RiC Zabrze",
        "productId": 1,
        "productName": "Drewno opałowe",
        "available": 50,
        "required": 80
      }
    ]
  }
}
```

| Kod | HTTP | Znaczenie |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Dane wejściowe nie przeszły walidacji |
| `UNAUTHENTICATED` | 401 | Brak lub nieprawidłowy token |
| `INVALID_CREDENTIALS` | 401 | Błędny login lub hasło |
| `TOKEN_EXPIRED` | 401 | Sesja wygasła |
| `FORBIDDEN` | 403 | Brak uprawnienia |
| `WAREHOUSE_FORBIDDEN` | 403 | Brak dostępu do magazynu |
| `ACCOUNT_INACTIVE` | 403 | Konto nieaktywne |
| `ACCOUNT_LOCKED` | 403 | Konto zablokowane po nieudanych logowaniach |
| `NOT_FOUND` | 404 | Zasób nie istnieje |
| `CONFLICT` | 409 | Konflikt ze stanem danych |
| `DUPLICATE` | 409 | Rekord o takim kodzie już istnieje |
| `VERSION_CONFLICT` | 409 | Dokument zmieniony przez innego użytkownika |
| `INSUFFICIENT_STOCK` | 409 | Niewystarczający stan magazynowy |
| `INVALID_STATE` | 409 | Operacja niedozwolona dla statusu dokumentu |
| `IN_USE` | 409 | Rekord używany, zmiana niemożliwa |
| `PAYLOAD_TOO_LARGE` | 413 | Plik przekracza limit |
| `RATE_LIMITED` | 429 | Przekroczony limit żądań |
| `INTERNAL_ERROR` | 500 | Błąd serwera |

---

## Diagnostyka

### `GET /health`

Bez uwierzytelnienia.

```json
{ "status": "ok", "version": "1.1.0", "time": "2026-09-16T06:00:00.000Z" }
```

---

## Sesja — `/auth`

| Metoda | Ścieżka | Uprawnienie | Opis |
|---|---|---|---|
| POST | `/auth/login` | — | Logowanie |
| POST | `/auth/refresh` | — | Odświeżenie sesji |
| POST | `/auth/logout` | zalogowany | Wylogowanie |
| GET | `/auth/me` | zalogowany | Profil, uprawnienia, magazyny |
| PUT | `/auth/me/preferences` | zalogowany | Język, motyw, magazyn domyślny |
| POST | `/auth/me/password` | zalogowany | Zmiana własnego hasła |
| POST | `/auth/me/warehouse` | zalogowany | Zapis zmiany magazynu w historii |

**`POST /auth/login`**

```json
{ "login": "manager", "password": "Demo#2026" }
```

```json
{
  "accessToken": "eyJhbGciOi...",
  "refreshToken": "8c1f...c2a9",
  "accessExpiresAt": "2026-09-16T06:30:00.000Z",
  "refreshExpiresAt": "2026-09-30T06:00:00.000Z",
  "user": {
    "id": 2, "login": "manager", "fullName": "Anna Nowak (Manager)",
    "roleCode": "MANAGER", "roleName": "Manager",
    "locale": "pl", "theme": "system",
    "mustChangePassword": false, "defaultWarehouseId": 1,
    "permissions": ["pz.view", "pz.manage", "..."], "isAdmin": false
  },
  "warehouses": [{ "id": 1, "code": "ZAB", "name": "RiC Zabrze", "city": "Zabrze" }]
}
```

---

## Dokumenty — `/documents`

| Metoda | Ścieżka | Uprawnienie | Opis |
|---|---|---|---|
| GET | `/documents` | `<typ>.view` | Lista z filtrami i stronicowaniem |
| GET | `/documents/:id` | `<typ>.view` | Szczegóły z pozycjami i załącznikami |
| POST | `/documents` | `<typ>.manage` | Utworzenie dokumentu roboczego |
| PUT | `/documents/:id` | `<typ>.manage` | Edycja dokumentu roboczego |
| POST | `/documents/:id/post` | `<typ>.post` | Zatwierdzenie (księgowanie) |
| POST | `/documents/:id/cancel` | `<typ>.cancel` | Anulowanie (storno) |
| POST | `/documents/:id/correct` | `<typ>.cancel` + `.manage` | Korekta |
| DELETE | `/documents/:id` | `<typ>.manage` | Usunięcie dokumentu roboczego |

`<typ>` to `pz`, `wz`, `mm`, `prod`, `tr` lub `sd` — zgodnie z typem dokumentu.

### Parametry listy

| Parametr | Typ | Opis |
|---|---|---|
| `docType` | `PZ\|WZ\|MM\|PROD\|TR\|SD` | Typ dokumentu |
| `status` | `DRAFT\|POSTED\|CANCELLED` | Status |
| `warehouseId` | liczba | Magazyn (dowolna rola magazynu w dokumencie) |
| `partnerId` | liczba | Kontrahent |
| `productId` | liczba | Produkt występujący na pozycjach |
| `dateFrom`, `dateTo` | `YYYY-MM-DD` | Zakres dat operacji |
| `search` | tekst | Numer, numer obcy, uwagi, pojazd, kwit, kontrahent |
| `page`, `pageSize` | liczba | Stronicowanie (domyślnie 1 / 25, maks. 200) |
| `sort` | `docDate\|docNumber\|totalValue\|createdAt` | Sortowanie |
| `order` | `asc\|desc` | Kierunek |

Lista jest zawsze ograniczona do magazynów przypisanych użytkownikowi —
filtr wymuszany w zapytaniu SQL.

### Utworzenie dokumentu

```http
POST /api/documents
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "docType": "PROD",
  "docDate": "2026-09-16",
  "warehouseId": 1,
  "chippingMode": "EXTERNAL",
  "chippingCompany": "Usługi Leśne Dębowiec",
  "chippingRate": 14.5,
  "productionPlace": "Plac składowy Zabrze",
  "notes": "Rąbanie zlecone",
  "clientRequestId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "lines": [
    { "productId": 1, "role": "INPUT",  "qtyBase": 100 },
    { "productId": 2, "role": "OUTPUT", "qtyBase": 400, "qtyT": 145.5 }
  ]
}
```

- `clientRequestId` — opcjonalny klucz idempotencji. Powtórzone żądanie z tym
  samym kluczem zwraca istniejący dokument zamiast tworzyć duplikat.
- `qtyM3`, `qtyMp`, `qtyT` — opcjonalne wartości rzeczywiste. Pominięte
  wyliczają się z przeliczników. Podane są oznaczane jako ręczne i **nie
  wpływają na stan magazynowy**.
- `unitPrice` — cena podstawowa (zakupu dla PZ, sprzedaży dla WZ/SD).
- `costUnitPrice` — cena kosztowa (używana w sprzedaży bezpośredniej).

Odpowiedź: `201` z pełnym obiektem dokumentu (status `DRAFT`).

### Wymagania zależne od typu

| Typ | Wymagane |
|---|---|
| `PZ` | `warehouseId`, `supplierId`, pozycje o roli `STD` |
| `WZ` | `warehouseId`, `customerId`, pozycje `STD` |
| `MM` | `warehouseFromId` ≠ `warehouseToId`, pozycje `STD` |
| `PROD` | `warehouseId`, ≥1 pozycja `INPUT` i ≥1 `OUTPUT`; przy `chippingMode: "EXTERNAL"` również `chippingCompany` |
| `TR` | `carrierId` lub `vehiclePlate`, pozycje `STD` |
| `SD` | `supplierId`, `customerId`, pozycje `STD` |

### Zatwierdzenie, anulowanie, korekta

```http
POST /api/documents/12/post
{ "version": 1 }

POST /api/documents/12/cancel
{ "version": 2, "reason": "Błędna ilość na kwicie" }

POST /api/documents/12/correct
{ "version": 2, "reason": "Błędna ilość" }
```

Pole `version` chroni przed nadpisaniem zmian innego użytkownika.
Przy niezgodności zwracany jest `VERSION_CONFLICT`.

`correct` anuluje oryginał i zwraca (`201`) nowy dokument roboczy będący jego
kopią, z wypełnionym `correctionOfId`.

---

## Stany magazynowe — `/stock`

| Metoda | Ścieżka | Uprawnienie | Opis |
|---|---|---|---|
| GET | `/stock` | `stock.view` | Salda z przeliczeniem na m³ / MP / t |
| GET | `/stock/movements` | `stock.view` | Kartoteka ruchów (stronicowana) |
| GET | `/stock/dashboard` | `stock.view` | Dane pulpitu |
| GET | `/stock/integrity` | `admin.backup` | Kontrola zgodności sald z księgą ruchów |

`GET /stock/integrity` zwraca `{ "consistent": true, "mismatches": [] }`,
gdy salda zgadzają się z sumą ruchów.

---

## Raporty — `/reports`

| Metoda | Ścieżka | Uprawnienie | Opis |
|---|---|---|---|
| GET | `/reports/summary` | `reports.view` | Obroty wg typu, produktu i miesiąca |
| GET | `/reports/production` | `reports.view` | Produkcja, wydajność, koszt rąbania |
| GET | `/reports/transport` | `reports.view` | Trasy, koszty, wskaźniki jednostkowe |
| GET | `/reports/partners` | `reports.view` | Zakupy i sprzedaż wg kontrahenta |
| GET | `/reports/export` | `reports.export` | Eksport CSV |

Parametry okresu (wspólne):

| Parametr | Opis |
|---|---|
| `mode` | `month` (domyślnie), `year`, `range` |
| `month` | `YYYY-MM` dla `mode=month` |
| `year` | rok dla `mode=year` |
| `dateFrom`, `dateTo` | wymagane dla `mode=range` |
| `warehouseId` | ograniczenie do magazynu |

`GET /reports/export` przyjmuje dodatkowo `kind`: `documents`, `stock`
lub `movements`. Zwraca CSV (separator `;`, UTF-8 z BOM, przecinek dziesiętny) —
plik otwiera się poprawnie w Microsoft Excel.

---

## Historia zmian — `/audit`

| Metoda | Ścieżka | Uprawnienie | Opis |
|---|---|---|---|
| GET | `/audit` | `audit.view` | Wpisy z filtrami i stronicowaniem |
| GET | `/audit/facets` | `audit.view` | Słowniki do filtrów |

Filtry: `module`, `action`, `entityType`, `entityId`, `userId`, `warehouseId`,
`dateFrom`, `dateTo`, `search`, `page`, `pageSize`.

```json
{
  "id": 142,
  "occurredAt": "2026-09-16T08:42:11.204Z",
  "userLogin": "zabrze",
  "userName": "Jan Kowalski (Zabrze)",
  "action": "POST",
  "module": "production",
  "entityType": "document",
  "entityId": "17",
  "entityLabel": "PROD/2026/ZAB/0124",
  "warehouseId": 1,
  "ip": "192.168.1.31",
  "changes": [
    { "field": "status", "before": "DRAFT", "after": "POSTED" },
    { "field": "movements", "before": 0, "after": 2 }
  ]
}
```

Historia jest **tylko do odczytu** — nie ma endpointów modyfikujących,
a baza danych blokuje zmiany wyzwalaczami.

---

## Załączniki

| Metoda | Ścieżka | Uprawnienie | Opis |
|---|---|---|---|
| POST | `/documents/:id/attachments` | `attachments.manage` | Dodanie skanu (`multipart/form-data`, pole `file`) |
| GET | `/attachments/:attachmentId` | dostęp do dokumentu | Pobranie pliku |
| DELETE | `/attachments/:attachmentId` | `attachments.manage` | Usunięcie |

Dozwolone typy: `image/jpeg`, `image/png`, `image/webp`, `image/heic`,
`application/pdf`. Limit: `MAX_UPLOAD_MB` (domyślnie 15 MB).
Dla każdego pliku zapisywana jest suma SHA-256.

---

## Słowniki

| Metoda | Ścieżka | Uprawnienie | Opis |
|---|---|---|---|
| GET | `/warehouses` | zalogowany | Magazyny użytkownika (`?all=true` — wszystkie, wymaga `admin.warehouses`) |
| POST | `/warehouses` | `admin.warehouses` | Nowy magazyn |
| PUT | `/warehouses/:id` | `admin.warehouses` | Edycja |
| GET | `/warehouses/:id/usage` | `admin.warehouses` | Liczba powiązanych dokumentów, ruchów i użytkowników |
| GET | `/products` | zalogowany | Produkty (`?includeInactive`, `?search`, `?kind`) |
| POST · PUT | `/products` · `/products/:id` | `admin.products` | Zarządzanie produktami |
| GET | `/partners` | zalogowany | Kontrahenci (`?role=supplier\|customer\|carrier\|forestry`) |
| POST · PUT | `/partners` · `/partners/:id` | `admin.partners` | Zarządzanie kontrahentami |

---

## Użytkownicy i uprawnienia — `/users`

| Metoda | Ścieżka | Uprawnienie | Opis |
|---|---|---|---|
| GET | `/users` | `admin.users` | Lista kont |
| POST | `/users` | `admin.users` | Nowe konto |
| PUT | `/users/:id` | `admin.users` | Edycja konta |
| POST | `/users/:id/reset-password` | `admin.users` | Reset hasła |
| GET | `/users/roles` | `admin.users` | Role z uprawnieniami i katalog uprawnień |
| PUT | `/users/roles/:id/permissions` | `admin.users` | Zmiana uprawnień roli |

Zabezpieczenia:

- w systemie musi pozostać co najmniej **jeden aktywny administrator**;
- nie można dezaktywować własnego konta;
- rola `ADMIN` ma stały zestaw uprawnień;
- zmiana roli, magazynów lub statusu konta **unieważnia aktywne sesje**
  danego użytkownika.

---

## Ustawienia — `/settings`

| Metoda | Ścieżka | Uprawnienie | Opis |
|---|---|---|---|
| GET | `/settings` | zalogowany | Dane firmy, przeliczniki, stawki, polityka stanów |
| PUT | `/settings` | `admin.settings` | Zapis sekcji ustawień |
| GET | `/settings/backups` | `admin.backup` | Lista kopii zapasowych |
| POST | `/settings/backups` | `admin.backup` | Utworzenie kopii |

```json
PUT /api/settings
{ "key": "conversion", "value": { "m3PerMp": 0.25, "tPerMp": 0.33 } }
```

Klucze: `company`, `conversion`, `rates`, `stockPolicy`.

---

## Katalog uprawnień

| Grupa | Uprawnienia |
|---|---|
| Dokumenty | `pz.*`, `wz.*`, `mm.*`, `prod.*`, `tr.*`, `sd.*` — każde z akcjami `view`, `manage`, `post`, `cancel` |
| Magazyn | `stock.view`, `stock.allow_negative` |
| Zestawienia | `reports.view`, `reports.export`, `audit.view` |
| Załączniki | `attachments.manage` |
| Administracja | `admin.users`, `admin.warehouses`, `admin.products`, `admin.partners`, `admin.settings`, `admin.backup` |

---

## Limity żądań

| Zakres | Limit |
|---|---|
| `/auth/login` | 30 żądań / 15 min / adres IP |
| `/auth/refresh` | 120 żądań / 15 min / adres IP |
| pozostałe `/api` | 600 żądań / min / adres IP |

Po przekroczeniu: `429` z nagłówkiem `Retry-After`.

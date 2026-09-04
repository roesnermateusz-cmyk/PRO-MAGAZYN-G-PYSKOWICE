# API — punkty końcowe

Bazowy adres: `/api/v1`
Format: JSON (UTF-8). Uwierzytelnianie: `Authorization: Bearer <accessToken>`.

---

## 1. Konwencje

### Odpowiedź błędu

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Formularz zawiera błędy — popraw zaznaczone pola.",
    "details": [{ "field": "quantity", "message": "Pole „Wolumen” jest wymagane." }]
  }
}
```

| Kod HTTP | `code` | Znaczenie |
|---|---|---|
| 400 | `BAD_REQUEST` | Nieprawidłowa treść żądania (np. uszkodzony JSON) |
| 401 | `UNAUTHORIZED` | Brak tokenu, token wygasł lub jest nieprawidłowy |
| 403 | `FORBIDDEN` | Rola nie ma wymaganego uprawnienia |
| 404 | `NOT_FOUND` | Zasób nie istnieje |
| 405 | `METHOD_NOT_ALLOWED` | Metoda niedozwolona dla tej ścieżki |
| 409 | `CONFLICT` / `PERIOD_CLOSED` | Konflikt ze stanem danych / okres zamknięty |
| 413 | `PAYLOAD_TOO_LARGE` | Przekroczony limit rozmiaru |
| 422 | `VALIDATION_ERROR` | Błędy walidacji z listą pól |
| 429 | `TOO_MANY_REQUESTS` | Przekroczony limit żądań (nagłówek `Retry-After`) |
| 500 | `INTERNAL_ERROR` | Błąd serwera (szczegóły wyłącznie w dzienniku) |

### Stronicowanie

Parametry `limit` (domyślnie 50) i `offset`. Odpowiedź zawiera
`page: { total, limit, offset }`, a listy dokumentów dodatkowo `totals`
z podsumowaniem całego wyniku filtrowania — nie tylko bieżącej strony.

### Uprawnienia

| Uprawnienie | ADMIN | KIEROWNIK | MAGAZYNIER | KSIEGOWY | AUDYTOR |
|---|:--:|:--:|:--:|:--:|:--:|
| `operations:read` | ✔ | ✔ | ✔ | ✔ | ✔ |
| `operations:write` | ✔ | ✔ | ✔ | – | – |
| `operations:cancel` | ✔ | ✔ | – | – | – |
| `catalog:write` | ✔ | ✔ | ✔ | – | – |
| `reports:read` / `stock:read` | ✔ | ✔ | ✔ | ✔ | ✔ |
| `corrections:read` | ✔ | ✔ | ✔ | ✔ | ✔ |
| `periods:close` | ✔ | ✔ | – | – | – |
| `backup:export` | ✔ | ✔ | – | ✔ | – |
| `backup:import` | ✔ | ✔ | – | – | – |
| `settings:write` | ✔ | ✔ | – | – | – |
| `users:read` | ✔ | ✔ | – | – | – |
| `users:write` | ✔ | – | – | – | – |

---

## 2. Trasy publiczne

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/health` | Kontrola stanu usługi (monitoring, skrypt startowy) |
| GET | `/meta` | Dane firmy, role, typy operacji, jednostki, limity |

---

## 3. Uwierzytelnianie

| Metoda | Ścieżka | Opis |
|---|---|---|
| POST | `/auth/login` | `{ email, password }` → tokeny + profil |
| POST | `/auth/refresh` | `{ refreshToken }` → nowa para tokenów (rotacja) |
| POST | `/auth/logout` | `{ refreshToken, allDevices? }` |
| GET | `/auth/me` | Profil zalogowanego wraz z uprawnieniami |
| POST | `/auth/change-password` | `{ currentPassword, newPassword }` |

```json
// POST /auth/login → 200
{
  "accessToken": "eyJhbGciOi…",
  "refreshToken": "Xy7…",
  "expiresIn": 1800,
  "user": { "id": "…", "fullName": "Anna Kowalczyk", "role": "KIEROWNIK", "permissions": ["operations:read", "…"] }
}
```

Limit: 10 prób logowania na 5 minut z jednego adresu IP.

---

## 4. Dokumenty magazynowe

| Metoda | Ścieżka | Uprawnienie |
|---|---|---|
| GET | `/operations` | `operations:read` |
| GET | `/operations/export.csv` | `operations:read` |
| POST | `/operations` | `operations:write` |
| POST | `/operations/chain` | `operations:write` |
| GET | `/operations/:id` | `operations:read` |
| PATCH | `/operations/:id` | `operations:write` |
| POST | `/operations/:id/cancel` | `operations:cancel` |
| GET | `/operations/:id/corrections` | `corrections:read` |
| GET/POST | `/operations/:id/attachments` | `attachments:read` / `:write` |

### Filtry listy

`q`, `type`, `productId`, `warehouseId`, `partnerId`, `month` (RRRR-MM),
`dateFrom`, `dateTo`, `status` (`POSTED` \| `CANCELLED` \| `ALL`), `chainRef`,
`sort` (`date` \| `doc` \| `value`), `order`, `limit`, `offset`.

### Utworzenie dokumentu

```json
// POST /operations
{
  "type": "ZAKUP",
  "operationDate": "2026-09-04",
  "productName": "Drewno opałowe z lasu",
  "quantity": 100, "unit": "M3",
  "supplierName": "Nadleśnictwo Rudy Raciborskie",
  "forestDistrict": "Rudy Raciborskie", "forestRange": "Kuźnia",
  "haulageNoteNo": "KW/20260904/01",
  "certificate": "KZR",
  "pricePurchase": 95,
  "carrierName": "Trans-Bio", "vehiclePlate": "SZA 4512C",
  "distanceKm": 42, "transportCost": 1200,
  "signature": "Piotr Nowak"
}
```

```json
// → 201
{
  "operation": {
    "docNo": "PZ/2026/000123",
    "qtyM3": 100, "qtyMp": 400, "qtyTonne": 132, "energyGj": 1122,
    "valuePurchase": 9500,
    "factors": { "m3ToMp": 4, "mpToTonne": 0.33, "tonneToGj": 8.5 },
    "status": "POSTED"
  },
  "warnings": []
}
```

`warnings` zawiera ostrzeżenia niepowodujące odrzucenia zapisu — na przykład
zejście stanu poniżej zera przy włączonej regule tolerancji.

**Typy i serie:** ZAKUP→PZ, SPRZEDAZ→WZ, PRODUKCJA→PW, ZUZYCIE→RW, MM→MM, BO→BO.
Numer nadaje system; pole `docNo` w żądaniu jest ignorowane.

### Łańcuch terenowy

Jedno żądanie księguje komplet dokumentów jednego zdarzenia w lesie.

```json
// POST /operations/chain
{
  "purchase": { /* jak w POST /operations, type = ZAKUP */ },
  "chain": {
    "produceChips": true,
    "sellDirectly": true,
    "chipProductName": "Zrębka Produkcyjna Leśna",
    "chipQuantityMp": 380,
    "saleRecipient": "Elektrownia Rybnik",
    "salePrice": 72,
    "saleUnit": "MP"
  }
}
```

```json
// → 201
{
  "chainRef": "PZ/2026/000123",
  "operations": [
    { "docNo": "PZ/2026/000123", "type": "ZAKUP" },
    { "docNo": "RW/2026/000045", "type": "ZUZYCIE" },
    { "docNo": "PW/2026/000045", "type": "PRODUKCJA" },
    { "docNo": "WZ/2026/000067", "type": "SPRZEDAZ" }
  ],
  "warnings": []
}
```

Podział kosztów: cena surowca na PZ, koszt rąbania na PW, transport i kwit
wywozowy na dokumencie faktycznego wywozu (PW przy dostawie na plac, WZ przy
sprzedaży prosto z lasu).

### Edycja i storno

`PATCH /operations/:id` przyjmuje dowolny podzbiór pól plus wymagane
`correctionReason`. Odpowiedź zawiera listę zmian zapisanych w rejestrze korekt.

`POST /operations/:id/cancel` wymaga `{ "reason": "…" }` (min. 5 znaków).
Ogniwa łańcucha muszą być anulowane razem.

---

## 5. Kartoteki

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/catalog` | Komplet kartotek jednym żądaniem (dla formularza) |
| GET/POST | `/warehouses`, `/products`, `/partners`, `/vehicles` | Lista i dodawanie |
| PATCH | `/warehouses/:id`, `/products/:id`, `/partners/:id`, `/vehicles/:id` | Edycja |
| POST | `/products/:id/deactivate` | Wyłączenie (tylko przy stanie zerowym) |
| GET/POST | `/forest/districts`, `/forest/ranges` | Nadleśnictwa i leśnictwa |
| GET | `/loading-places` | Miejsca załadunku |

---

## 6. Stany magazynowe

| Metoda | Ścieżka | Parametry |
|---|---|---|
| GET | `/stock` | `date`, `warehouseId`, `productId`, `includeZero` |
| GET | `/stock/ledger` | `productId` *(wymagany)*, `warehouseId`, `dateFrom`, `dateTo` |
| GET | `/stock/negative` | — |
| GET | `/stock/export.csv` | jak `/stock` |

`/stock/ledger` zwraca chronologiczną kartotekę z saldem narastającym
(`opening`, pozycje z `balanceMp`, `closing`).

---

## 7. Raporty

| Metoda | Ścieżka | Parametry |
|---|---|---|
| GET | `/reports/dashboard` | `month` |
| GET | `/reports/monthly` | `month` *(wymagany)*, `warehouseId` |
| GET | `/reports/monthly/export.csv` | `month` |
| GET | `/reports/production-days` | `limit` |
| GET | `/reports/production-day` | `date` *(wymagany)* |
| GET | `/reports/transport` | `dateFrom`, `dateTo` *(wymagane)* |
| GET | `/reports/partners` | `dateFrom`, `dateTo` *(wymagane)* |
| GET | `/reports/certification` | `dateFrom`, `dateTo` *(wymagane)* |

Raport miesięczny zwraca dla każdego produktu domykający się bilans:

```
opening + purchase + production − consumption − sale = closing
```

---

## 8. Korekty, okresy, ustawienia

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/corrections` | Rejestr korekt (`operationId`, `q`, `dateFrom`, `dateTo`) |
| GET | `/corrections/:id` | Pojedynczy wpis wraz z migawką stanu |
| POST | `/corrections/:id/restore` | Przywrócenie stanu sprzed korekty |
| GET | `/periods` | Lista okresów ze statusem i obrotami |
| POST | `/periods/:month/close` | Zamknięcie miesiąca (`{ note? }`) |
| POST | `/periods/:month/reopen` | Otwarcie (`{ reason }` — wymagane) |
| GET/PUT | `/settings` | Przeliczniki i reguły księgowania |

---

## 9. Załączniki

```json
// POST /operations/:id/attachments
{
  "filename": "kwit-wywozowy.jpg",
  "mimeType": "image/jpeg",
  "dataBase64": "/9j/4AAQSkZJRgABAQ…",
  "kind": "KWIT"
}
```

Dozwolone typy: `image/jpeg`, `image/png`, `image/webp`, `image/heic`,
`application/pdf`. Limit rozmiaru z `ATTACHMENTS_MAX_MB` (domyślnie 12 MB).
Aplikacja kliencka zmniejsza zdjęcia do 1600 px przed wysyłką.

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/attachments/:id` | Metadane |
| GET | `/attachments/:id/content` | Zawartość (`?download=true` wymusza pobranie) |
| DELETE | `/attachments/:id` | Usunięcie (magazynier — tylko własne) |

---

## 10. Administracja i dane

| Metoda | Ścieżka | Uprawnienie |
|---|---|---|
| GET/POST | `/users` | `users:read` / `users:write` |
| PATCH | `/users/:id` | `users:write` |
| GET | `/users/:id/sessions` | `users:read` |
| GET | `/audit` | `users:read` |
| GET | `/backup/list` | `backup:export` |
| POST | `/backup/create` | `backup:export` |
| GET | `/backup/export.json` | `backup:export` |
| POST | `/backup/import` | `backup:import` |

Import (`{ mode: "merge" \| "replace", payload }`) zawsze poprzedza automatyczna
kopia bieżącej bazy. W trybie `merge` dokumenty o istniejących numerach są
pomijane, a licznik numeracji podnoszony do najwyższego zaimportowanego numeru.

---

## 11. Przykład integracji

```bash
API=http://localhost:4173/api/v1

TOKEN=$(curl -s -X POST $API/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"integracja@firma.pl","password":"…"}' | jq -r .accessToken)

# Stan magazynowy na koniec miesiąca
curl -s "$API/stock?date=2026-09-30" -H "Authorization: Bearer $TOKEN" | jq '.byProduct'

# Raport miesięczny
curl -s "$API/reports/monthly?month=2026-09" -H "Authorization: Bearer $TOKEN" | jq '.summary'

# Rejestr do księgowości
curl -s "$API/operations/export.csv?month=2026-09" -H "Authorization: Bearer $TOKEN" -o wrzesien.csv
```

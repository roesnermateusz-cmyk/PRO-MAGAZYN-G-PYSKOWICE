# Architektura systemu ResInvest ERP

Dokument opisuje strukturę techniczną systemu, przyjęte decyzje projektowe wraz
z uzasadnieniem oraz ścieżkę rozwoju na kolejne lata.

---

## 1. Kontekst biznesowy

System obsługuje obrót biomasą leśną w firmie handlowo-produkcyjnej:

```
  NADLEŚNICTWO          LAS / DROGA LEŚNA           PLAC              ELEKTROWNIA
       │                        │                     │                    │
       │  zakup drewna          │  rębak przerabia     │  magazynowanie     │  sprzedaż
       │  (m³, kwit wywozowy)   │  drewno na zrębkę    │  zrębki (MP)       │  (MP / tony / GJ)
       ▼                        ▼                     ▼                    ▼
      PZ ───────────────────► RW + PW ──────────────► stan ──────────────► WZ
```

Charakterystyka, która ukształtowała architekturę:

| Cecha | Konsekwencja projektowa |
|---|---|
| Praca w terenie, na telefonie, przy słabym zasięgu | Interfejs responsywny, lekki, bez ciężkiego frameworka |
| Certyfikacja KZR INiG / SURE | Pełna ścieżka pochodzenia surowca i nieusuwalny dziennik audytu |
| Kontrole skarbowe i audyty | Dokumenty nieusuwalne (storno), rejestr korekt „przed → po” |
| Trzy jednostki miary jednocześnie (m³, MP, tony) + GJ | Wydzielony silnik przeliczeń z zapisem użytych przeliczników |
| Wdrożenie on-premise, bez działu IT | Zero zależności npm, instalator ZIP, kopie automatyczne |
| Perspektywa wieloletnia | Migracje wersjonowane, API wersjonowane, warstwowa struktura modułów |

---

## 2. Widok ogólny

```
┌──────────────────────────────────────────────────────────────────────────┐
│  PRZEGLĄDARKA (desktop w biurze · telefon w terenie)                     │
│                                                                          │
│   web/index.html ──► web/src/main.js                                     │
│        │                    │                                            │
│        │              router (hash)  ──►  views/*.js  ──►  core/ui.js    │
│        │                    │                                            │
│        │              core/store.js (sesja, kartoteki, uprawnienia)      │
│        │                    │                                            │
│        └────────────► core/api.js  (fetch + JWT + auto-refresh)          │
└─────────────────────────────┬────────────────────────────────────────────┘
                              │ HTTPS / JSON
┌─────────────────────────────▼────────────────────────────────────────────┐
│  SERWER  (Node.js 22, zero zależności npm)                               │
│                                                                          │
│   lib/http.js — router, CORS, nagłówki bezpieczeństwa, pliki statyczne    │
│         │                                                                │
│   middleware/  auth (JWT + RBAC) · audit · rateLimit                     │
│         │                                                                │
│   modules/     auth · users · catalog · operations · stock · reports     │
│                periods · corrections · attachments · settings · backup   │
│         │              (routes → service → db)                           │
│   domain/      units.js · documents.js · stock.js       ← czysta logika  │
│         │                                                                │
│   db/          SQLite (WAL) + migracje wersjonowane                      │
└─────────────────────────────┬────────────────────────────────────────────┘
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
      data/resinvest.db   data/attachments  data/backups
      (baza, WAL)         (skany kwitów)    (kopie dobowe)
```

---

## 3. Decyzje projektowe

### 3.1 Zero zależności npm w warstwie serwera

System jest wdrażany na komputerze w biurze magazynu — często bez dostępu
administracyjnego i bez pewnego dostępu do rejestru npm.

**Konsekwencje pozytywne:** instalacja działa offline, brak ryzyka podatności w
łańcuchu dostaw, brak konieczności aktualizowania dziesiątek pakietów, pakiet ZIP
ma kilkaset kilobajtów zamiast dziesiątek megabajtów.

**Koszt:** własny mini-router HTTP (`lib/http.js`, ~300 linii), własny walidator
(`lib/validate.js`) i własne podpisywanie JWT (`lib/crypto.js` na `node:crypto`).
Zakres jest świadomie ograniczony do tego, czego API faktycznie używa.

### 3.2 SQLite zamiast PostgreSQL

Skala docelowa: 1 lokalizacja, kilku–kilkunastu użytkowników, rzędu 10–50 tysięcy
dokumentów rocznie. SQLite w trybie WAL obsługuje to z dużym zapasem, a plik bazy
jest trywialny do skopiowania i zarchiwizowania.

Cały dostęp przechodzi przez `server/src/db/index.js`, a zapytania używają
przenośnego SQL. Migracja na PostgreSQL to podmiana implementacji `db`
(szczegóły w [DATABASE.md](DATABASE.md#migracja-na-postgresql)).

### 3.3 Księga ruchów zamiast pola „stan”

Stan magazynowy **nigdy nie jest przechowywany jako liczba aktualizowana w
miejscu**. Dokument (`operations`) generuje ruchy (`stock_moves`), a stan to
suma ruchów.

```sql
SELECT SUM(qty_mp) FROM stock_moves WHERE warehouse_id = ? AND product_id = ?;
```

Dzięki temu:

* rozjazd stanu jest niemożliwy z definicji,
* storno = usunięcie ruchów dokumentu (spójność automatyczna),
* stan na dowolny dzień to ten sam SELECT z warunkiem `move_date <= ?`,
* kartoteka magazynowa z saldem narastającym powstaje bez dodatkowych struktur.

### 3.4 Przeliczniki zapisane w dokumencie

Każdy dokument przechowuje `qty_m3`, `qty_mp`, `qty_tonne`, `energy_gj` **oraz**
użyte przeliczniki (`factor_m3_mp`, `factor_mp_tonne`, `factor_tonne_gj`).

Zmiana przelicznika w ustawieniach dotyczy wyłącznie nowych dokumentów. Raport za
marzec wygląda tak samo w kwietniu i za trzy lata — co jest warunkiem koniecznym
przy kontroli i przy certyfikacji.

> **Zmiana względem arkusza kalkulacyjnego.** Poprzednia wersja liczyła masę wprost
> z wolumenu wejściowego (`tony = m³ × 0,33`), pomijając krok m³ → MP. Tutaj
> obowiązuje spójny łańcuch **m³ → MP → tony → GJ**. Kalibrację rzeczywistą
> uzyskuje się przez przeliczniki indywidualne produktu albo wagę rzeczywistą
> w dokumencie.

### 3.5 Osobne serie dokumentów dla ogniw łańcucha

W poprzedniej wersji zakup, zużycie i produkcja dzieliły jeden numer PZ, przez co
dokumenty były nierozróżnialne w rejestrze. Tutaj każde ogniwo ma własny numer we
właściwej serii (PZ / RW / PW / WZ), a powiązanie utrzymuje pole `chain_ref`.

### 3.6 Dokumenty nieusuwalne

`DELETE` na dokumencie nie istnieje w API. Zamiast tego:

* **storno** — `status = 'CANCELLED'`, ruchy usunięte, przyczyna wymagana,
* **korekta** — pełna migawka stanu sprzed zmiany trafia do `corrections`,
* **przywrócenie** — tworzy kolejną korektę, nie nadpisuje historii.

---

## 4. Warstwy i zależności

Zależności biegną wyłącznie w jednym kierunku:

```
routes  ──►  service  ──►  domain
   │            │            │
   └────────────┴────────►  lib / db
```

| Warstwa | Odpowiedzialność | Czego NIE robi |
|---|---|---|
| `domain/` | Czysta logika: przeliczenia, ruchy, numeracja | Nie dotyka bazy ani HTTP |
| `modules/*/\*.service.js` | Reguły biznesowe, transakcje, audyt | Nie zna nagłówków HTTP |
| `modules/*/\*.routes.js` | Mapowanie HTTP → serwis, uprawnienia | Nie zawiera logiki biznesowej |
| `middleware/` | Uwierzytelnianie, RBAC, audyt, limity | Nie zna konkretnych encji |
| `lib/` | Narzędzia bez wiedzy domenowej | — |

Reguła praktyczna: **jeśli funkcję da się przetestować bez bazy danych, jej
miejsce jest w `domain/`.**

---

## 5. Transakcyjność

`db.tx()` obsługuje zagnieżdżanie przez `SAVEPOINT`, więc serwisy komponują się
swobodnie — `createChain` wywołuje `createOperation` cztery razy, a całość jest
jedną transakcją. Awaria ostatniego dokumentu wycofuje wszystkie.

W jednej transakcji powstają zawsze razem:

```
dokument  +  ruchy magazynowe  +  wpis korekty  +  wpis audytu
```

---

## 6. Bezpieczeństwo

| Obszar | Rozwiązanie |
|---|---|
| Hasła | `scrypt` (N=16384, r=8, p=1), sól per konto, porównanie w czasie stałym |
| Sesje | JWT HS256 (30 min) + token odświeżania w bazie jako SHA-256, rotowany przy każdym użyciu |
| Blokada konta | Po `AUTH_MAX_FAILED` nieudanych próbach — blokada czasowa |
| Enumeracja kont | Identyczny komunikat i stały koszt obliczeniowy dla nieznanego e-maila |
| Limit żądań | Okno przesuwne na logowaniu, odświeżaniu i eksportach |
| RBAC | 5 ról, uprawnienia elementarne, kontrola w warstwie tras |
| SQL injection | Wyłącznie zapytania parametryzowane |
| XSS | `esc()` na każdej wartości wstawianej do szablonu; skany serwowane z restrykcyjnym CSP |
| Path traversal | Normalizacja i weryfikacja prefiksu przy serwowaniu plików |
| Wyciek błędów | Stos wyjątku nigdy nie trafia do odpowiedzi w trybie produkcyjnym |
| Dane wrażliwe w logach | Lista pól maskowanych w `lib/logger.js` |
| Audyt | `audit_log` — logowania, zapisy, storno, eksporty, zamknięcia okresów |

---

## 7. Skalowanie

System jest zbudowany tak, by rósł etapami — bez przepisywania.

**Dziś (1 lokalizacja, do ~15 użytkowników)**
Jeden proces Node, SQLite WAL, kopie dobowe. Zasoby: ~80 MB RAM.

**Etap 2 — więcej użytkowników i lokalizacji**
1. Podmiana implementacji `db` na PostgreSQL (schemat jest przenośny).
2. Przeniesienie limitów żądań z pamięci procesu do Redis (`middleware/rateLimit.js`).
3. Kilka instancji Node za reverse proxy — warstwa aplikacji jest bezstanowa
   (sesje żyją w bazie, nie w pamięci).
4. Załączniki na współdzielonym wolumenie albo w S3 (interfejs w `attachments.service.js`).

**Etap 3 — integracje**
API jest wersjonowane (`/api/v1`), więc integracje księgowe, wagowe i wymiana
danych z elektrowniami mogą powstawać bez ryzyka zepsucia aplikacji klienckiej.

**Wydajność raportów.** Wszystkie zestawienia to agregaty SQL — czas odpowiedzi
nie zależy od liczby dokumentów w rejestrze, tylko od liczby wierszy w wyniku.
Indeksy pokrywają filtry używane przez interfejs (patrz [DATABASE.md](DATABASE.md)).

---

## 8. Kierunki rozwoju

Wypisane w kolejności wynikającej z wartości dla firmy:

1. **Generowanie PDF dokumentów** (PZ/WZ z pieczątką) po stronie serwera.
2. **Praca offline** — Service Worker + kolejka zapisów w IndexedDB dla terenu.
3. **Integracja z wagą samochodową** — automatyczne uzupełnianie masy rzeczywistej.
4. **Umowy i kontrakty** — limity wolumenu i cen per kontrahent.
5. **Rozliczenie kosztów per pryzma** — średnia ważona zamiast wartości dokumentu.
6. **Eksport JPK / integracja z księgowością**.
7. **Powiadomienia** — próg stanu, brakujące kwity, otwarty okres po terminie.

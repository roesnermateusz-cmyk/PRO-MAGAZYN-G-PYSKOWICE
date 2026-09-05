# Architektura interfejsu

Aplikacja kliencka to jednostronicowa aplikacja w natywnych modułach ES —
**bez kroku budowania**. Pliki z katalogu `web/` trafiają do przeglądarki tak,
jak leżą na dysku.

---

## 1. Dlaczego bez frameworka i bez bundlera

| Powód | Szczegół |
|---|---|
| Wdrożenie u klienta | Zmiana etykiety to edycja pliku i odświeżenie strony — bez `npm install`, bez `build` |
| Czas ładowania w terenie | ~90 kB kodu bez zależności; przy słabym zasięgu ma to znaczenie |
| Trwałość | Natywny ESM będzie działał za 5 lat bez migracji między wersjami frameworka |
| Debugowanie | Kod w przeglądarce to ten sam kod, który leży w repozytorium — bez map źródeł |

Koszt: brak reaktywności „z pudełka”. Rozwiązanie: widoki renderują HTML jako
tekst i przerysowują się w całości po zmianie danych. Przy skali tego systemu
(tabele do kilkuset wierszy) jest to szybsze niż warstwa różnicowania DOM.

---

## 2. Struktura katalogów

```
web/
├── index.html                 szkielet + elementy globalne (toast, modal, lightbox)
├── manifest.webmanifest       instalacja jako aplikacja na telefonie
├── assets/
│   ├── app.css                komplet stylów (tokeny, komponenty, responsywność, wydruk)
│   └── favicon.svg
└── src/
    ├── main.js                bootstrap: sesja → ekran → trasy
    ├── core/
    │   ├── api.js             fetch + JWT + automatyczne odświeżanie tokenu
    │   ├── store.js           stan sesji, kartoteki, uprawnienia
    │   ├── router.js          router na fragmencie adresu (#/…)
    │   ├── dom.js             esc(), delegacja zdarzeń, obsługa formularzy
    │   ├── format.js          liczby, kwoty, daty w konwencji polskiej
    │   └── ui.js              toast, modal, nagłówki, tabele, wskaźniki
    ├── components/
    │   ├── icons.js           ikony SVG
    │   └── layout.js          sidebar, pasek zakładek, narzędzia globalne
    └── views/                 po jednym pliku na ekran
        ├── login.js           logowanie + wymuszona zmiana hasła
        ├── dashboard.js       pulpit
        ├── operations.js      rejestr + podgląd dokumentu
        ├── operation-form.js  formularz dokumentu i łańcucha
        ├── stock.js           stany + kartoteka magazynowa
        ├── production.js      kwit produkcji dnia
        ├── reports.js         raporty (4 zakładki)
        ├── corrections.js     rejestr korekt
        ├── catalog.js         kartoteki
        ├── periods.js         okresy rozliczeniowe
        ├── users.js           konta i dziennik audytu
        └── settings.js        przeliczniki, reguły, kopie zapasowe
```

---

## 3. Cykl życia

```
main.js
  │
  ├─ loadMeta()                     dane firmy i słowniki (bez logowania)
  ├─ restoreSession()               odtworzenie sesji z tokenu odświeżania
  │      │
  │      ├─ brak sesji ────────────► renderLogin()
  │      └─ sesja OK ──────────────► startApp()
  │                                     │
  │                                     ├─ mustChangePassword → renderPasswordChange()
  │                                     ├─ renderLayout()      sidebar / tabbar wg uprawnień
  │                                     └─ startRouter()
  │                                            │
  └────────────────────────────────────────────┴─ resolve(): guard → widok → #view
```

Utrata sesji w dowolnym momencie (`onUnauthorized`) sprowadza użytkownika na
ekran logowania bez przeładowania strony.

---

## 4. Router

Adresy w formie `#/operacje/123?tab=x`. Wybór fragmentu adresu zamiast History
API jest celowy: aplikacja działa z dowolnego podkatalogu, zza dowolnego proxy
i po otwarciu wprost z pliku, bez konfiguracji przepisywania URL.

```js
route('operacje', renderOperations);          // rejestracja widoku
setGuard((id) => { /* kontrola uprawnień */ });  // przed każdą nawigacją
navigate('/operacje/123');                     // przejście
```

Strażnik (`setGuard`) sprawdza uprawnienie przypisane do pozycji nawigacji.
Widok bez uprawnienia nie zostanie otwarty nawet po wpisaniu adresu ręcznie —
niezależnie od kontroli po stronie serwera, która jest właściwym zabezpieczeniem.

Wyjątek rzucony w widoku jest przechwytywany i pokazywany w obszarze widoku —
błąd jednego ekranu nie wywraca aplikacji.

---

## 5. Warstwa danych

`core/api.js`:

* token dostępu **wyłącznie w pamięci** (krótkie życie ogranicza skutki wycieku),
* token odświeżania w `localStorage` (przetrwanie odświeżenia strony),
* odpowiedź 401 → jedno wspólne odświeżenie dla równoległych żądań → ponowienie,
* `api.download()` obsługuje pobieranie plików z nagłówkiem `Authorization`,
* `ApiError` zachowuje `code` i `details`, dzięki czemu formularze podświetlają
  konkretne pola (`markFieldErrors`).

`core/store.js` trzyma sesję, metadane i kartoteki. Kartoteki są pamiętane
podręcznie i unieważniane po każdej zmianie słownika (`invalidateCatalog`).

---

## 6. Bezpieczeństwo po stronie klienta

* **Każda** wartość wstawiana do szablonu przechodzi przez `esc()` z `core/dom.js`.
* Zdarzenia podpinane są delegacją po atrybutach `data-*` — bez `onclick` w HTML.
* Skany są pobierane żądaniem z nagłówkiem `Authorization` i wyświetlane z
  `blob:`, nigdy przez publiczny adres pliku.
* Uprawnienia sterują widocznością elementów; egzekwowanie odbywa się na serwerze.

---

## 7. System wizualny

Tokeny w `:root` (`assets/app.css`):

| Grupa | Wartości |
|---|---|
| Powierzchnie | `--paper` `#F5F8F6`, `--surface` `#FFFFFF`, `--surface-2` `#F7FAF8` |
| Tekst | `--ink` `#1B2B21`, `--ink-2` `#66786C`, `--ink-3` `#93A399` |
| Kolor główny | `--spruce` `#2E9E5B`, `--moss` `#238A4C`, `--spruce-deep` `#1C5E3A` |
| Akcent wtórny | `--amber` `#C89A3C`, `--gold` `#8F7418` (wydania i sprzedaż) |
| Statusy | `--pos` `#238A4C`, `--neg` `#C94F44`, `--info` `#3C6FA8` |
| Typografia | Inter (interfejs), IBM Plex Mono (liczby, numery dokumentów) |

Zieleń biomasy leśnej jako kolor wiodący, bursztyn dla operacji wydania — dzięki
temu typ dokumentu jest czytelny „z drugiego końca stołu”.

Klasy pomocnicze o ustalonym znaczeniu: `.card`, `.kpi`, `.tag`, `.stamp`,
`.calc-strip`, `.pile`, `.op-card`, `.toolbar`, `.chips`, `.alert`.

---

## 8. Responsywność

Jeden punkt przełamania: **860 px**.

| | Desktop (≥ 861 px) | Telefon (≤ 860 px) |
|---|---|---|
| Nawigacja | Sidebar 244 px | Dolny pasek zakładek + panel „Więcej” + nagłówek |
| Rejestr operacji | Tabela 13-kolumnowa | Karty (`.op-card`) |
| Formularz | Siatka wielokolumnowa | Jedna kolumna |
| Akcje | Przyciski w nagłówku | Przyciski pełnej szerokości + FAB |

Dolny pasek mieści pięć najczęstszych sekcji i przycisk **„Więcej”**, który
otwiera panel dolny z pełną listą — okresami, korektami, kartotekami,
użytkownikami i ustawieniami. Bez tego panelu połowa systemu byłaby na telefonie
nieosiągalna inaczej niż przez ręczne wpisanie adresu. Wszystkie trzy miejsca
(sidebar, pasek zakładek, panel) składane są z jednej tablicy `NAV`
w `components/layout.js`, więc nowa sekcja pojawia się w nich naraz i podlega
tej samej kontroli uprawnień.

Warstwa komponentów `web/src/ui/` opisuje listę raz i renderuje wyłącznie
wariant pasujący do szerokości ekranu — tabelę albo kartę, nigdy oba naraz.
Szczegóły projektu, propsy i pomiary w [FRONTEND.md](FRONTEND.md).

Zasady utrzymane w całym interfejsie:

* pola dotykowe co najmniej 44 × 44 px,
* pola liczbowe z `inputmode="decimal"` (klawiatura numeryczna),
* wejście dla skanów z `capture="environment"` (aparat w telefonie),
* `env(safe-area-inset-*)` dla telefonów z wcięciem ekranu,
* **brak poziomego przewijania strony** — szerokie tabele przewijają się
  wewnątrz `.tbl-wrap`; elementy siatek i flexa mają `min-width: 0`.

---

## 9. Wydruk

Reguły `@media print` ukrywają nawigację, paski narzędzi i filtry, rozciągają
treść na pełną szerokość i wymuszają `break-inside: avoid` na kartach.
Przycisk „Drukuj” jest dostępny na pulpicie, w kwicie produkcji, w raportach,
w rejestrze korekt i w podglądzie dokumentu.

---

## 10. Dodanie nowego widoku

1. Utwórz `web/src/views/nowy.js` eksportujący `renderNowy(view, params)`.
2. Zarejestruj w `main.js`: `route('nowy', renderNowy)`.
3. Dodaj pozycję do `NAV` w `components/layout.js` wraz z wymaganym uprawnieniem.
4. Odśwież stronę — brak kroku budowania.

Konwencja widoku:

```js
export async function renderNowy(view, params = {}) {
  view.innerHTML = loading('Wczytywanie…');
  const data = await api.get('/endpoint', params);
  view.innerHTML = pageHead('Tytuł', 'Okruszek', akcje) + treść(data);
  bind(view);                       // delegacja zdarzeń po data-*
}
```

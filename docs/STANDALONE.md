# Wersja jednoplikowa (`ResInvestERP.html`)

Cały system w jednym pliku HTML. Otwiera się podwójnym kliknięciem, nie wymaga
instalacji, Node.js ani połączenia z siecią. Dane trzyma w przeglądarce.

Plik powstaje poleceniem:

```bash
npm run build:html      # → dist/ResInvestERP.html
```

---

## Spis treści

1. [Do czego to jest, a do czego nie](#1-do-czego-to-jest-a-do-czego-nie)
2. [Zasada: jeden silnik, nie dwa](#2-zasada-jeden-silnik-nie-dwa)
3. [Co dokładnie jest podmienione](#3-co-dokładnie-jest-podmienione)
4. [Gdzie mieszkają dane](#4-gdzie-mieszkają-dane)
5. [Brak logowania — decyzja i jej uzasadnienie](#5-brak-logowania--decyzja-i-jej-uzasadnienie)
6. [Wymiana danych z wersją sieciową](#6-wymiana-danych-z-wersją-sieciową)
7. [Generator pakietu](#7-generator-pakietu)
8. [Kontrola zgodności silników](#8-kontrola-zgodności-silników)
9. [Znane ograniczenia](#9-znane-ograniczenia)
10. [Usterki wykryte przy budowie tej wersji](#10-usterki-wykryte-przy-budowie-tej-wersji)

---

## 1. Do czego to jest, a do czego nie

**Nadaje się:**

* pokaz systemu bez stawiania czegokolwiek — u klienta, na targach, na spotkaniu,
* praca jednej osoby na jednym komputerze, gdy instalacja usługi jest nie do przejścia,
* podgląd i raporty z kopii bazy przywiezionej z firmy,
* zapasowe wejście, gdy serwer w firmie nie działa.

**Nie nadaje się:**

* praca kilku osób naraz — każda przeglądarka ma własną, odrębną bazę,
* magazyn główny firmy — dane są w profilu przeglądarki, a nie na serwerze z kopiami,
* dostęp z telefonu do danych z komputera — to dwa osobne magazyny.

Do tych zastosowań służy wersja sieciowa z pakietu `.ZIP` (`ResInvestERP.exe`).

---

## 2. Zasada: jeden silnik, nie dwa

Wersja jednoplikowa **wykonuje ten sam kod serwera**, co wersja sieciowa:
te same serwisy dokumentów, korekt i okresów, te same raporty, te same migracje,
te same wyzwalacze utrzymujące tabelę sald, ten sam router z kontrolą uprawnień.

Warunkiem było uruchomienie SQLite w przeglądarce — stąd `standalone/vendor/`
z silnikiem skompilowanym do WebAssembly.

Rozważana alternatywa — przepisanie księgowania dokumentów i raportów nad
tablicami JavaScriptu — została odrzucona świadomie. Dwa silniki liczące te same
salda rozjeżdżają się prędzej czy później, a rozjazd w systemie magazynowym
oznacza dwa różne stany magazynu i żadnego sposobu, żeby rozstrzygnąć, który
jest prawdziwy. Cena tej decyzji to 1,5 MB pliku zamiast 350 kB oraz jeden
składnik zewnętrzny (sql.js, licencja MIT). Uznaliśmy ją za tanią.

```
                    wspólne (bez zmian)
   ┌──────────────────────────────────────────────────┐
   │  web/src/…      widoki, komponenty, wykresy      │
   │  server/src/modules/…   operacje, raporty, …     │
   │  server/src/domain/…    jednostki, ruchy, pola   │
   │  server/src/db/migrations/…   schemat + wyzwalacze│
   └──────────────────────────────────────────────────┘
        ▲                                    ▲
        │ core/api.js                        │ db/index.js
   ┌────┴─────────┐                    ┌─────┴──────────────┐
   │ fetch → HTTP │  wersja sieciowa   │ node:sqlite        │
   ├──────────────┤                    ├────────────────────┤
   │ router lokal.│  jednoplikowa      │ SQLite/WebAssembly │
   └──────────────┘                    └────────────────────┘
```

---

## 3. Co dokładnie jest podmienione

Sześć plików i jeden moduł wbudowany. Nic poza tym.

| Zamiast | Wchodzi | Powód |
|---|---|---|
| `server/src/db/index.js` | `standalone/src/runtime/db.js` | SQLite w WebAssembly; ten sam interfejs fasady |
| `server/src/config/env.js` | `runtime/config.js` | nie ma pliku `.env` ani zmiennych środowiskowych |
| `server/src/lib/crypto.js` | `runtime/crypto.js` | Web Crypto zamiast `node:crypto`; SHA-256 na miejscu |
| `server/src/lib/logger.js` | `runtime/logger.js` | konsola przeglądarki zamiast pliku |
| `web/src/core/api.js` | `standalone/src/api-local.js` | wywołanie routera na miejscu zamiast żądania HTTP |
| `web/src/views/login.js` | `standalone/src/views/login-local.js` | wybór operatora zamiast logowania |
| `node:fs` | `runtime/fs.js` | załączniki w IndexedDB zamiast na dysku |

Serwisy **załączników i kopii zapasowych zostają bez zmian** — wirtualny system
plików wystarcza im za dysk. Tabela podmianek jest zapisana w jednym miejscu:
`SUBSTITUTIONS` w `standalone/build.mjs`.

Adapter API wchodzi przed router tylko w trzech miejscach, i każde z nich to
różnica środowiska, nie różnica reguł:

* `/auth/*` — sesją jest wybrany operator,
* `/backup/create`, `/backup/list` — kopia to plik pobierany przez przeglądarkę,
* `/attachments/:id/content` — bajty skanu trzeba wciągnąć z magazynu do bufora,
  zanim sięgnie po nie synchroniczny serwis.

---

## 4. Gdzie mieszkają dane

**W profilu przeglądarki, na tym jednym komputerze** (IndexedDB). Nie w pliku HTML.

Konsekwencje, które trzeba znać:

* skopiowanie pliku `ResInvestERP.html` na pendrive **nie kopiuje dokumentów**,
* ten sam plik otwarty w innej przeglądarce to inna, pusta baza,
* wyczyszczenie danych przeglądania potrafi usunąć bazę,
* tryb prywatny zwykle nie zapisuje niczego trwale.

Aplikacja prosi przeglądarkę o **trwałość magazynu** (`navigator.storage.persist`),
co chroni dane przed automatycznym usunięciem przy braku miejsca na dysku.
Odmowa niczego nie psuje, ale podnosi wagę kopii zapasowych.

**Kopia zapasowa jest jedynym sposobem, żeby dane przetrwały komputer.**
Ustawienia → Kopie zapasowe → *Pobierz kopię* zapisuje prawdziwy plik bazy
SQLite (`.db`), który otwiera się w wersji sieciowej, w `sqlite3` i w dowolnej
przeglądarce baz.

---

## 5. Brak logowania — decyzja i jej uzasadnienie

Wersja jednoplikowa **nie ma ekranu logowania i nie przechowuje haseł**.

Plik otwiera się podwójnym kliknięciem, a dane leżą w magazynie przeglądarki tego
samego komputera. Formularz z hasłem nie chroniłby ich przed nikim: kto ma dostęp
do komputera i profilu przeglądarki, ma i dane — z pominięciem formularza.
Udawanie zabezpieczenia jest gorsze niż jego brak, bo użytkownik zakłada wtedy
ochronę, której nie dostaje.

Zamiast logowania jest **wybór operatora**. Ma to sens praktyczny, nie pozorny:

* decyduje, kto figuruje jako autor dokumentu w rejestrze i dzienniku audytu,
* rola przycina interfejs do tego, co danej osobie wolno (te same uprawnienia,
  co w wersji sieciowej — `middleware/auth.js` jest niepodmieniony).

Dane w tej wersji chroni się inaczej: szyfrowaniem dysku komputera (BitLocker,
FileVault, LUKS) i regularną kopią zapasową.

---

## 6. Wymiana danych z wersją sieciową

Obie wersje używają tego samego formatu bazy i tego samego formatu eksportu.

| Kierunek | Jak |
|---|---|
| jednoplikowa → sieciowa | *Pobierz kopię* → plik `.db` podstawiony pod `DB_FILE` na serwerze |
| sieciowa → jednoplikowa | plik bazy z serwera → *Wczytaj kopię* w Ustawieniach |
| wybiórczo, w obie strony | eksport i import JSON (`/backup/export`, `/backup/import`) — ten sam kod po obu stronach |
| do księgowości | eksport CSV rejestru operacji i raportu miesięcznego |

Import JSON przechodzi przez warstwę serwisową, więc dane wchodzące podlegają tej
samej walidacji, co ręczne wprowadzanie — także tutaj.

---

## 7. Generator pakietu

`standalone/build.mjs` robi pięć rzeczy:

1. przechodzi graf modułów ES od `web/src/main.js`,
2. podmienia pliki z tabeli `SUBSTITUTIONS`,
3. zamienia moduły ES na rejestr funkcji (przeglądarka nie ma tu serwera, z którego
   mogłaby je dociągnąć; `import`/`export` są przepisywane na wywołania rejestru),
4. wkleja arkusze stylów, migracje SQL, dane demonstracyjne i silnik SQLite
   (WebAssembly w base64),
5. zapisuje `dist/ResInvestERP.html`.

Generator **przerywa budowanie przy nieznanej formie `import` albo `export`**
zamiast po cichu ją pominąć. Cicho pominięty eksport to brakująca funkcja
wykrywana dopiero w przeglądarce, u użytkownika.

Wykrywa też cykle w grafie modułów i wypisuje ostrzeżenie — rejestr znosi je
gorzej niż natywne moduły ES. W chwili pisania cykli nie ma.

---

## 8. Kontrola zgodności silników

```bash
npm run build:html
node standalone/verify.mjs
```

Skrypt generuje dane demonstracyjne po stronie serwera (`node:sqlite`), robi to
samo w pliku jednoplikowym (SQLite/WebAssembly) i porównuje wyniki: liczbę
dokumentów, stan magazynu w MP, tonach i GJ, wartości zakupu i sprzedaży, marżę,
bilans otwarcia i zamknięcia oraz stan każdego produktu z osobna.

Wszystkie liczby muszą się zgadzać co do grosza. Rozjazd oznacza, że sterownik
bazy zmienia wynik — i jest błędem blokującym wydanie.

---

## 9. Znane ograniczenia

| Ograniczenie | Powód | Obejście |
|---|---|---|
| Jeden komputer, jedna przeglądarka | dane w IndexedDB | wersja sieciowa albo przenoszenie pliku `.db` |
| Jedna karta naraz | jedna baza = jedno połączenie | aplikacja mówi wprost, gdy magazyn jest zajęty |
| Brak logowania | patrz punkt 5 | szyfrowanie dysku + kopie zapasowe |
| Kopie nie są widoczne w aplikacji | pobrany plik trafia tam, gdzie przeglądarka zapisuje pobrania | lista kopii jest pusta i nie udaje, że jest inaczej |
| Rozmiar pliku 1,5 MB | silnik SQLite wklejony w base64 | świadoma cena za jeden silnik zamiast dwóch |
| Pierwsze uruchomienie trwa chwilę | kompilacja WebAssembly | kolejne są natychmiastowe |
| Kroje pisma z sieci | plik linkuje Inter i IBM Plex Mono | bez sieci system podstawia własny krój; układ się nie zmienia |

---

## 10. Usterki wykryte przy budowie tej wersji

Uruchomienie tego samego kodu na innym sterowniku bazy okazało się skuteczną
kontrolą jakości. Trzy rzeczy wyszły dopiero tutaj:

**`Database.export()` w sql.js zwalnia wszystkie przygotowane instrukcje.**
Bufor instrukcji trzymał je dalej, więc po pierwszym zrzucie bazy wskazywał na
zwolnioną pamięć — objawem był wyjątek „Statement closed”. Groźniejszy wariant
tego samego błędu to trafienie w instrukcję utworzoną później pod tym samym
adresem i ciche zwrócenie cudzego wyniku. Poprawka: `forgetStatements()` po
każdym zrzucie (`standalone/src/runtime/db.js`).

**Brak bufora instrukcji jest nie do przyjęcia w WebAssembly.** Pierwsza wersja
kompilowała każde zapytanie od nowa; generowanie danych demonstracyjnych nie
skończyło się po ośmiu minutach i zostało przerwane. Po dodaniu bufora — tego
samego, co w wersji serwerowej — księgowanie dokumentu zajmuje 2 ms, odczyt
pulpitu 3 ms, a wygenerowanie kompletu 358 dokumentów demonstracyjnych
684 ms (Chromium, plik otwarty przez `file://`).

**Nazwa magazynu domyślnego musi być identyczna w obu konfiguracjach.**
W pierwszej wersji `runtime/config.js` miał `Plac Pyskowice`, a serwer
`Magazyn RiC Zabrze`. Dane demonstracyjne rozpoznają magazyn startowy **po
nazwie** i wtedy go pomijają; przy innej nazwie próbowały założyć drugi magazyn
z tym samym, jawnie podanym kodem `MAG-GLOWNY` — i przewracały się na
unikalności. Usterka dotyczyła wyłącznie konfiguracji wersji jednoplikowej,
ale pokazuje, że plik konfiguracyjny nie jest miejscem na „mniej więcej
takie same” wartości.

Przy okazji uporządkowany został generator danych demonstracyjnych: logika
przeniosła się ze skryptu `server/scripts/seed.mjs` do modułu
`server/src/seed/demo-seed.js`, wspólnego dla obu wersji. Skrypt jest teraz
powłoką wiersza poleceń, a wersja jednoplikowa woła tę samą funkcję.

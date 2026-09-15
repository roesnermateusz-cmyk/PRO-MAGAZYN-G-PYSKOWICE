# Składniki zewnętrzne

## sql.js — SQLite 3 skompilowany do WebAssembly

| | |
|---|---|
| Wersja | 1.13.0 |
| Licencja | MIT (`LICENSE-sql.js.txt`) |
| Pochodzenie | pakiet npm `sql.js@1.13.0`, katalog `dist/` |
| Pliki | `sql-wasm.js` (ładowarka), `sql-wasm.wasm` (silnik) |

**Dlaczego to tu leży.** Wersja jednoplikowa musi wykonać dokładnie ten sam kod
serwera, co wersja sieciowa — te same serwisy, te same migracje, te same
wyzwalacze. Warunkiem jest SQLite działający w przeglądarce. Alternatywą było
przepisanie silnika dokumentów i raportów po raz drugi, nad tablicami
JavaScriptu; dwa silniki liczące te same salda rozjeżdżają się prędzej czy
później, a rozjazd w systemie magazynowym oznacza dwa różne stany magazynu.

**Dlaczego binaria są w repozytorium, a nie pobierane przy budowaniu.**
Ta sama zasada, co przy zerowej liczbie zależności serwera: pakiet ma się
zbudować i zainstalować na komputerze bez dostępu do rejestru npm.

**Aktualizacja.** Podmień oba pliki na nowsze z `npm pack sql.js@<wersja>`,
zaktualizuj wersję w tabeli powyżej i uruchom `npm run build:html`, a potem
kontrolę zgodności silnika (`standalone/verify.mjs`).

Reguła zerowej liczby zależności produkcyjnych **nadal obowiązuje serwer**.
To jest składnik wyłącznie wersji jednoplikowej i nie trafia do `server/`.

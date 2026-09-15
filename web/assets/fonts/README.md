# Kroje pisma

Pliki są **generowane** przez `node tools/vendor-fonts.mjs`. Nie edytuj ich
ręcznie i nie dopisuj tu nic samodzielnie — najbliższe wendorowanie czyści
katalog i zapisuje go od nowa.

## Składniki

| | Inter | IBM Plex Mono |
|---|---|---|
| Rola | tekst interfejsu (`--font-body`) | liczby, kody, znaczniki (`--font-mono`) |
| Wagi | 400, 500, 600, 700, 800 | 500, 600 |
| Licencja | SIL Open Font License 1.1 (`OFL-Inter.txt`) | SIL Open Font License 1.1 (`OFL-IBM-Plex.txt`) |
| Prawa autorskie | © 2016 The Inter Project Authors | © 2017 IBM Corp., zastrzeżona nazwa „Plex” |
| Pochodzenie | dystrybucja Google Fonts (`fonts.gstatic.com`), pliki niemodyfikowane | jw. |
| Podzbiory | `latin`, `latin-ext` | `latin`, `latin-ext` |

Licencja OFL pozwala na osadzanie i redystrybucję krojów pod warunkiem
dołączenia treści licencji wraz z notą o prawach autorskich — stąd oba pliki
`OFL-*.txt` obok krojów. Plików nie modyfikujemy, więc klauzula o zastrzeżonej
nazwie („Plex”) nie wchodzi w grę.

## Dlaczego lokalnie, a nie z Google Fonts

Program działa na komputerze w firmie, a wersja jednoplikowa obiecuje wprost
działanie **bez sieci**. Odwołanie do `fonts.googleapis.com` łamało obie te
rzeczy naraz:

* bez internetu interfejs spadał na kroje systemowe — inne szerokości znaków,
  inny rytm tabel, rozjechane kolumny liczb;
* z internetem wysyłał adres IP firmy do Google przy każdym otwarciu programu,
  bez żadnego powodu.

To ta sama zasada, co zerowa liczba zależności produkcyjnych serwera i silnik
sql.js w `standalone/vendor/`: pakiet ma się uruchomić na komputerze odciętym
od świata.

## Dlaczego jedna reguła `@font-face` na wagę

Inter jest krojem **zmiennym** — jeden plik obsługuje całe pasmo wag, więc
`Inter-latin.woff2` jest podstawiony pod pięć reguł, po jednej na wagę.
Wygląda to na powielenie, ale jest celowe.

Arkusz stylów używa miejscami wag pośrednich (`650`, `680`). Przeglądarka
dobiera do nich regułę o **najbliższej dostępnej** wadze, czyli 700 — i tak
rysuje je dzisiaj. Gdyby reguła była jedna, z zakresem `font-weight: 400 800`,
krój zmienny narysowałby 650 i 680 dosłownie i interfejs zmieniłby wygląd.

Odtwarzamy więc dokładnie to, co Google serwuje: **jeden plik, pięć reguł**.

## Dlaczego tylko `latin` i `latin-ext`

Google dzieli każdy krój na siedem podzbiorów — dochodzą cyrylica, greka
i wietnamski. Polskie znaki diakrytyczne mieszczą się w `latin` i `latin-ext`;
reszta to w tym systemie martwy balast, a w wersji jednoplikowej balast
zakodowany w base64, czyli o jedną trzecią cięższy.

## Aktualizacja

```bash
node tools/vendor-fonts.mjs   # pobiera na nowo, czyści katalog, generuje ../fonts.css
npm run build:html            # wersja jednoplikowa wkleja kroje jako data:
```

Skrypt sam rozpoznaje, czy dana rodzina przychodzi jako krój zmienny (jeden
plik na wszystkie wagi), czy jako osobne pliki statyczne, i odpowiednio nazywa
pliki. Przerywa pracę, jeśli Google odda regułę z **zakresem** wag — to
zmieniłoby rysunek wag pośrednich i wymaga świadomej decyzji, nie cichego
przyjęcia.

Po aktualizacji obejrzyj interfejs: zmiana wersji kroju potrafi przesunąć
szerokości znaków, a `docs/DESIGN-SYSTEM.md` opisuje typografię, która ma
zostać bez zmian.

/**
 * Wendorowanie krojów pisma do `web/assets/fonts/`.
 *
 * Narzędzie DEWELOPERSKIE, uruchamiane ręcznie przy podmianie wersji krojów.
 * Aplikacja nigdy go nie wykonuje i nie potrzebuje sieci — pliki `.woff2`
 * leżą w repozytorium, tak samo jak silnik sql.js w `standalone/vendor/`.
 *
 * Dlaczego lokalnie, a nie z Google Fonts. System wdraża się na komputerze
 * w firmie, a wersja jednoplikowa obiecuje wprost działanie bez sieci.
 * Odwołanie do `fonts.googleapis.com` łamało obie te rzeczy naraz: bez
 * internetu interfejs spadał na kroje systemowe (inne szerokości znaków,
 * inny rytm tabel), a przy internecie wysyłał adres IP firmy do Google przy
 * każdym otwarciu programu.
 *
 * Dlaczego PIĘĆ REGUŁ NA JEDEN PLIK, a nie jedna reguła z zakresem wag.
 * Inter przychodzi z Google jako jeden krój ZMIENNY, podstawiany pod pięć
 * osobnych reguł `@font-face`, każda z jedną wagą (`400`, `500`, … `800`).
 * To nie jest szczegół techniczny: arkusz stylów używa miejscami wag
 * pośrednich (650, 680), a przeglądarka dobiera do nich regułę z NAJBLIŻSZEJ
 * dostępnej wagi — czyli 700. Gdyby reguła była jedna, z zakresem
 * `400 800`, krój zmienny narysowałby 650 i 680 dosłownie i interfejs
 * wyglądałby INACZEJ niż dotąd. Odtwarzamy dokładnie to, co Google serwuje
 * dzisiaj: jeden plik, pięć reguł po jednej wadze.
 *
 * Stąd też odsiewanie duplikatów po skrócie treści. Google oddaje ten sam
 * plik pod pięcioma regułami, więc przeglądarka pobiera go raz; zapisanie
 * pięciu kopii na dysku byłoby pół megabajta balastu w instalatorze
 * i w wersji jednoplikowej. IBM Plex Mono ma osobny plik na wagę i tak
 * zostaje zapisany — skrypt rozstrzyga to sam, nie z góry.
 *
 * Dlaczego tylko `latin` i `latin-ext`. Google dzieli krój na siedem
 * podzbiorów (dochodzą cyrylica, greka, wietnamski). Polskie znaki
 * diakrytyczne mieszczą się w `latin` i `latin-ext`; pozostałe podzbiory
 * to w tym systemie martwy balast, a w wersji jednoplikowej — balast
 * zakodowany w base64, czyli o jedną trzecią cięższy.
 *
 *   node tools/vendor-fonts.mjs
 */
import { mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KATALOG = join(ROOT, 'web/assets/fonts');

/** Dokładnie te rodziny i wagi, których używa `web/assets/app.css`. */
const ZAPYTANIE = 'family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@500;600&display=swap';

const PODZBIORY = new Set(['latin', 'latin-ext']);

/**
 * Google oddaje plik zmienny albo statyczny zależnie od nagłówka
 * `User-Agent`. Bez współczesnej przeglądarki dostalibyśmy `.ttf`
 * zamiast `.woff2`, więc podajemy się za Chrome.
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Licencje kopiowane z repozytoriów autorów, nie z pośrednika. */
const LICENCJE = [
  { plik: 'OFL-Inter.txt', url: 'https://raw.githubusercontent.com/rsms/inter/master/LICENSE.txt' },
  { plik: 'OFL-IBM-Plex.txt', url: 'https://raw.githubusercontent.com/IBM/plex/master/LICENSE.txt' },
];

async function pobierz(url, naglowki = {}) {
  const odp = await fetch(url, { headers: { 'User-Agent': UA, ...naglowki } });
  if (!odp.ok) throw new Error(`${odp.status} ${odp.statusText} — ${url}`);
  return odp;
}

/**
 * Nazwa pliku. Waga trafia do nazwy tylko wtedy, gdy naprawdę rozróżnia
 * plik — krój zmienny obsługujący wszystkie wagi nazywa się `Inter-latin`,
 * bo `Inter-400-latin` sugerowałoby, że jest tam sama chuda odmiana.
 */
const nazwaPliku = (rodzina, waga, podzbior) =>
  [rodzina.replace(/\s+/g, ''), waga, podzbior].filter(Boolean).join('-') + '.woff2';

async function main() {
  console.log('Pobieram arkusz Google Fonts…');
  const css = await (await pobierz(`https://fonts.googleapis.com/css2?${ZAPYTANIE}`)).text();

  // Arkusz Google to ciąg bloków poprzedzonych komentarzem z nazwą podzbioru.
  const bloki = [...css.matchAll(/\/\* (\S+) \*\/\s*@font-face \{([^}]*)\}/g)];
  if (!bloki.length) throw new Error('Nie rozpoznałem struktury arkusza — sprawdź format odpowiedzi.');

  const wybrane = [];
  for (const [, podzbior, tresc] of bloki) {
    if (!PODZBIORY.has(podzbior)) continue;
    const pole = (re) => tresc.match(re)?.[1];
    const rodzina = pole(/font-family:\s*'([^']+)'/);
    const waga = pole(/font-weight:\s*(\S+);/);
    const zakres = pole(/unicode-range:\s*([^;]+);/);
    const url = pole(/url\((\S+?)\)/);
    if (!rodzina || !waga || !url) throw new Error(`Niekompletny blok @font-face (${podzbior}).`);
    if (/\s|\.\./.test(waga)) {
      throw new Error(`Waga „${waga}” to zakres — Google oddał krój zmienny. `
        + 'To zmieniłoby rysunek wag pośrednich (650, 680); przerywam.');
    }
    wybrane.push({ rodzina, waga, podzbior, zakres: zakres.trim(), url });
  }

  // Sprzątamy po poprzednim przebiegu, żeby po zmianie listy wag nie zostały
  // sieroty, których nic już nie ładuje, a które i tak trafiają do instalatora.
  // Kasujemy WYŁĄCZNIE to, co ten skrypt generuje — `README.md` obok jest
  // pisany ręcznie i ma przeżyć aktualizację krojów.
  mkdirSync(KATALOG, { recursive: true });
  for (const plik of readdirSync(KATALOG)) {
    if (plik.endsWith('.woff2') || plik.startsWith('OFL-')) rmSync(join(KATALOG, plik));
  }

  // Pobieramy każdy adres RAZ, choćby wystąpił pod kilkoma wagami.
  const adresy = [...new Set(wybrane.map((f) => f.url))];
  const tresc = new Map();
  for (const url of adresy) {
    const bajty = Buffer.from(await (await pobierz(url)).arrayBuffer());
    // `wOF2` na początku pliku — kontrola, że dostaliśmy krój, a nie stronę błędu.
    if (bajty.subarray(0, 4).toString('latin1') !== 'wOF2') {
      throw new Error(`To nie jest plik woff2: ${url}`);
    }
    tresc.set(url, bajty);
  }

  // Czy w obrębie rodziny i podzbioru wszystkie wagi to ten sam plik? Jeśli
  // tak, mamy krój zmienny i waga nie ma po co trafiać do nazwy pliku.
  const jedenPlik = new Map();
  for (const f of wybrane) {
    const klucz = `${f.rodzina}|${f.podzbior}`;
    const skrot = createHash('sha256').update(tresc.get(f.url)).digest('hex');
    jedenPlik.set(klucz, (jedenPlik.get(klucz) ?? new Set()).add(skrot));
  }

  const zapisane = new Map();
  const reguly = [];
  let razem = 0;
  for (const f of wybrane) {
    const zmienny = jedenPlik.get(`${f.rodzina}|${f.podzbior}`).size === 1;
    const nazwa = nazwaPliku(f.rodzina, zmienny ? '' : f.waga, f.podzbior);

    if (!zapisane.has(nazwa)) {
      const bajty = tresc.get(f.url);
      writeFileSync(join(KATALOG, nazwa), bajty);
      zapisane.set(nazwa, bajty.length);
      razem += bajty.length;
      console.log(`  ${nazwa.padEnd(30)} ${(bajty.length / 1024).toFixed(1).padStart(6)} kB`
        + (zmienny ? '   (krój zmienny — wspólny dla wszystkich wag)' : ''));
    }

    reguly.push(`/* ${f.podzbior} */
@font-face {
  font-family: '${f.rodzina}';
  font-style: normal;
  font-weight: ${f.waga};
  font-display: swap;
  src: url('fonts/${nazwa}') format('woff2');
  unicode-range: ${f.zakres};
}`);
  }

  for (const l of LICENCJE) {
    writeFileSync(join(KATALOG, l.plik), await (await pobierz(l.url)).text());
    console.log(`  ${l.plik}`);
  }

  const naglowek = `/**
 * Kroje pisma wbudowane w aplikację — bez żadnego odwołania do sieci.
 *
 * PLIK GENEROWANY przez \`node tools/vendor-fonts.mjs\`. Nie edytuj ręcznie:
 * najbliższe wendorowanie nadpisze zmiany.
 *
 * Kilka reguł potrafi wskazywać ten sam plik — Inter jest krojem zmiennym,
 * a osobna reguła na wagę jest tu celowa: arkusz używa wag pośrednich
 * (650, 680), które mają zaokrąglać się do 700 tak samo jak dotąd. Jedna
 * reguła z zakresem wag zmieniłaby ich rysunek. Powody tej i pozostałych
 * decyzji: nagłówek skryptu oraz \`web/assets/fonts/README.md\`.
 *
 * Inter oraz IBM Plex Mono — SIL Open Font License 1.1,
 * treść licencji w \`fonts/OFL-Inter.txt\` i \`fonts/OFL-IBM-Plex.txt\`.
 */
`;
  writeFileSync(join(ROOT, 'web/assets/fonts.css'), `${naglowek}\n${reguly.join('\n\n')}\n`);

  console.log(`\nGotowe: ${zapisane.size} plików (${wybrane.length} reguł @font-face), ${(razem / 1024).toFixed(0)} kB razem.`);
  console.log('Pamiętaj o przebudowaniu wersji jednoplikowej: npm run build:html');
}

main().catch((err) => {
  console.error(`\nWendorowanie nie powiodło się: ${err.message}`);
  process.exit(1);
});

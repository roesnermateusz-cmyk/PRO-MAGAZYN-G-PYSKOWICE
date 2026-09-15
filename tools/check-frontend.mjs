/**
 * Kontrola frontu: zgodność importów z eksportami.
 *
 * Po co to istnieje. Front nie ma kroku budowania ani sprawdzania typów —
 * nie ma etapu, na którym rozjazd między `import { on }` a tym, co moduł
 * naprawdę eksportuje, miałby prawo wyjść przed użytkownikiem. Przeglądarka
 * zauważy to dopiero przy wejściu na stronę, i to białym ekranem.
 *
 * Czego ta kontrola NIE robi. Nie szuka użycia nazwy, której moduł nie
 * zaimportował (tak zginął kiedyś podgląd dokumentu: migracja na komponenty
 * zgubiła `on` z importu, a `renderOperationDetail` wołało je dalej).
 * Rozstrzygnięcie tego wymaga analizy zakresów, a więc prawdziwego parsera —
 * wyrażeniami regularnymi wychodzi z tego sito, które myli treść szablonów
 * HTML z kodem. Kontrola, która krzyczy fałszywie, przestaje być czytana,
 * więc lepiej, żeby milczała o tym, czego nie potrafi dowieść.
 *
 * Tamtą klasę usterek łapie próba przeglądarkowa obchodząca wszystkie trasy
 * i pilnująca pustej konsoli — opisana w `docs/FRONTEND.md`. To ona jest
 * właściwym miejscem na błędy wykonania; tu sprawdzamy statykę.
 *
 *   node tools/check-frontend.mjs      (albo: npm run check:web)
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KATALOG = join(ROOT, 'web/src');

/** Wszystkie pliki `.js` w drzewie. */
function pliki(katalog) {
  return readdirSync(katalog).flatMap((wpis) => {
    const sciezka = join(katalog, wpis);
    if (statSync(sciezka).isDirectory()) return pliki(sciezka);
    return sciezka.endsWith('.js') ? [sciezka] : [];
  });
}

/**
 * Usuwa komentarze i literały tekstowe.
 *
 * Szablony (backtick) zamieniamy w całości na spację RAZEM z wstawkami.
 * Traci się przez to wywołania wewnątrz `${…}`, ale zysk jest większy:
 * poprawne wycięcie zagnieżdżonych szablonów wyrażeniem regularnym nie jest
 * możliwe, a każda próba kończy się wpuszczaniem HTML-a do analizy kodu.
 * Kontrola ma nie mieć fałszywych alarmów — inaczej przestanie być czytana.
 */
function samKod(src) {
  let out = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\w])\/\/[^\n]*/g, '$1 ');

  // Szablony wycinamy ręcznie, z licznikiem zagnieżdżeń.
  let wynik = '';
  let i = 0;
  while (i < out.length) {
    if (out[i] === '`') {
      let glebokosc = 0;
      i += 1;
      while (i < out.length) {
        if (out[i] === '\\') { i += 2; continue; }
        if (out[i] === '`' && glebokosc === 0) { i += 1; break; }
        if (out[i] === '$' && out[i + 1] === '{') { glebokosc += 1; i += 2; continue; }
        if (out[i] === '}' && glebokosc > 0) { glebokosc -= 1; i += 1; continue; }
        if (out[i] === '`' && glebokosc > 0) {
          // Szablon w szablonie — pomijamy go tak samo.
          i += 1;
          while (i < out.length && out[i] !== '`') i += (out[i] === '\\' ? 2 : 1);
        }
        i += 1;
      }
      wynik += ' ';
      continue;
    }
    wynik += out[i];
    i += 1;
  }

  return wynik
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

/** Nazwy wnoszone przez instrukcje `import`. */
function importowane(src) {
  const nazwy = new Map();
  for (const m of src.matchAll(/import\s+([^'"]+?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const [, klauzula, skad] = m;
    const nawias = klauzula.match(/\{([^}]*)\}/);
    if (nawias) {
      for (const czesc of nawias[1].split(',')) {
        const [orygynal, alias] = czesc.split(/\s+as\s+/).map((x) => x.trim());
        if (orygynal) nazwy.set(alias || orygynal, { skad, orygynal });
      }
    }
    const domyslny = klauzula.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
    if (domyslny && !domyslny.startsWith('*')) nazwy.set(domyslny, { skad, orygynal: 'default' });
    const gwiazdka = klauzula.match(/\*\s+as\s+(\w+)/);
    if (gwiazdka) nazwy.set(gwiazdka[1], { skad, orygynal: '*' });
  }
  return nazwy;
}

/** Nazwy eksportowane przez moduł. */
function eksportowane(src) {
  const kod = samKod(src);
  const nazwy = new Set();
  for (const m of kod.matchAll(/export\s+(?:async\s+)?(?:function\s*\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    nazwy.add(m[1]);
  }
  for (const m of kod.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const cz of m[1].split(',')) {
      const nazwa = (cz.split(/\s+as\s+/)[1] ?? cz).trim();
      if (nazwa) nazwy.add(nazwa);
    }
  }
  if (/export\s+default\b/.test(kod)) nazwy.add('default');
  return nazwy;
}

const zrodla = pliki(KATALOG);
const eksporty = new Map(zrodla.map((f) => [f, eksportowane(readFileSync(f, 'utf8'))]));
const problemy = [];

for (const plik of zrodla) {
  const src = readFileSync(plik, 'utf8');
  const imp = importowane(src);
  const gdzie = relative(ROOT, plik);

  for (const [, { skad, orygynal }] of imp) {
    if (!skad.startsWith('.')) continue;
    const cel = resolve(dirname(plik), skad);
    if (!existsSync(cel)) {
      problemy.push(`${gdzie} — import z nieistniejącego pliku: ${skad}`);
      continue;
    }
    const dostepne = eksporty.get(cel);
    if (orygynal !== '*' && dostepne && !dostepne.has(orygynal)) {
      problemy.push(`${gdzie} — „${orygynal}” nie jest eksportowane przez ${relative(ROOT, cel)}`);
    }
  }
}

if (problemy.length) {
  console.error(`\nKontrola frontu: ${problemy.length} problem(ów)\n`);
  for (const p of problemy) console.error(`  ✗ ${p}`);
  console.error('');
  process.exit(1);
}
console.log(`Kontrola frontu: ${zrodla.length} modułów, bez zastrzeżeń.`);

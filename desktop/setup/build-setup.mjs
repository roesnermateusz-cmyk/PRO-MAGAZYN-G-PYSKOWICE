/**
 * Budowa instalatora `ResInvest-ERP-Setup-<wersja>.exe`.
 *
 * Jeden plik do pobrania, który niesie w sobie cały system: serwer, interfejs,
 * dokumentację, gotowy launcher i wersję jednoplikową na wypadek komputera
 * bez Node.js. Nic nie jest dociągane z sieci — ani przy budowaniu, ani przy
 * instalacji.
 *
 * ┌── Dlaczego własny kontener, a nie ZIP ────────────────────────────────┐
 * │ Instalator rozpakowuje ładunek klasą `DeflateStream`, która jest       │
 * │ w `System.dll` od .NET Framework 2.0. `ZipFile` wymagałby zestawu      │
 * │ `System.IO.Compression.FileSystem` (4.5+) — jednej zależności więcej   │
 * │ po stronie komputera firmy, dla formatu, z którego i tak korzystamy    │
 * │ tylko my. Format `RIEP1` jest opisany niżej i czyta go jedna metoda.   │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * Wymaga kompilatora C#. Na Linuksie: `mcs` z pakietu `mono-devel`.
 * Na Windows wystarczy `csc.exe` z .NET Framework (składnik systemu).
 *
 *   node desktop/setup/build-setup.mjs
 */
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync,
} from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const PRACA = path.join(DIST, '.setup-praca');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const WERSJA = pkg.version;
const WYNIK = path.join(DIST, `ResInvest-ERP-Setup-${WERSJA}.exe`);

/* ---------------------- Co wchodzi do ładunku ------------------------- */

/* Katalogi kopiowane w całości (ścieżka w repozytorium = ścieżka po instalacji). */
const KATALOGI = ['server/src', 'server/scripts', 'server/seed', 'web', 'docs'];

/* Pojedyncze pliki: [źródło w repozytorium, ścieżka po instalacji]. */
const PLIKI = [
  ['package.json', 'package.json'],
  ['LICENSE', 'LICENSE'],
  ['README.md', 'README.md'],
  ['.env.example', '.env.example'],
  ['desktop/installer/START.bat', 'START.bat'],
  ['desktop/installer/KOPIA-ZAPASOWA.bat', 'KOPIA-ZAPASOWA.bat'],
  ['desktop/installer/ResInvestERP.ico', 'ResInvestERP.ico'],
  // Źródło launchera zostaje w pakiecie — pozwala odtworzyć plik wykonywalny
  // na miejscu, gdyby kiedyś trzeba było go podmienić bez ponownej instalacji.
  ['desktop/installer/ResInvestERP.cs', 'ResInvestERP.cs'],
  ['desktop/installer/ZBUDUJ-EXE.bat', 'ZBUDUJ-EXE.bat'],
];

/* Pomijane wszędzie — artefakty i dane działającego systemu. */
const POMIJANE = new Set(['node_modules', '.git', '.DS_Store', 'data']);

/* ------------------------- Zbieranie plików --------------------------- */

/** Rekurencyjnie wypisuje pliki katalogu jako `[ścieżkaNaDysku, ścieżkaWPakiecie]`. */
function zbierzKatalog(wzgledny) {
  const bezwzgledny = path.join(ROOT, wzgledny);
  if (!existsSync(bezwzgledny)) throw new Error(`Brak katalogu ${wzgledny}`);
  const wynik = [];
  const chodz = (katalog, prefiks) => {
    for (const wpis of readdirSync(katalog).sort()) {
      if (POMIJANE.has(wpis)) continue;
      const pelna = path.join(katalog, wpis);
      const wPakiecie = prefiks ? `${prefiks}/${wpis}` : wpis;
      if (statSync(pelna).isDirectory()) chodz(pelna, wPakiecie);
      else wynik.push([pelna, wPakiecie]);
    }
  };
  chodz(bezwzgledny, wzgledny);
  return wynik;
}

/* --------------------- Kompilacja plików wykonywalnych ----------------- */

/** Znajduje kompilator C#: `mcs` (Mono) albo `csc` (.NET Framework). */
function znajdzKompilator() {
  for (const nazwa of ['mcs', 'csc']) {
    try {
      execFileSync(nazwa, ['--version'], { stdio: 'ignore' });
      return nazwa;
    } catch { /* następny */ }
  }
  throw new Error(
    'Nie znaleziono kompilatora C#.\n'
    + '  Linux : zainstaluj pakiet `mono-devel` (daje polecenie `mcs`).\n'
    + '  Windows: użyj `csc.exe` z .NET Framework — jest składnikiem systemu.',
  );
}

const KOMPILATOR = znajdzKompilator();

/**
 * Kompiluje pliki `.cs` do pliku wykonywalnego Windows.
 *
 * `-codepage:utf8` jest obowiązkowe: źródła mają polskie znaki w napisach
 * interfejsu, a kompilator bez tej opcji potrafi przyjąć stronę kodową
 * systemu i zamienić „ą” na krzaki dopiero w gotowym programie.
 */
function kompiluj(zrodla, wyjscie, { okienkowy = true, zasoby = [], ikona = null } = {}) {
  const args = [
    '-nologo',
    `-target:${okienkowy ? 'winexe' : 'exe'}`,
    '-optimize+',
    '-platform:anycpu',
    '-codepage:utf8',
    `-out:${wyjscie}`,
    '-r:System.dll',
    '-r:System.Windows.Forms.dll',
    '-r:System.Drawing.dll',
  ];
  if (ikona) args.push(`-win32icon:${ikona}`);
  for (const [plik, nazwa] of zasoby) args.push(`-resource:${plik},${nazwa}`);
  args.push(...(Array.isArray(zrodla) ? zrodla : [zrodla]));

  try {
    execFileSync(KOMPILATOR, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const opis = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim();
    const nazwy = (Array.isArray(zrodla) ? zrodla : [zrodla]).map((z) => path.basename(z)).join(', ');
    throw new Error(`Kompilacja (${nazwy}) nie powiodła się:\n${opis}`);
  }
  if (!existsSync(wyjscie)) throw new Error(`Kompilator nie utworzył ${wyjscie}`);
}

/* --------------------------- Format RIEP1 ----------------------------- */

/**
 * Składa kontener ładunku.
 *
 *   "RIEP1"            5 bajtów, magia
 *   długość indeksu    4 bajty, uint32 little-endian
 *   indeks             JSON UTF-8: [{ p, o, c, u }]
 *   dane               surowe strumienie deflate, sklejone w kolejności indeksu
 *
 * `p` — ścieżka po instalacji, `o` — przesunięcie w bloku danych,
 * `c` — długość spakowana, `u` — długość rozpakowana (do kontroli).
 */
function zbudujLadunek(wpisy) {
  const indeks = [];
  const kawalki = [];
  let przesuniecie = 0;

  for (const [naDysku, wPakiecie] of wpisy) {
    const surowe = readFileSync(naDysku);
    const spakowane = deflateRawSync(surowe, { level: 9 });
    indeks.push({
      p: wPakiecie.split(path.sep).join('/'),
      o: przesuniecie,
      c: spakowane.length,
      u: surowe.length,
    });
    kawalki.push(spakowane);
    przesuniecie += spakowane.length;
  }

  const indeksJson = Buffer.from(JSON.stringify(indeks), 'utf8');
  const naglowek = Buffer.alloc(9);
  naglowek.write('RIEP1', 0, 'ascii');
  naglowek.writeUInt32LE(indeksJson.length, 5);

  return {
    bufor: Buffer.concat([naglowek, indeksJson, ...kawalki]),
    plikow: indeks.length,
    surowo: indeks.reduce((a, w) => a + w.u, 0),
  };
}

/* ------------------------------ Budowa -------------------------------- */

console.log(`› Instalator ResInvest ERP ${WERSJA} (kompilator: ${KOMPILATOR})`);

if (existsSync(PRACA)) rmSync(PRACA, { recursive: true, force: true });
mkdirSync(PRACA, { recursive: true });
mkdirSync(DIST, { recursive: true });

/* 1. Launcher — gotowy plik wykonywalny w ładunku.
      Dzięki temu instalacja nie wymaga kompilatora na komputerze firmy;
      `ZBUDUJ-EXE.bat` zostaje wyłącznie jako awaryjne wyjście. */
const launcher = path.join(PRACA, 'ResInvestERP.exe');
kompiluj(
  path.join(ROOT, 'desktop/installer/ResInvestERP.cs'),
  launcher,
  { ikona: path.join(ROOT, 'desktop/installer/ResInvestERP.ico') },
);
console.log(`  ✓ launcher ResInvestERP.exe (${(statSync(launcher).size / 1024).toFixed(0)} kB)`);

/* 2. Wersja jednoplikowa — jedyna droga na komputerze bez Node.js.
      Buduje się osobnym poleceniem, więc tutaj tylko sprawdzamy, czy jest. */
const jednoplikowa = path.join(DIST, 'ResInvestERP.html');
if (!existsSync(jednoplikowa)) {
  throw new Error(
    'Brak dist/ResInvestERP.html — zbuduj ją najpierw:  npm run build:html\n'
    + 'Instalator niesie ją jako wariant dla komputerów bez Node.js.',
  );
}

/* 3. Ładunek. */
const wpisy = [
  ...KATALOGI.flatMap(zbierzKatalog),
  ...PLIKI.map(([z, docelowa]) => [path.join(ROOT, z), docelowa]),
  [launcher, 'ResInvestERP.exe'],
  [jednoplikowa, 'ResInvestERP.html'],
];

for (const [naDysku] of wpisy) {
  if (!existsSync(naDysku)) throw new Error(`Brak pliku: ${naDysku}`);
}

const ladunek = zbudujLadunek(wpisy);
const plikLadunku = path.join(PRACA, 'ladunek.bin');
writeFileSync(plikLadunku, ladunek.bufor);
console.log(
  `  ✓ ładunek: ${ladunek.plikow} plików, `
  + `${(ladunek.surowo / 1024 / 1024).toFixed(2)} MB → ${(ladunek.bufor.length / 1024 / 1024).toFixed(2)} MB`,
);

/* 4. Instalator. Wersja i nazwa produktu idą do kodu, żeby nie rozjechały się
      z package.json — to jedno źródło prawdy. */
const zrodloSetup = path.join(ROOT, 'desktop/setup/Setup.cs');
const zrodloGui = path.join(ROOT, 'desktop/setup/SetupGui.cs');
const zrodloZWersja = path.join(PRACA, 'Setup.cs');
const tekst = readFileSync(zrodloSetup, 'utf8')
  .replace(/const string WERSJA = "[^"]*";/, `const string WERSJA = "${WERSJA}";`);
if (!tekst.includes(`const string WERSJA = "${WERSJA}";`)) {
  throw new Error('Nie udało się wstawić numeru wersji do Setup.cs — zmieniła się deklaracja?');
}
writeFileSync(zrodloZWersja, tekst);

kompiluj([zrodloZWersja, zrodloGui], WYNIK, {
  ikona: path.join(ROOT, 'desktop/installer/ResInvestERP.ico'),
  zasoby: [[plikLadunku, 'ladunek.bin']],
});

/* 5. Samokontrola gotowego pliku.
      Kompilacja bez błędów nie mówi nic o tym, czy ładunek da się rozpakować
      i czy konfiguracja powstanie poprawna. Instalator sprawdza to sam,
      na sobie — a budowanie przerywa się, gdy coś nie gra. Zepsuty instalator
      nie ma prawa opuścić tego skryptu. */
function samokontrola(plik) {
  const naWindows = process.platform === 'win32';
  const [program, argumenty] = naWindows
    ? [plik, ['/samokontrola']]
    : ['mono', [plik, '/samokontrola']];
  try {
    const wyjscie = execFileSync(program, argumenty, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, wyjscie };
  } catch (err) {
    if (!naWindows && err.code === 'ENOENT') {
      return { ok: null, wyjscie: 'Brak `mono` — samokontroli nie uruchomiono.' };
    }
    return { ok: false, wyjscie: `${err.stdout ?? ''}${err.stderr ?? ''}`.trim() };
  }
}

const kontrola = samokontrola(WYNIK);
if (kontrola.ok === false) {
  console.error(kontrola.wyjscie);
  throw new Error('Samokontrola instalatora nie przeszła — plik NIE jest zdatny do wydania.');
}
console.log(kontrola.ok
  ? `  ✓ samokontrola: ${(kontrola.wyjscie.match(/\[OK\]/g) ?? []).length} sprawdzeń bez zastrzeżeń`
  : `  ! samokontrola pominięta: ${kontrola.wyjscie}`);

/* 6. Suma kontrolna — do ogłoszenia razem z plikiem. Pozwala sprawdzić,
      że pobrany plik jest dokładnie tym, który opuścił budowę. */
const bajty = readFileSync(WYNIK);
const sha256 = createHash('sha256').update(bajty).digest('hex');
const nazwaPliku = path.basename(WYNIK);
writeFileSync(`${WYNIK}.sha256`, `${sha256}  ${nazwaPliku}\n`, 'utf8');

/* Ten sam skrót w postaci gotowej do wklejenia w PowerShell — księgowa
   czy informatyk firmy nie musi szukać, czym to sprawdzić. */
writeFileSync(
  path.join(DIST, `SPRAWDZ-SUME-KONTROLNA-${WERSJA}.txt`),
  [
    'Kontrola sumy kontrolnej pliku instalacyjnego',
    '=============================================',
    '',
    `Plik      : ${nazwaPliku}`,
    `Rozmiar   : ${bajty.length} bajtów`,
    `SHA-256   : ${sha256}`,
    '',
    'Windows (PowerShell) — wklej i porównaj wynik z powyższym:',
    '',
    `    Get-FileHash .\\${nazwaPliku} -Algorithm SHA256 | Format-List`,
    '',
    'Linux / macOS:',
    '',
    `    sha256sum ${nazwaPliku}`,
    '',
    'Jeżeli skróty się różnią, NIE uruchamiaj pliku — pobranie było',
    'niepełne albo plik został po drodze zmieniony.',
    '',
  ].join('\n'),
  'utf8',
);

rmSync(PRACA, { recursive: true, force: true });

const mb = (bajty.length / 1024 / 1024).toFixed(2);
console.log(`
╭─ Instalator gotowy ─────────────────────────────────────────╮
│  Plik      : dist/${nazwaPliku}
│  Rozmiar   : ${mb} MB
│  SHA-256   : ${sha256.slice(0, 32)}…
│  Zawiera   : serwer, interfejs, dokumentację, launcher,
│              wersję jednoplikową (dla komputerów bez Node.js)
╰─────────────────────────────────────────────────────────────╯`);

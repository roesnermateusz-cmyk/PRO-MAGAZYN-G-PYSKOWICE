/**
 * Kontrola zawartości zbudowanej aplikacji przed przekazaniem instalatora.
 *
 * Powód istnienia tego skryptu:
 * archiwum `asar` jest czytelne dla Electrona tylko w trybie CommonJS. Serwer
 * jest modułem ESM, a resolver ESM Node.js archiwum nie widzi. Jeżeli zależności
 * zostaną spakowane do `app.asar`, instalator zbuduje się poprawnie, przejdzie
 * kontrolę rozmiaru i sum kontrolnych, a mimo to **zainstalowany program nie
 * uruchomi serwera** - Node zgłosi ERR_MODULE_NOT_FOUND. Błąd tego rodzaju widać
 * dopiero po instalacji, dlatego sprawdzamy go tutaj, przy każdym budowaniu.
 *
 * Kontrolowane są:
 *   1. dokładnie jeden plik instalatora w katalogu wynikowym,
 *   2. obecność programu głównego, archiwum asar i modułu natywnego,
 *   3. nagłówek PE modułu natywnego (Windows x86-64),
 *   4. migracje i aplikacja kliencka,
 *   5. **rzeczywiste rozwiązanie zależności ESM z katalogu serwera** - tak samo,
 *      jak zrobi to Node po instalacji.
 *
 * Uruchamiane automatycznie na końcu `npm run dist`.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, '..');
const releaseDir = path.join(desktopRoot, 'release');
const appDir = path.join(releaseDir, 'win-unpacked');
const unpacked = path.join(appDir, 'resources', 'app.asar.unpacked');

const problemy = [];
function sprawdz(warunek, opis, szczegol) {
  if (warunek) {
    console.log(`  OK   ${opis}`);
  } else {
    console.log(`  BŁĄD ${opis}${szczegol ? ` - ${szczegol}` : ''}`);
    problemy.push(opis);
  }
}

if (!fs.existsSync(appDir)) {
  console.error(`BŁĄD: brak katalogu ${appDir}. Uruchom najpierw: npm run dist`);
  process.exit(1);
}

console.log('Kontrola zawartości zbudowanej aplikacji');

// 1. Dokładnie jeden plik instalatora - wymaganie: instalator nie może być dzielony.
const instalatory = fs.readdirSync(releaseDir).filter((f) => f.toLowerCase().endsWith('.exe'));
sprawdz(instalatory.length === 1, 'dokładnie jeden plik .exe w katalogu release', `znaleziono ${instalatory.length}: ${instalatory.join(', ')}`);

// 2. Podstawowe składniki pakietu.
const nativeModule = path.join(unpacked, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
for (const [plik, opis] of [
  [path.join(appDir, 'ResInvest ERP.exe'), 'program główny'],
  [path.join(appDir, 'resources', 'app.asar'), 'archiwum app.asar'],
  [nativeModule, 'moduł natywny bazy danych'],
  [path.join(unpacked, 'server', 'index.js'), 'punkt wejścia serwera'],
  [path.join(unpacked, 'server', 'db', 'migrations', '001_init.sql'), 'migracje schematu bazy'],
  [path.join(unpacked, 'client', 'index.html'), 'aplikacja kliencka'],
]) {
  sprawdz(fs.existsSync(plik), opis, `brak ${path.relative(appDir, plik)}`);
}

// 3. Moduł natywny musi być biblioteką DLL dla Windows x86-64.
if (fs.existsSync(nativeModule)) {
  const buf = fs.readFileSync(nativeModule);
  const mz = buf.length > 0x40 && buf[0] === 0x4d && buf[1] === 0x5a;
  const peOff = mz ? buf.readUInt32LE(0x3c) : 0;
  const pe = mz && peOff + 6 <= buf.length && buf.readUInt32LE(peOff) === 0x0000_4550;
  const x64 = pe && buf.readUInt16LE(peOff + 4) === 0x8664;
  sprawdz(x64, 'moduł natywny jest biblioteką Windows x86-64');
}

// 4. Rozwiązanie zależności ESM dokładnie z katalogu, z którego wystartuje serwer.
const serverDir = path.join(unpacked, 'server');
if (fs.existsSync(serverDir)) {
  const zaleznosci = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8')).dependencies ?? {};
  // Moduły natywne tylko rozwiązujemy - pliku dla Windows nie da się załadować
  // na maszynie budującej z innym systemem.
  const tylkoSciezka = new Set(['better-sqlite3']);
  // UWAGA: samo "import zadziałał" niczego nie dowodzi. Katalog release leży
  // wewnątrz desktop/, więc Node idąc w górę drzewa trafiłby na desktop/node_modules
  // i znalazł pakiet tam. Na komputerze użytkownika takiego katalogu nadrzędnego
  // nie ma. Dlatego sprawdzamy, **skąd** pakiet został rozwiązany - ścieżka musi
  // wskazywać na app.asar.unpacked.
  const probka = path.join(serverDir, `__kontrola-${process.pid}.mjs`);
  const kod = `
const pakiety = ${JSON.stringify(Object.keys(zaleznosci))};
const wynik = {};
for (const d of pakiety) {
  try { wynik[d] = import.meta.resolve(d); } catch (e) { wynik[d] = 'BLAD:' + (e.code ?? e.message); }
}
console.log(JSON.stringify(wynik));
`;
  fs.writeFileSync(probka, kod);
  let surowe = '';
  try {
    surowe = execFileSync(process.execPath, [probka], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    surowe = '';
    problemy.push('uruchomienie próbki rozwiązywania zależności');
    console.log(`  BŁĄD uruchomienie próbki - ${String(error.stderr ?? error.message).trim().split('\n')[0]}`);
  } finally {
    fs.rmSync(probka, { force: true });
  }

  if (surowe) {
    const oczekiwanyPrefiks = new URL(`file://${path.join(unpacked, 'node_modules').replace(/\\/g, '/')}`).href;
    const rozwiazane = JSON.parse(surowe);
    const zle = [];
    for (const [pakiet, url] of Object.entries(rozwiazane)) {
      if (typeof url !== 'string' || url.startsWith('BLAD:')) {
        zle.push(`${pakiet}: nie rozwiązano (${String(url).replace('BLAD:', '')})`);
      } else if (!decodeURIComponent(url).startsWith(decodeURIComponent(oczekiwanyPrefiks))) {
        // Pakiet znaleziony poza pakietem aplikacji - po instalacji go nie będzie.
        zle.push(`${pakiet}: rozwiązany spoza pakietu (${decodeURIComponent(url)})`);
      }
    }
    sprawdz(
      zle.length === 0,
      `zależności serwera (${Object.keys(rozwiazane).length}) rozwiązują się z app.asar.unpacked/node_modules`,
      zle[0] ?? '',
    );
    if (zle.length > 1) for (const z of zle.slice(1)) console.log(`       ${z}`);
  }

  // Dodatkowo: moduły w czystym JS muszą dać się faktycznie załadować.
  const doZaladowania = Object.keys(zaleznosci).filter((d) => !tylkoSciezka.has(d));
  const probka2 = path.join(serverDir, `__kontrola-load-${process.pid}.mjs`);
  fs.writeFileSync(
    probka2,
    `for (const d of ${JSON.stringify(doZaladowania)}) { await import(d); }\n`,
  );
  let zaladowane = true;
  let szczegolLadowania = '';
  try {
    execFileSync(process.execPath, [probka2], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (error) {
    zaladowane = false;
    szczegolLadowania = String(error.stderr ?? '').trim().split('\n').filter(Boolean).pop() ?? '';
  } finally {
    fs.rmSync(probka2, { force: true });
  }
  sprawdz(zaladowane, `zależności serwera dają się załadować (${doZaladowania.length})`, szczegolLadowania);
}

if (problemy.length > 0) {
  console.error(`\nKontrola nieudana: ${problemy.length} problem(ów). Instalator nie nadaje się do przekazania.`);
  process.exit(1);
}

console.log(`Pakiet poprawny. Instalator: ${instalatory[0]}`);

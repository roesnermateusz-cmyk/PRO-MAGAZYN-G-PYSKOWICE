/**
 * Przygotowuje moduły natywne dla instalatora Windows.
 *
 * Dlaczego ten krok istnieje:
 * better-sqlite3 to moduł napisany w C++. Plik binarny musi pasować do trzech
 * rzeczy naraz - systemu (win32), architektury (x64) oraz ABI Electrona.
 * Kompilacja pod Windows wymaga kompilatora MSVC, więc na maszynie z systemem
 * Linux nie da się takiego pliku zbudować. Zamiast tego pobieramy oficjalny,
 * gotowy plik publikowany przez autorów biblioteki i weryfikujemy go.
 *
 * Weryfikacja obejmuje:
 *   1. zgodność wersji pakietu i ABI Electrona z tym, co jest zainstalowane,
 *   2. sumę SHA-256 archiwum oraz samego pliku .node (ochrona łańcucha dostaw),
 *   3. nagłówek PE - plik musi być biblioteką DLL dla Windows x86-64.
 *
 * Każdy błąd przerywa budowanie. Skrypt nigdy nie podstawia pliku zastępczego.
 *
 * Uruchamiane automatycznie przez `npm run dist`.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAbi } from 'node-abi';
import * as tar from 'tar';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, '..');

const manifest = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));
const pinned = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'native-prebuilds.json'), 'utf8'));

function fail(message, hint) {
  console.error(`BŁĄD: ${message}`);
  if (hint) console.error(`       ${hint}`);
  process.exit(1);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Wersja Electrona, pod którą pakujemy aplikację - bez zakresu semver. */
function resolveElectronVersion() {
  const installed = path.join(desktopRoot, 'node_modules', 'electron', 'package.json');
  if (!fs.existsSync(installed)) {
    fail('brak zainstalowanego pakietu electron.', 'Uruchom: npm install');
  }
  return JSON.parse(fs.readFileSync(installed, 'utf8')).version;
}

/** Wersja modułu natywnego faktycznie rozwiązana przez npm. */
function resolveInstalledVersion(pkg) {
  const installed = path.join(desktopRoot, 'node_modules', pkg, 'package.json');
  if (!fs.existsSync(installed)) {
    fail(`brak zainstalowanego pakietu ${pkg}.`, 'Uruchom: npm install');
  }
  return JSON.parse(fs.readFileSync(installed, 'utf8')).version;
}

/**
 * Pobieranie przez curl, jeżeli jest dostępny - curl respektuje zmienne
 * środowiskowe serwera proxy, co jest istotne w sieciach firmowych.
 * W razie braku curl-a używamy wbudowanego fetch.
 */
async function download(url) {
  try {
    execFileSync('curl', ['--version'], { stdio: 'ignore' });
    return execFileSync('curl', ['-sS', '-L', '--fail', '--max-time', '300', '-o', '-', url], {
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (error) {
    if (error?.status !== undefined) {
      fail(`pobieranie nie powiodło się: ${url}`, `curl zakończył się kodem ${error.status}.`);
    }
  }

  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    fail(`pobieranie nie powiodło się: ${url}`, `Serwer odpowiedział kodem ${response.status}.`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Sprawdza nagłówek PE (Portable Executable). Plik .node dla Windows jest
 * biblioteką DLL, więc musi zaczynać się od "MZ", zawierać sygnaturę "PE\0\0"
 * i deklarować maszynę 0x8664 (x86-64).
 */
function assertWindowsX64Dll(buffer, label) {
  if (buffer.length < 0x40 || buffer[0] !== 0x4d || buffer[1] !== 0x5a) {
    fail(`${label}: plik nie jest programem dla Windows (brak sygnatury MZ).`);
  }
  const peOffset = buffer.readUInt32LE(0x3c);
  if (peOffset + 6 > buffer.length || buffer.readUInt32LE(peOffset) !== 0x0000_4550) {
    fail(`${label}: plik nie zawiera poprawnego nagłówka PE.`);
  }
  const machine = buffer.readUInt16LE(peOffset + 4);
  if (machine !== 0x8664) {
    fail(`${label}: architektura 0x${machine.toString(16)} zamiast x86-64 (0x8664).`);
  }
}

const electronVersion = resolveElectronVersion();
const electronAbi = Number(getAbi(electronVersion, 'electron'));

console.log('Przygotowanie modułów natywnych dla instalatora Windows');
console.log(`  Electron:     ${electronVersion} (ABI ${electronAbi})`);
console.log(`  System celu:  win32 x64`);

const cacheDir = path.join(os.tmpdir(), 'resinvest-erp-prebuilds');
fs.mkdirSync(cacheDir, { recursive: true });

for (const entry of pinned.prebuilds) {
  const installedVersion = resolveInstalledVersion(entry.package);

  if (installedVersion !== entry.version) {
    fail(
      `${entry.package}: zainstalowana wersja ${installedVersion} nie odpowiada przypiętej ${entry.version}.`,
      'Zaktualizuj desktop/native-prebuilds.json albo cofnij zmianę wersji w package.json.',
    );
  }
  if (electronAbi !== entry.abi) {
    fail(
      `${entry.package}: Electron ${electronVersion} używa ABI ${electronAbi}, a przypięty plik jest dla ABI ${entry.abi}.`,
      'Sprawdź, czy dla nowego ABI istnieje gotowy plik binarny, i zaktualizuj desktop/native-prebuilds.json.',
    );
  }

  const archivePath = path.join(cacheDir, path.basename(entry.url));
  let archive = fs.existsSync(archivePath) ? fs.readFileSync(archivePath) : null;

  if (archive && sha256(archive) !== entry.archiveSha256) {
    console.log(`  ${entry.package}: zawartość pamięci podręcznej nieaktualna - pobieram ponownie.`);
    archive = null;
  }
  if (!archive) {
    console.log(`  ${entry.package}: pobieranie ${entry.url}`);
    archive = await download(entry.url);
    fs.writeFileSync(archivePath, archive);
  } else {
    console.log(`  ${entry.package}: użyto pliku z pamięci podręcznej.`);
  }

  const archiveDigest = sha256(archive);
  if (archiveDigest !== entry.archiveSha256) {
    fail(
      `${entry.package}: suma kontrolna archiwum się nie zgadza.`,
      `oczekiwano ${entry.archiveSha256}, otrzymano ${archiveDigest}`,
    );
  }

  const extractDir = fs.mkdtempSync(path.join(cacheDir, 'wypakowane-'));
  await tar.x({ file: archivePath, cwd: extractDir });

  const extracted = path.join(extractDir, entry.binaryPath);
  if (!fs.existsSync(extracted)) {
    fail(`${entry.package}: archiwum nie zawiera pliku ${entry.binaryPath}.`);
  }

  const binary = fs.readFileSync(extracted);
  const binaryDigest = sha256(binary);
  if (binaryDigest !== entry.binarySha256) {
    fail(
      `${entry.package}: suma kontrolna pliku binarnego się nie zgadza.`,
      `oczekiwano ${entry.binarySha256}, otrzymano ${binaryDigest}`,
    );
  }
  assertWindowsX64Dll(binary, entry.package);

  const target = path.join(desktopRoot, 'node_modules', entry.package, entry.binaryPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, binary);
  fs.rmSync(extractDir, { recursive: true, force: true });

  const sizeKb = Math.round(binary.length / 1024);
  console.log(`  ${entry.package} ${entry.version}: PE32+ x86-64, ${sizeKb} kB, SHA-256 zgodna.`);
  console.log(`    zapisano: node_modules/${entry.package}/${entry.binaryPath}`);
}

console.log('Moduły natywne gotowe do spakowania.');

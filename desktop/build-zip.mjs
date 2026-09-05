#!/usr/bin/env node
/**
 * Buduje pakiet instalacyjny .ZIP dla stanowiska desktopowego.
 *
 *   npm run build:installer
 *
 * Pakiet zawiera komplet aplikacji (serwer, front, migracje, dane testowe)
 * oraz skrypty instalacji i uruchomienia dla Windows, Linuksa i macOS.
 * Aplikacja nie ma zależności npm, więc instalacja działa bez dostępu do sieci —
 * wymagane jest wyłącznie środowisko Node.js 22+ na komputerze docelowym.
 *
 * Implementacja archiwum: własny zapis formatu ZIP (metoda „stored”, bez kompresji)
 * — Node nie ma wbudowanego pakowania ZIP, a projekt świadomie nie używa
 * zależności zewnętrznych. Archiwum otwiera każdy menedżer plików.
 */
import {
  readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync, rmSync, copyFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const NAME = `ResInvest-ERP-${pkg.version}`;
const STAGE = path.join(DIST, NAME);

/* Co trafia do pakietu (ścieżka źródłowa → ścieżka w archiwum). */
const INCLUDE_DIRS = ['server/src', 'server/scripts', 'server/seed', 'web', 'docs'];
const INCLUDE_FILES = [
  ['package.json', 'package.json'],
  ['LICENSE', 'LICENSE'],
  ['README.md', 'README.md'],
  ['.env.example', '.env.example'],
  ['desktop/installer/INSTALUJ.bat', 'INSTALUJ.bat'],
  ['desktop/installer/ZBUDUJ-EXE.bat', 'ZBUDUJ-EXE.bat'],
  ['desktop/installer/ResInvestERP.cs', 'ResInvestERP.cs'],
  ['desktop/installer/ResInvestERP.ico', 'ResInvestERP.ico'],
  ['desktop/installer/START.bat', 'START.bat'],
  ['desktop/installer/KOPIA-ZAPASOWA.bat', 'KOPIA-ZAPASOWA.bat'],
  ['desktop/installer/instaluj.sh', 'instaluj.sh'],
  ['desktop/installer/start.sh', 'start.sh'],
  ['desktop/installer/kopia-zapasowa.sh', 'kopia-zapasowa.sh'],
];

const EXECUTABLE = new Set(['instaluj.sh', 'start.sh', 'kopia-zapasowa.sh']);

/* ----------------------------- Przygotowanie --------------------------- */

console.log(`› Budowanie pakietu ${NAME}…`);
if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

/** Kopiuje katalog rekurencyjnie, pomijając artefakty i dane runtime. */
function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    if (['node_modules', '.git', '.DS_Store'].includes(entry)) continue;
    const source = path.join(from, entry);
    const target = path.join(to, entry);
    if (statSync(source).isDirectory()) copyDir(source, target);
    else copyFileSync(source, target);
  }
}

for (const dir of INCLUDE_DIRS) {
  const source = path.join(ROOT, dir);
  if (existsSync(source)) copyDir(source, path.join(STAGE, dir));
}
for (const [from, to] of INCLUDE_FILES) {
  const source = path.join(ROOT, from);
  if (existsSync(source)) {
    mkdirSync(path.dirname(path.join(STAGE, to)), { recursive: true });
    copyFileSync(source, path.join(STAGE, to));
  }
}

/* Puste katalogi na dane runtime (z plikiem-znacznikiem, by przetrwały ZIP). */
for (const dir of ['data', 'data/attachments', 'data/backups', 'data/logs']) {
  mkdirSync(path.join(STAGE, dir), { recursive: true });
  writeFileSync(path.join(STAGE, dir, '.gitkeep'), '');
}

/* Skrócona instrukcja widoczna zaraz po rozpakowaniu. */
writeFileSync(path.join(STAGE, 'CZYTAJ-TO-NAJPIERW.txt'), `
ResInvest ERP ${pkg.version} — Magazyn Biomasy
===============================================================

WYMAGANIA
  Node.js w wersji 22 lub nowszej — https://nodejs.org/pl
  (instalator LTS, opcje domyślne)

INSTALACJA — WINDOWS
  1. Rozpakuj całe archiwum do wybranego katalogu,
     np. C:\\ResInvest-ERP  (nie uruchamiaj plików z wnętrza ZIP-a).
  2. Kliknij dwukrotnie INSTALUJ.bat
  3. Zapisz wyświetlone dane pierwszego logowania.
  4. Uruchom system plikiem ResInvestERP.exe albo skrótem z pulpitu.

  Instalator buduje ResInvestERP.exe kompilatorem wbudowanym w Windows —
  nic nie trzeba pobierać. Program działa w zasobniku obok zegara; prawy
  przycisk na ikonie otwiera menu z opcją zakończenia pracy systemu.
  Gdyby kompilatora zabrakło, system uruchamia się plikiem START.bat.

INSTALACJA — LINUX / macOS
  1. Rozpakuj archiwum.
  2. chmod +x *.sh && ./instaluj.sh
  3. ./start.sh

ADRES APLIKACJI
  http://localhost:4173

PRACA Z TELEFONU W SIECI FIRMOWEJ
  W pliku .env ustaw HOST=0.0.0.0, zrestartuj system i wejdź
  z telefonu pod adres http://<adres-IP-komputera>:4173

KOPIA ZAPASOWA
  KOPIA-ZAPASOWA.bat  (Windows)  /  ./kopia-zapasowa.sh  (Linux, macOS)
  System wykonuje też kopię automatycznie raz na dobę.
  Katalog "data" (baza + skany dokumentów) obejmij firmową kopią zapasową.

PEŁNA DOKUMENTACJA
  README.md oraz katalog docs/:
    docs/ARCHITECTURE.md  — architektura systemu
    docs/DATABASE.md      — schemat bazy danych
    docs/API.md           — punkty końcowe API
    docs/UI.md            — architektura interfejsu
    docs/DEPLOYMENT.md    — wdrożenie na serwerze firmowym

WSPARCIE
  Autor: Mateusz Roesner · ResInvest Commodities PL, Zabrze
`.trimStart(), 'utf8');

/* ------------------------------ Archiwum ZIP --------------------------- */

/** Data i czas w formacie MS-DOS używanym przez ZIP. */
function dosDateTime(date) {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() / 2)) & 0xffff;
  const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  return { time, day };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i += 1) crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** Zbiera pliki do spakowania wraz ze ścieżkami względnymi. */
function collect(dir, base = '') {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    const rel = base ? `${base}/${entry}` : entry;
    if (statSync(full).isDirectory()) out.push(...collect(full, rel));
    else out.push({ full, rel });
  }
  return out;
}

const files = collect(STAGE);
const localParts = [];
const centralParts = [];
let offset = 0;

for (const file of files) {
  const raw = readFileSync(file.full);
  const deflated = zlib.deflateRawSync(raw, { level: 9 });
  // Metoda 8 (deflate) tylko wtedy, gdy faktycznie zmniejsza rozmiar.
  const useDeflate = deflated.length < raw.length;
  const data = useDeflate ? deflated : raw;
  const method = useDeflate ? 8 : 0;

  const name = Buffer.from(`${NAME}/${file.rel}`, 'utf8');
  const { time, day } = dosDateTime(statSync(file.full).mtime);
  const crc = crc32(raw);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);   // sygnatura nagłówka lokalnego
  local.writeUInt16LE(20, 4);           // wymagana wersja
  local.writeUInt16LE(0x0800, 6);       // flaga: nazwy plików w UTF-8
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(day, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  localParts.push(local, name, data);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); // sygnatura katalogu centralnego
  central.writeUInt16LE(0x031E, 4);     // utworzone w systemie UNIX
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(day, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(name.length, 28);
  // Prawa dostępu: skrypty powłoki wykonywalne (0755), reszta 0644.
  // Przesunięcie o 16 bitów przekracza zakres liczby ze znakiem — stąd `>>> 0`.
  const mode = EXECUTABLE.has(path.basename(file.rel)) ? 0o100755 : 0o100644;
  central.writeUInt32LE((mode << 16) >>> 0, 38);
  central.writeUInt32LE(offset, 42);
  centralParts.push(central, name);

  offset += local.length + name.length + data.length;
}

const centralBuffer = Buffer.concat(centralParts);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralBuffer.length, 12);
end.writeUInt32LE(offset, 16);

const archivePath = path.join(DIST, `${NAME}.zip`);
writeFileSync(archivePath, Buffer.concat([...localParts, centralBuffer, end]));

const sizeMb = (statSync(archivePath).size / 1024 / 1024).toFixed(2);
console.log(`\n╭─ Pakiet instalacyjny gotowy ───────────────────────────────╮`);
console.log(`│  Plik    : dist/${NAME}.zip`);
console.log(`│  Rozmiar : ${sizeMb} MB`);
console.log(`│  Plików  : ${files.length}`);
console.log('│');
console.log('│  Zawartość: serwer, aplikacja kliencka, migracje, dane');
console.log('│  testowe, dokumentacja oraz skrypty instalacji dla');
console.log('│  Windows (INSTALUJ.bat) i Linux/macOS (instaluj.sh).');
console.log('╰────────────────────────────────────────────────────────────╯\n');

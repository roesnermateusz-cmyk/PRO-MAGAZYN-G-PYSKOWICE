/**
 * Kopiuje zbudowany serwer i aplikację kliencką do katalogu desktop/,
 * skąd electron-builder pakuje je do instalatora.
 *
 * Uruchamiane automatycznie przed `npm run dist`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, '..');
const repoRoot = path.resolve(desktopRoot, '..');

const serverDist = path.join(repoRoot, 'server', 'dist');
const clientDist = path.join(repoRoot, 'client', 'dist');
const targetServer = path.join(desktopRoot, 'server');
const targetClient = path.join(desktopRoot, 'client');

function requireBuild(dir, hint) {
  if (!fs.existsSync(dir)) {
    console.error(`BŁĄD: brak katalogu ${dir}.`);
    console.error(`Uruchom najpierw: ${hint}`);
    process.exit(1);
  }
}

requireBuild(serverDist, 'npm run build -w server');
requireBuild(clientDist, 'npm run build -w client');

for (const dir of [targetServer, targetClient]) {
  fs.rmSync(dir, { recursive: true, force: true });
}

fs.cpSync(serverDist, targetServer, { recursive: true });
fs.cpSync(clientDist, targetClient, { recursive: true });

// Powłoka Electrona jest modułem CommonJS, a serwer - modułem ESM.
// Lokalny manifest w podkatalogu rozstrzyga typ bez zmiany głównego package.json.
fs.writeFileSync(
  path.join(targetServer, 'package.json'),
  `${JSON.stringify({ name: 'resinvest-erp-server-payload', private: true, type: 'module' }, null, 2)}\n`,
);

const migrations = path.join(targetServer, 'db', 'migrations');
if (!fs.existsSync(migrations) || fs.readdirSync(migrations).length === 0) {
  console.error('BŁĄD: w buildzie serwera brakuje plików migracji (server/dist/db/migrations).');
  process.exit(1);
}

console.log('Przygotowano zawartość instalatora:');
console.log(`  serwer:  ${targetServer}`);
console.log(`  klient:  ${targetClient}`);
console.log(`  migracje: ${fs.readdirSync(migrations).length} plik(ów)`);

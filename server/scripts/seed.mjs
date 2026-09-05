#!/usr/bin/env node
/**
 * Generator przykładowych danych testowych — powłoka wiersza poleceń.
 *
 *   npm run seed          — dopisuje dane do istniejącej bazy
 *   npm run seed:reset    — czyści rejestr dokumentów i generuje od nowa
 *
 * Cała logika mieszka w `server/src/seed/demo-seed.js`, bo korzysta z niej
 * także wersja jednoplikowa. Tutaj zostaje wyłącznie odczyt pliku, kontekst
 * użytkownika i wypisanie podsumowania.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import db from '../src/db/index.js';
import { bootstrap } from '../src/bootstrap.js';
import { seedDatabase } from '../src/seed/demo-seed.js';

const SEED_FILE = path.join(fileURLToPath(new URL('../seed', import.meta.url)), 'demo-data.json');
const seed = JSON.parse(readFileSync(SEED_FILE, 'utf8'));
const reset = process.argv.includes('--reset');

console.log('› Inicjalizacja bazy…');
bootstrap();

const admin = db.get("SELECT id, email, full_name, role FROM users WHERE role = 'ADMIN' ORDER BY created_at LIMIT 1");
const ctx = {
  user: { id: admin.id, email: admin.email, fullName: admin.full_name, role: admin.role },
  ip: '127.0.0.1',
  userAgent: 'seed-script',
};

const result = seedDatabase(seed, { reset, ctx, log: (msg) => console.log(`› ${msg}`) });
for (const warning of result.warnings) console.warn(`  ! ${warning}`);

console.log('\n╭─ Dane testowe wygenerowane ────────────────────────────────╮');
console.log(`│  Łańcuchy terenowe   : ${result.chains}`);
console.log(`│  Dokumenty łącznie   : ${result.summary.documents}`);
console.log(`│  Wartość zakupów     : ${result.summary.purchase ?? 0} zł`);
console.log(`│  Wartość sprzedaży   : ${result.summary.sale ?? 0} zł`);
console.log(`│  Koszty transportu   : ${result.summary.transport ?? 0} zł`);
console.log('├─ Stan magazynowy ──────────────────────────────────────────┤');
for (const s of result.stock) console.log(`│  ${s.product_name.padEnd(38)} ${String(s.mp).padStart(10)} MP`);
if (result.users.length) {
  console.log('├─ Konta testowe (hasło do zmiany przy 1. logowaniu) ────────┤');
  for (const u of result.users) console.log(`│  ${u.role.padEnd(11)} ${u.email.padEnd(28)} ${u.password}`);
}
console.log('╰────────────────────────────────────────────────────────────╯\n');

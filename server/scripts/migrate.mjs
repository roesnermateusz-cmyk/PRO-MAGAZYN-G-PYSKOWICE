#!/usr/bin/env node
/**
 * Uruchamia migracje bazy danych bez startowania serwera.
 * Używane przy aktualizacji wersji na stanowisku produkcyjnym:
 *
 *   npm run migrate
 */
import { openDatabase, runMigrations, closeDatabase } from '../src/db/index.js';
import config from '../src/config/env.js';

openDatabase();
const applied = runMigrations();

if (applied.length) {
  console.log(`Zastosowano ${applied.length} migracji: ${applied.join(', ')}`);
} else {
  console.log('Baza danych jest aktualna — brak migracji do zastosowania.');
}
console.log(`Plik bazy: ${config.db.file}`);
closeDatabase();

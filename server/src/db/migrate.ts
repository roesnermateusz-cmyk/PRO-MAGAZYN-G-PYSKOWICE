import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './index.js';
import { logger } from '../core/logger.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Katalog z migracjami. Po kompilacji pliki .sql są kopiowane obok dist/,
 * dlatego sprawdzamy oba mozliwe polozenia.
 */
function migrationsDir(): string {
  const candidates = [
    path.join(here, 'migrations'),
    path.join(here, '..', '..', 'src', 'db', 'migrations'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  throw new Error(`Nie znaleziono katalogu migracji. Sprawdzono: ${candidates.join(', ')}`);
}

export function runMigrations(db: Db): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const dir = migrationsDir();
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map((r: any) => r.name as string),
  );

  const executed: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(
        file,
        new Date().toISOString(),
      );
    });
    apply();
    executed.push(file);
    logger.info(`Zastosowano migracje: ${file}`);
  }
  return executed;
}

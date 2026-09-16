import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { env } from '../config/env.js';

export type Db = Database.Database;

let instance: Db | null = null;

function configure(db: Db): void {
  // WAL pozwala na równoczesny odczyt przez wielu użytkowników podczas zapisu.
  db.pragma('journal_mode = WAL');
  // FULL gwarantuje trwałość commitu takze przy zaniku zasilania.
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');
  // Kolejkowanie zamiast błędu SQLITE_BUSY przy równoczesnych zapisach.
  db.pragma('busy_timeout = 10000');
  db.pragma('temp_store = MEMORY');
}

export function getDb(): Db {
  if (instance) return instance;

  const isMemory = env.databaseFile === ':memory:';
  if (!isMemory) {
    fs.mkdirSync(path.dirname(env.databaseFile), { recursive: true });
  }
  const db = new Database(env.databaseFile);
  configure(db);
  instance = db;
  return db;
}

export function closeDb(): void {
  if (!instance) return;
  try {
    instance.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // Checkpoint jest optymalizacja - brak powodzenia nie blokuje zamknięcia.
  }
  instance.close();
  instance = null;
}

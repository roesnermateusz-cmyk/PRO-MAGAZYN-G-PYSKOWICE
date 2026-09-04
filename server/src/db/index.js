/**
 * Warstwa dostępu do bazy danych (SQLite w trybie WAL).
 *
 * Wybór SQLite jest świadomy: system pracuje w jednej lokalizacji (magazyn + biuro),
 * a plik bazy jest łatwy do kopiowania i archiwizacji. Cały dostęp przechodzi przez
 * ten moduł, a zapytania są pisane w przenośnym SQL, dzięki czemu migracja na
 * PostgreSQL sprowadza się do podmiany implementacji `db` (patrz docs/DATABASE.md).
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../config/env.js';
import logger from '../lib/logger.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));

let connection = null;
let statementCache = new Map();

/**
 * Zbiór nazw parametrów faktycznie użytych w zapytaniu.
 *
 * Sterownik `node:sqlite` odrzuca parametry, których zapytanie nie używa.
 * Serwisy budują warunki WHERE warunkowo i wygodnie jest przekazywać wspólny
 * obiekt filtrów, dlatego nadmiarowe klucze odsiewamy tutaj — raz, w jednym
 * miejscu, zamiast pilnować tego w każdym zapytaniu.
 */
const paramNameCache = new Map();

function namedParams(sql) {
  let names = paramNameCache.get(sql);
  if (names) return names;
  // Literały tekstowe usuwamy, żeby dwukropek wewnątrz napisu nie udawał parametru.
  const stripped = sql.replace(/'(?:[^']|'')*'/g, "''");
  names = new Set();
  for (const m of stripped.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)) names.add(m[1]);
  paramNameCache.set(sql, names);
  return names;
}

/** Wartości JS → wartości akceptowane przez sterownik SQLite. */
function normalizeParams(params, sql) {
  if (params === undefined || params === null) return undefined;
  if (Array.isArray(params)) return params.map(normalizeValue);
  const allowed = sql ? namedParams(sql) : null;
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    if (allowed && !allowed.has(k)) continue;
    out[k] = normalizeValue(v);
  }
  return out;
}

function normalizeValue(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (v !== null && typeof v === 'object' && !(v instanceof Uint8Array)) return JSON.stringify(v);
  return v;
}

/** Wiersze zwracane przez sterownik mają prototyp `null` — normalizujemy do zwykłych obiektów. */
const plain = (row) => (row ? { ...row } : row);

/**
 * Klauzula zabezpieczająca wzorce `LIKE` przed metaznakami wpisanymi przez
 * użytkownika. Doklejana do każdego porównania `LIKE`, którego wzorzec
 * pochodzi z `likePattern`.
 */
export const LIKE_ESCAPE = "ESCAPE '\\'";

/**
 * Wzorzec „zawiera” dla `LIKE` z neutralizacją metaznaków.
 *
 * W `LIKE` znaki `%` i `_` mają znaczenie specjalne: `_` pasuje do dowolnego
 * znaku, `%` do dowolnego ciągu. Bez tego wyszukiwanie numeru kwitu „A_B”
 * trafiało też w „AXB”, a szukanie „50%” zwracało cały rejestr — magazynier
 * dostawał wynik wyglądający poprawnie, ale zawierający cudze dokumenty.
 *
 * Wzorzec używać wyłącznie razem z `LIKE_ESCAPE`.
 *
 * @param {string} text fragment wpisany przez użytkownika
 * @returns {string} wzorzec `%…%` z metaznakami poprzedzonymi `\`
 */
export function likePattern(text) {
  return `%${String(text).replace(/[\\%_]/g, '\\$&')}%`;
}

export function openDatabase(file = config.db.file) {
  if (connection) return connection;
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });

  connection = new DatabaseSync(file);
  // WAL: równoległe odczyty w trakcie zapisu — kluczowe przy raportach.
  if (file !== ':memory:') connection.exec('PRAGMA journal_mode = WAL;');
  connection.exec('PRAGMA foreign_keys = ON;');
  connection.exec('PRAGMA busy_timeout = 5000;');
  connection.exec('PRAGMA synchronous = NORMAL;');
  statementCache = new Map();
  logger.info('Baza danych otwarta', { file });
  return connection;
}

export function closeDatabase() {
  if (!connection) return;
  try { connection.close(); } catch { /* połączenie już zamknięte */ }
  connection = null;
  statementCache = new Map();
}

/**
 * Maksymalna liczba zapamiętanych instrukcji. Zapytania listy budowane są
 * z kombinacji filtrów, więc zbiór różnych treści SQL jest skończony, ale
 * rośnie wykładniczo z liczbą filtrów — limit trzyma pamięć w ryzach.
 */
const STATEMENT_CACHE_LIMIT = 256;

function prepare(sql) {
  const cached = statementCache.get(sql);
  if (cached) {
    // Odświeżenie pozycji: Map zachowuje kolejność wstawiania, więc ponowne
    // wstawienie przesuwa wpis na koniec i chroni go przed usunięciem.
    statementCache.delete(sql);
    statementCache.set(sql, cached);
    return cached;
  }
  const stmt = openDatabase().prepare(sql);
  if (statementCache.size >= STATEMENT_CACHE_LIMIT) {
    statementCache.delete(statementCache.keys().next().value);
  }
  statementCache.set(sql, stmt);
  return stmt;
}

export const db = {
  /** Zwraca surowe połączenie (kopie zapasowe, VACUUM). */
  raw: () => openDatabase(),

  /** Wykonuje instrukcje DDL / skrypty wieloinstrukcyjne. */
  exec(sql) {
    openDatabase().exec(sql);
  },

  /** Zapytanie zwracające listę wierszy. */
  all(sql, params) {
    return prepare(sql).all(normalizeParams(params, sql) ?? {}).map(plain);
  },

  /** Zapytanie zwracające pierwszy wiersz lub `undefined`. */
  get(sql, params) {
    return plain(prepare(sql).get(normalizeParams(params, sql) ?? {}));
  },

  /** Zapytanie zwracające pojedynczą wartość z pierwszej kolumny. */
  value(sql, params) {
    const row = this.get(sql, params);
    return row ? Object.values(row)[0] : undefined;
  },

  /** Instrukcja modyfikująca; zwraca `{changes, lastInsertRowid}`. */
  run(sql, params) {
    return prepare(sql).run(normalizeParams(params, sql) ?? {});
  },

  /**
   * Transakcja. Zagnieżdżone wywołania używają SAVEPOINT, więc serwisy
   * mogą swobodnie komponować operacje bez wiedzy o kontekście wywołania.
   */
  tx(fn) {
    const conn = openDatabase();
    const nested = conn.isTransaction === true;
    const name = nested ? `sp_${Math.random().toString(36).slice(2, 10)}` : null;
    conn.exec(nested ? `SAVEPOINT ${name}` : 'BEGIN IMMEDIATE');
    try {
      const result = fn();
      conn.exec(nested ? `RELEASE ${name}` : 'COMMIT');
      return result;
    } catch (err) {
      try { conn.exec(nested ? `ROLLBACK TO ${name}` : 'ROLLBACK'); } catch { /* połączenie w błędzie */ }
      throw err;
    }
  },
};

/* ------------------------------ Migracje ------------------------------ */

/**
 * Uruchamia migracje z katalogu `migrations` w kolejności nazw plików.
 * Każda migracja wykonuje się w transakcji i jest zapisywana w `schema_migrations`.
 */
export function runMigrations() {
  const conn = openDatabase();
  conn.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(db.all('SELECT version FROM schema_migrations').map((r) => r.version));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const executed = [];

  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    conn.exec('BEGIN IMMEDIATE');
    try {
      conn.exec(sql);
      conn.prepare('INSERT INTO schema_migrations(version) VALUES(?)').run(version);
      conn.exec('COMMIT');
      executed.push(version);
      logger.info('Migracja zastosowana', { version });
    } catch (err) {
      conn.exec('ROLLBACK');
      logger.exception('Migracja nie powiodła się', err, { version });
      throw err;
    }
  }
  return executed;
}

export default db;

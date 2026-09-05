/**
 * Warstwa dostępu do bazy — SQLite skompilowany do WebAssembly.
 *
 * Zastępuje `server/src/db/index.js` (tam: `node:sqlite`) i wystawia **dokładnie
 * ten sam interfejs**: `db.all / get / value / run / exec / tx / raw`,
 * `openDatabase`, `runMigrations`, `optimizeDatabase`, `closeDatabase`,
 * `dataVersion`, `likePattern`, `LIKE_ESCAPE`.
 *
 * Dzięki temu serwisy dokumentów, korekt, okresów i raportów działają bez
 * jednej zmiany — łącznie z migracjami i wyzwalaczami utrzymującymi tabelę
 * sald. To jest cały sens tej wersji: jeden silnik, nie dwa.
 *
 * TRWAŁOŚĆ
 * SQLite w WebAssembly trzyma bazę w pamięci. Po każdej zakończonej transakcji
 * plik bazy jest zrzucany do IndexedDB — a przy starcie odczytywany z powrotem.
 * Zrzut jest odroczony i scalany, żeby seria zapisów (import, dane
 * demonstracyjne) nie kosztowała tylu zrzutów, ile dokumentów.
 * Zamknięcie karty wymusza zrzut natychmiast.
 *
 * RÓŻNICE WOBEC WERSJI SERWEROWEJ — wszystkie wymuszone przez środowisko:
 *  • brak trybu WAL (nie ma pliku na dysku, jest bufor w pamięci),
 *  • `PRAGMA data_version` nie wykryje zapisu spoza procesu, bo taki zapis
 *    nie istnieje: jedna karta przeglądarki to jedna baza,
 *  • migracje przychodzą jako stałe wklejone przez generator, nie z katalogu.
 */
import config from './config.js';
import logger from './logger.js';
import { MIGRATIONS } from 'virtual:migrations';
import { readFile, writeFile } from './storage.js';

/* --------------------------- Ten sam kod, co na serwerze ---------------- */

export const LIKE_ESCAPE = "ESCAPE '\\'";

export function likePattern(text) {
  return `%${String(text).replace(/[\\%_]/g, '\\$&')}%`;
}

const paramNameCache = new Map();

function namedParams(sql) {
  let names = paramNameCache.get(sql);
  if (names) return names;
  const stripped = sql.replace(/'(?:[^']|'')*'/g, "''");
  names = new Set();
  for (const m of stripped.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)) names.add(m[1]);
  paramNameCache.set(sql, names);
  return names;
}

function normalizeValue(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (v !== null && typeof v === 'object' && !(v instanceof Uint8Array)) return JSON.stringify(v);
  return v;
}

/**
 * Parametry nazwane w sql.js wymagają dwukropka w kluczu (`:id`), a nie samej
 * nazwy — jedyna różnica wobec sterownika `node:sqlite`. Odsiew nadmiarowych
 * kluczy działa tak samo, bo serwisy przekazują wspólny obiekt filtrów.
 */
function normalizeParams(params, sql) {
  if (params === undefined || params === null) return undefined;
  if (Array.isArray(params)) return params.map(normalizeValue);
  const allowed = sql ? namedParams(sql) : null;
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    if (allowed && !allowed.has(k)) continue;
    out[`:${k}`] = normalizeValue(v);
  }
  return out;
}

/* ------------------------------ Połączenie ------------------------------ */

let SQL = null;
let connection = null;
let txDepth = 0;
let dirty = false;
let saveTimer = null;
let versionCounter = 0;

/** Silnik SQLite dostarcza generator jako `initSqlJs` z osadzonym plikiem WASM. */
export async function initEngine() {
  if (SQL) return SQL;
  const binary = Uint8Array.from(atob(globalThis.__RESINVEST_WASM__), (c) => c.charCodeAt(0));
  SQL = await globalThis.initSqlJs({ wasmBinary: binary });
  return SQL;
}

/**
 * Otwiera bazę z zawartości podanej wcześniej przez `loadDatabase`.
 * Sygnatura zgodna z wersją serwerową — argument jest ignorowany, bo ścieżka
 * pliku nie ma tu znaczenia.
 */
export function openDatabase() {
  if (connection) return connection;
  if (!SQL) throw new Error('Silnik bazy nie został zainicjowany — wywołaj initEngine().');
  connection = new SQL.Database(pendingBytes ?? undefined);
  pendingBytes = null;
  statements = new Map();
  connection.exec('PRAGMA foreign_keys = ON;');
  logger.info('Baza danych otwarta', { silnik: 'SQLite/WebAssembly' });
  return connection;
}

let pendingBytes = null;

/** Wczytuje zapisany plik bazy z magazynu przeglądarki (przed `openDatabase`). */
export async function loadDatabase() {
  await initEngine();
  const stored = await readFile(config.db.file);
  pendingBytes = stored ?? null;
  return Boolean(stored);
}

/* ------------------------------ Trwałość -------------------------------- */

/** Zrzut pliku bazy do magazynu przeglądarki. */
export async function persist() {
  if (!connection) return false;
  clearTimeout(saveTimer);
  saveTimer = null;
  dirty = false;
  const bytes = connection.export();
  forgetStatements();
  await writeFile(config.db.file, bytes);
  return true;
}

/**
 * Zrzut odroczony. Seria zapisów (import, dane demonstracyjne, łańcuch
 * terenowy) kosztuje jeden zrzut, a nie tyle, ile dokumentów. Odstęp jest
 * większy niż potrzebny na samo scalanie, bo każdy zrzut unieważnia bufor
 * przygotowanych instrukcji — patrz `forgetStatements`.
 */
function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persist().catch((err) => logger.exception('Nie udało się zapisać bazy', err));
  }, 400);
}

/** Czy są zmiany jeszcze niezapisane — używane przy zamykaniu karty. */
export const hasUnsavedChanges = () => dirty;

/* ------------------------------- Fasada --------------------------------- */

/**
 * Pamięć podręczna przygotowanych instrukcji.
 *
 * Bez niej każde zapytanie kompiluje SQL od nowa. Przy generowaniu danych
 * demonstracyjnych — około 350 dokumentów, każdy po kilkanaście zapytań —
 * kompilacja dominowała czas pracy: pierwsza wersja bez pamięci podręcznej
 * nie skończyła generowania po ośmiu minutach i została przerwana.
 * Limit jak w wersji serwerowej: zbiór treści SQL jest skończony, ale rośnie
 * z liczbą kombinacji filtrów.
 */
const STATEMENT_CACHE_LIMIT = 256;
let statements = new Map();

/**
 * Porzuca bufor instrukcji.
 *
 * `Database.export()` w sql.js zwalnia **wszystkie** przygotowane instrukcje
 * (`Object.values(this.fb).forEach(free)`), więc po każdym zrzucie bazy nasz
 * bufor wskazuje na zwolnioną pamięć. Trzymanie ich dalej kończy się albo
 * wyjątkiem „Statement closed”, albo — gorzej — trafieniem w instrukcję
 * utworzoną później pod tym samym adresem i cichym zwróceniem cudzego wyniku.
 * Ta druga sytuacja wyszła przy generowaniu danych demonstracyjnych:
 * sprawdzenie „czy magazyn o tej nazwie już jest” odpowiadało błędnie,
 * a zapis kończył się naruszeniem unikalności kodu magazynu.
 */
function forgetStatements() {
  statements = new Map();
}

function prepare(sql) {
  const cached = statements.get(sql);
  if (cached) {
    statements.delete(sql);
    statements.set(sql, cached);
    cached.reset();
    return cached;
  }
  const stmt = openDatabase().prepare(sql);
  if (statements.size >= STATEMENT_CACHE_LIMIT) {
    const oldestKey = statements.keys().next().value;
    try { statements.get(oldestKey).free(); } catch { /* już zwolniona */ }
    statements.delete(oldestKey);
  }
  statements.set(sql, stmt);
  return stmt;
}

/** Wiersze z sql.js przychodzą jako zwykłe obiekty. */
function rowsOf(sql, params) {
  const stmt = prepare(sql);
  const bound = normalizeParams(params, sql);
  if (bound !== undefined) stmt.bind(bound);
  const out = [];
  while (stmt.step()) out.push(stmt.getAsObject());
  stmt.reset();
  return out;
}

export const db = {
  raw: () => openDatabase(),

  exec(sql) {
    openDatabase().exec(sql);
    scheduleSave();
  },

  all(sql, params) {
    return rowsOf(sql, params);
  },

  get(sql, params) {
    return rowsOf(sql, params)[0];
  },

  value(sql, params) {
    const row = this.get(sql, params);
    return row ? Object.values(row)[0] : undefined;
  },

  run(sql, params) {
    const conn = openDatabase();
    const stmt = prepare(sql);
    const bound = normalizeParams(params, sql);
    if (bound !== undefined) stmt.bind(bound);
    stmt.step();
    stmt.reset();
    versionCounter += 1;
    scheduleSave();
    const changes = conn.getRowsModified();
    return {
      changes,
      // Osobne zapytanie tylko wtedy, gdy ktoś naprawdę pyta o klucz —
      // przy 350 dokumentach to kilka tysięcy zapytań mniej.
      get lastInsertRowid() {
        return rowsOf('SELECT last_insert_rowid() AS id')[0]?.id ?? 0;
      },
    };
  },

  /**
   * Licznik zmian. W przeglądarce nie ma zapisów spoza procesu — jedna karta
   * to jedna baza — więc licznik rośnie wyłącznie z własnych zapisów.
   * Zachowany, bo `app.js` porównuje go przy każdym żądaniu.
   */
  dataVersion() {
    return versionCounter;
  },

  /** Ta sama semantyka, co na serwerze: zagnieżdżenie przez SAVEPOINT. */
  tx(fn) {
    const conn = openDatabase();
    const nested = txDepth > 0;
    const name = nested ? `sp_${Math.random().toString(36).slice(2, 10)}` : null;
    conn.exec(nested ? `SAVEPOINT ${name}` : 'BEGIN IMMEDIATE');
    txDepth += 1;
    try {
      const result = fn();
      conn.exec(nested ? `RELEASE ${name}` : 'COMMIT');
      txDepth -= 1;
      versionCounter += 1;
      scheduleSave();
      return result;
    } catch (err) {
      try { conn.exec(nested ? `ROLLBACK TO ${name}` : 'ROLLBACK'); } catch { /* połączenie w błędzie */ }
      txDepth -= 1;
      throw err;
    }
  },
};

export function optimizeDatabase() {
  if (!connection) return false;
  try {
    connection.exec('PRAGMA optimize');
    return true;
  } catch (err) {
    logger.exception('Nie udało się odświeżyć statystyk bazy', err);
    return false;
  }
}

export function closeDatabase() {
  if (!connection) return;
  optimizeDatabase();
  for (const stmt of statements.values()) {
    try { stmt.free(); } catch { /* już zwolniona */ }
  }
  statements = new Map();
  try { connection.close(); } catch { /* połączenie już zamknięte */ }
  connection = null;
}

/** Bajty pliku bazy — do pobrania kopii i do odtworzenia. */
export function exportBytes() {
  if (!connection) return null;
  const bytes = connection.export();
  forgetStatements();
  return bytes;
}

/** Wgranie pliku bazy przysłanego przez użytkownika (odtworzenie kopii). */
export async function replaceDatabase(bytes) {
  await initEngine();
  closeDatabase();
  pendingBytes = bytes;
  openDatabase();
  versionCounter += 1;
  await persist();
}

/* ------------------------------ Migracje -------------------------------- */

/**
 * Uruchamia migracje wklejone przez generator — te same pliki `.sql`,
 * co w wersji serwerowej, w tej samej kolejności i z tym samym rejestrem
 * zastosowanych wersji.
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
  const executed = [];

  for (const { name, sql } of MIGRATIONS) {
    const version = name.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    conn.exec('BEGIN IMMEDIATE');
    try {
      conn.exec(sql);
      conn.run('INSERT INTO schema_migrations(version) VALUES(?)', [version]);
      conn.exec('COMMIT');
      executed.push(version);
      logger.info('Migracja zastosowana', { version });
    } catch (err) {
      conn.exec('ROLLBACK');
      logger.exception('Migracja nie powiodła się', err, { version });
      throw err;
    }
  }
  if (executed.length) scheduleSave();
  return executed;
}

export default db;

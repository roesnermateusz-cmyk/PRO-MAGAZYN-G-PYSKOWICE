/**
 * Adapter API wersji jednoplikowej.
 *
 * Zastępuje `web/src/core/api.js`. Zamiast wysyłać żądanie HTTP, wywołuje
 * **ten sam router serwera** w tej samej karcie przeglądarki: `buildRouter()`
 * z `server/src/app.js`, z niezmienionymi trasami, strażnikami uprawnień
 * i serwisami. Widoki nie wiedzą, że nie ma sieci — mają ten sam interfejs
 * `api.get / post / patch / put / delete / download / attachmentUrl`
 * i te same błędy `ApiError`.
 *
 * START
 * Pierwsze żądanie czeka na `ensureReady()`: inicjalizacja SQLite w
 * WebAssembly, odczyt zapisanej bazy z magazynu przeglądarki, migracje,
 * `bootstrap()` i wskazanie operatora. Kolejne idą już bez opóźnienia.
 *
 * TRZY MIEJSCA, GDZIE ADAPTER WCHODZI PRZED ROUTER
 *  • `/auth/*`        — nie ma logowania; sesją jest wybrany operator,
 *  • `/backup/create` i `/backup/list` — kopia to plik pobierany przez
 *    przeglądarkę, nie plik kopiowany w katalogu na dysku,
 *  • `/attachments/:id/content` — bajty skanu trzeba wciągnąć z magazynu
 *    do bufora, zanim synchroniczny serwis po nie sięgnie.
 * Każde z nich to różnica środowiska, nie różnica reguł biznesowych.
 */
import { buildRouter } from '../../server/src/app.js';
import db, {
  initEngine, loadDatabase, openDatabase, runMigrations, persist, replaceDatabase, exportBytes,
} from '../../server/src/db/index.js';
import { bootstrap } from '../../server/src/bootstrap.js';
import { permissionsFor } from '../../server/src/middleware/auth.js';
import { setLocalSubject } from '../../server/src/lib/crypto.js';
import { mountFs, preload, release } from './runtime/fs.js';
import { requestPersistence } from './runtime/storage.js';
import logger from '../../server/src/lib/logger.js';
import { installDemoData, hasAnyDocument } from './runtime/demo.js';

const OPERATOR_KEY = 'resinvest.operator';

/* ------------------------------- Błędy --------------------------------- */

export class ApiError extends Error {
  constructor(status, body) {
    const error = body?.error ?? {};
    super(error.message || `Błąd wewnętrzny aplikacji (${status}).`);
    this.name = 'ApiError';
    this.status = status;
    this.code = error.code || 'HTTP_ERROR';
    this.details = error.details || [];
  }

  get isValidation() {
    return this.code === 'VALIDATION_ERROR' && Array.isArray(this.details);
  }
}

/* ------------------------------- Sesja --------------------------------- */

const listeners = new Set();

export const getRefreshToken = () => localStorage.getItem(OPERATOR_KEY);

export function setTokens({ refreshToken } = {}) {
  if (refreshToken) localStorage.setItem(OPERATOR_KEY, refreshToken);
}

export function clearTokens() {
  localStorage.removeItem(OPERATOR_KEY);
  setLocalSubject(null);
}

export function onUnauthorized(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Lista operatorów do wyboru na ekranie startowym. */
export async function listOperators() {
  await ensureReady();
  return db.all(
    `SELECT id, email, full_name, role, is_active FROM users
      WHERE is_active = 1 ORDER BY role = 'ADMIN' DESC, full_name`,
  ).map((r) => ({ id: r.id, email: r.email, fullName: r.full_name, role: r.role }));
}

/** Ustawia operatora i zwraca jego opis w kształcie odpowiedzi `/auth/login`. */
export async function selectOperator(userId) {
  await ensureReady();
  const row = db.get('SELECT * FROM users WHERE id = :id AND is_active = 1', { id: userId });
  if (!row) throw new ApiError(404, { error: { message: 'Nie ma takiego operatora.' } });
  setLocalSubject(row.id);
  localStorage.setItem(OPERATOR_KEY, row.id);
  return sessionPayload(row);
}

const sessionPayload = (row) => ({
  accessToken: 'lokalna-sesja',
  refreshToken: row.id,
  user: {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    phone: row.phone ?? null,
    isActive: true,
    // Bez logowania nie ma czego zmieniać — ekran zmiany hasła się nie pokazuje.
    mustChangePassword: false,
    permissions: permissionsFor(row.role),
  },
});

/* ------------------------------- Start --------------------------------- */

let router = null;
let readyPromise = null;

/** Postęp uruchamiania — pokazywany na ekranie powitalnym. */
export const bootState = { step: 'start', message: 'Uruchamianie…', demoOffered: false };

async function boot() {
  bootState.message = 'Wczytywanie silnika bazy danych…';
  await initEngine();

  bootState.message = 'Odczyt zapisanych danych…';
  const restored = await loadDatabase();
  openDatabase();
  await mountFs();

  bootState.message = restored ? 'Sprawdzanie struktury bazy…' : 'Zakładanie nowej bazy…';
  const { migrations } = bootstrap();
  if (migrations.length) logger.info('Zastosowano migracje', { migrations });

  // Trwałość magazynu: bez niej przeglądarka może usunąć dane przy braku
  // miejsca na dysku. Prośba jest cicha — odmowa niczego nie psuje.
  requestPersistence().catch(() => {});

  router = buildRouter();
  bootState.demoOffered = !hasAnyDocument();

  const saved = localStorage.getItem(OPERATOR_KEY);
  const operator = saved
    ? db.get('SELECT id FROM users WHERE id = :id AND is_active = 1', { id: saved })
    : null;
  if (operator) setLocalSubject(operator.id);

  await persist();
  bootState.step = 'gotowe';
  bootState.message = 'Gotowe';
  logger.info('Wersja jednoplikowa uruchomiona', { odtworzona: restored });
}

export function ensureReady() {
  if (!readyPromise) {
    readyPromise = boot().catch((err) => {
      readyPromise = null;
      logger.exception('Nie udało się uruchomić bazy', err);
      throw err;
    });
  }
  return readyPromise;
}

/* --------------------------- Wywołanie trasy ---------------------------- */

/** Kontekst żądania w kształcie, jakiego oczekują trasy serwera. */
function makeContext({ method, path, query, body }) {
  const ctx = {
    req: { headers: { authorization: 'Bearer lokalna-sesja' }, socket: {} },
    res: null,
    method,
    path,
    query: query ?? {},
    params: {},
    body: body ?? {},
    ip: 'lokalnie',
    userAgent: navigator.userAgent.slice(0, 250),
    user: null,
    _status: 0,
    _handled: false,
    _file: null,
    set() { return ctx; },
    status(code) { ctx._status = code; return ctx; },
    send(status, headers, payload) {
      ctx._file = { status, headers, body: payload };
      ctx._handled = true;
    },
    sendFile({ filename, mime, body, disposition = 'attachment', headers = {} }) {
      ctx.send(200, {
        'Content-Type': mime,
        'Content-Disposition': `${disposition}; filename="${encodeURIComponent(filename)}"`,
        ...headers,
      }, body);
    },
  };
  return ctx;
}

/** Zamienia wyjątek serwisu na `ApiError` — tak samo, jak robi to warstwa HTTP. */
function toApiError(err) {
  const status = Number(err?.status) || 500;
  return new ApiError(status, {
    error: {
      code: err?.code || (status === 500 ? 'INTERNAL_ERROR' : 'ERROR'),
      message: err?.message || 'Wystąpił nieoczekiwany błąd.',
      details: err?.details ?? [],
    },
  });
}

export async function request(path, options = {}) {
  const { method = 'GET', body, query, raw = false } = options;
  await ensureReady();

  const intercepted = await intercept(method, path, { body, query, raw, afterPreload: options.__afterPreload });
  if (intercepted !== undefined) return intercepted;

  const full = `/api/v1${path}`;
  const { route, params, pathMatched } = router.match(method, full);
  if (!route) {
    throw new ApiError(pathMatched ? 405 : 404, {
      error: { message: pathMatched ? `Metoda ${method} nie jest dozwolona.` : `Nie znaleziono zasobu: ${path}` },
    });
  }

  const ctx = makeContext({ method, path: full, query, body });
  ctx.params = params;
  ctx.routePattern = route.pattern;

  let result;
  try {
    for (const handler of route.handlers) {
      result = await handler(ctx);
      if (result !== undefined || ctx._handled) break;
    }
  } catch (err) {
    const apiError = toApiError(err);
    if (apiError.status === 401) listeners.forEach((fn) => fn());
    throw apiError;
  }

  if (ctx._handled && ctx._file) {
    const { status, headers, body: payload } = ctx._file;
    if (raw) return new Response(payload, { status, headers });
    return payload;
  }
  if (raw) {
    return new Response(JSON.stringify(result ?? null), {
      status: ctx._status || 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  return result ?? null;
}

/* ------------------------- Różnice środowiska --------------------------- */

/**
 * Trasy obsługiwane na miejscu. Zwrócenie `undefined` oznacza „przekaż dalej
 * do routera serwera”.
 */
async function intercept(method, path, { body, raw, afterPreload = false }) {
  /* --- Sesja: wybrany operator zamiast logowania --- */
  if (path === '/auth/refresh' || path === '/auth/login') {
    const id = body?.refreshToken ?? localStorage.getItem(OPERATOR_KEY);
    const row = id ? db.get('SELECT * FROM users WHERE id = :id AND is_active = 1', { id }) : null;
    if (!row) throw new ApiError(401, { error: { code: 'UNAUTHORIZED', message: 'Wybierz operatora.' } });
    setLocalSubject(row.id);
    return sessionPayload(row);
  }
  if (path === '/auth/logout') {
    clearTokens();
    return null;
  }
  if (path === '/auth/change-password') {
    throw new ApiError(400, {
      error: {
        code: 'BRAK_LOGOWANIA',
        message: 'Wersja jednoplikowa nie ma logowania, więc nie ma też hasła do zmiany. '
          + 'Dane chroni kopia zapasowa i szyfrowanie dysku komputera.',
      },
    });
  }

  /* --- Kopia zapasowa: plik pobierany przez przeglądarkę --- */
  if (path === '/backup/create' && method === 'POST') {
    await persist();
    const bytes = exportBytes();
    downloadBytes(bytes, `resinvest-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.db`,
      'application/vnd.sqlite3');
    return { file: 'pobrano do katalogu pobierania', sizeBytes: bytes.length, createdAt: new Date().toISOString() };
  }
  if (path === '/backup/list' && method === 'GET') {
    // Kopie leżą tam, gdzie przeglądarka zapisuje pobrane pliki — aplikacja
    // ich nie widzi i nie będzie udawać, że widzi.
    return { items: [] };
  }

  /* --- Załącznik: wciągnięcie bajtów do bufora przed odczytem --- */
  const attachment = afterPreload ? null : /^\/attachments\/([^/]+)\/content$/.exec(path);
  if (attachment) {
    const row = db.get('SELECT storage_path FROM attachments WHERE id = :id', { id: attachment[1] });
    if (row?.storage_path) {
      const loaded = await preload(`/dane/zalaczniki/${row.storage_path}`);
      if (!loaded) {
        throw new ApiError(404, {
          error: { message: 'Plik załącznika nie istnieje w magazynie przeglądarki. Sprawdź kopię zapasową.' },
        });
      }
      try {
        return await request(path, { method, raw, __afterPreload: true });
      } finally {
        release(`/dane/zalaczniki/${row.storage_path}`);
      }
    }
  }

  return undefined;
}

/** Podaje bajty użytkownikowi jako plik do zapisania. */
function downloadBytes(bytes, filename, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ------------------------- Operacje na całej bazie ---------------------- */

/** Wgranie pliku bazy przysłanego przez użytkownika (odtworzenie kopii). */
export async function restoreDatabase(bytes) {
  await ensureReady();
  await replaceDatabase(bytes);
  bootstrap();
  router = buildRouter();
}

/** Wczytanie danych demonstracyjnych — na życzenie, na pustej bazie. */
export async function loadDemoData() {
  await ensureReady();
  const result = installDemoData();
  await persist();
  bootState.demoOffered = false;
  return result;
}

export { persist as saveNow, exportBytes, downloadBytes };

/* ------------------------------ Interfejs ------------------------------- */

export const api = {
  get: (path, query) => request(path, { query }),
  post: (path, body) => request(path, { method: 'POST', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  delete: (path) => request(path, { method: 'DELETE' }),

  async download(path, query, fallbackName = 'plik') {
    const res = await request(path, { query, raw: true });
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = /filename="?([^"]+)"?/.exec(disposition);
    const blob = await res.blob();
    downloadBytes(new Uint8Array(await blob.arrayBuffer()),
      match ? decodeURIComponent(match[1]) : fallbackName, blob.type);
  },

  async attachmentUrl(id) {
    const res = await request(`/attachments/${encodeURIComponent(id)}/content`, { raw: true });
    return URL.createObjectURL(await res.blob());
  },
};

/**
 * Uchwyt do API na obiekcie okna.
 *
 * Dwa zastosowania: kontrola zgodności silników (`standalone/verify.mjs`
 * porównuje liczby z wersją serwerową) oraz zgłoszenie problemu — można
 * poprosić użytkownika o odczytanie konkretnej wartości z konsoli, zamiast
 * zgadywać, co pokazuje mu ekran.
 */
globalThis.__resinvestApi = api;
globalThis.__resinvestDemo = loadDemoData;
globalThis.__resinvestDb = db;

export default api;

/**
 * Warstwa HTTP — minimalny router w stylu Express zbudowany na `node:http`.
 *
 * Powód własnej implementacji: aplikacja jest wdrażana on-premise u klienta
 * (instalator ZIP, brak dostępu do rejestru npm na stacji roboczej), więc
 * serwer nie może mieć żadnych zależności zewnętrznych. Zakres jest świadomie
 * ograniczony do tego, czego używa API: routing, parsowanie JSON, CORS,
 * nagłówki bezpieczeństwa i serwowanie plików statycznych.
 */
import http from 'node:http';
import { createReadStream, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { AppError, NotFoundError, BadRequestError, PayloadTooLargeError } from './errors.js';
import logger from './logger.js';

/* ------------------------------- Router ------------------------------- */

/** Zamienia wzorzec `/operations/:id` na wyrażenie regularne z nazwanymi grupami. */
function compilePattern(pattern) {
  const names = [];
  const source = pattern
    .replace(/\/+$/, '')
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        names.push(seg.slice(1));
        return '/([^/]+)';
      }
      return '/' + seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('')
    .slice(1) || '/';
  return { regex: new RegExp('^' + (source === '/' ? '' : source) + '/?$'), names };
}

export class Router {
  constructor(prefix = '') {
    this.prefix = prefix.replace(/\/+$/, '');
    this.routes = [];
  }

  /**
   * Rejestruje trasę.
   * @param {string} method metoda HTTP
   * @param {string} pattern ścieżka, np. `/operations/:id`
   * @param  {...Function} handlers łańcuch funkcji `(ctx) => any`; przerwanie następuje,
   *   gdy handler zwróci wartość różną od `undefined`
   */
  add(method, pattern, ...handlers) {
    const full = (this.prefix + pattern) || '/';
    const { regex, names } = compilePattern(full);
    this.routes.push({ method, pattern: full, regex, names, handlers });
    return this;
  }

  get(p, ...h) { return this.add('GET', p, ...h); }
  post(p, ...h) { return this.add('POST', p, ...h); }
  put(p, ...h) { return this.add('PUT', p, ...h); }
  patch(p, ...h) { return this.add('PATCH', p, ...h); }
  delete(p, ...h) { return this.add('DELETE', p, ...h); }

  /** Dołącza trasy innego routera. */
  merge(other) {
    this.routes.push(...other.routes);
    return this;
  }

  /** Dopasowuje ścieżkę; zwraca `{route, params}` lub informację o kolizji metody. */
  match(method, pathname) {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.regex.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params = {};
      route.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
      return { route, params };
    }
    return { route: null, params: {}, pathMatched };
  }
}

/* --------------------------- Kontekst żądania -------------------------- */

async function readBody(req, limitBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new PayloadTooLargeError();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseBody(buffer, contentType) {
  if (!buffer.length) return {};
  const type = (contentType || '').split(';')[0].trim().toLowerCase();
  if (type === 'application/json' || type === '') {
    try {
      const parsed = JSON.parse(buffer.toString('utf8'));
      return parsed && typeof parsed === 'object' ? parsed : { value: parsed };
    } catch {
      throw new BadRequestError('Treść żądania nie jest poprawnym dokumentem JSON.');
    }
  }
  if (type === 'application/x-www-form-urlencoded') {
    return Object.fromEntries(new URLSearchParams(buffer.toString('utf8')));
  }
  throw new BadRequestError(`Nieobsługiwany typ treści: ${type}`);
}

/**
 * Adres klienta.
 *
 * `X-Forwarded-For` jest brany pod uwagę WYŁĄCZNIE przy `TRUST_PROXY=true`.
 * Nagłówek ustawia klient, więc bezwarunkowe zaufanie oznacza, że o adresie
 * zapisanym w dzienniku audytu decyduje ten, kogo dziennik ma pilnować:
 * wystarczy jeden nagłówek, żeby własne działania podpisać cudzym adresem.
 * Ten dziennik jest dowodem przy certyfikacji i kontroli skarbowej, więc
 * podrobiony adres nie jest drobiazgiem. Drugim skutkiem było rozsypanie
 * ograniczania prób logowania — każdy zmyślony adres dostawał własny licznik.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {boolean} trustProxy czy przed aplikacją stoi odwrotne proxy,
 *   które ten nagłówek nadpisuje własną wartością
 */
function clientIp(req, trustProxy) {
  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || '';
}

/**
 * Nazwa pliku do nagłówka `Content-Disposition`.
 *
 * Wcześniej szła przez `encodeURIComponent`, więc „Kwit produkcji — wrzesień.csv”
 * zapisywał się na dysku jako `Kwit%20produkcji%20%E2%80%94%20wrzesie%C5%84.csv`.
 * Bezpieczne, ale nie do czytania — a to są dokumenty, które księgowa wysyła
 * dalej mailem.
 *
 * RFC 6266 rozwiązuje to dwoma parametrami naraz: `filename=` z wersją
 * zubożoną do ASCII (dla czegokolwiek bardzo starego) i `filename*=` w
 * składni RFC 5987, które każda dzisiejsza przeglądarka woli i z którego
 * odczyta polskie znaki. Kolejność ma znaczenie — `filename*` musi być drugi.
 *
 * Cudzysłów i odwrotny ukośnik są usuwane, bo w wersji ASCII stoi ona
 * w cudzysłowie; znaki sterujące i ukośniki — bo nazwa bierze się z pliku
 * wgranego przez użytkownika i nie ma prawa wyjść poza swój katalog
 * ani rozciąć nagłówka na dwa.
 */
function nazwaPliku(nazwa) {
  const czysta = String(nazwa)
    .replace(/[\r\n"\\/]/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '');

  /*
   * Transliteracja na ASCII. Zapisy `\uXXXX` zamiast samych znaków są tu
   * konieczne, nie ozdobne: wersja jednoplikowa przepuszcza źródła przez
   * własny generator i literalny myślnik w zakresie `[‐-―]` wychodził z niego
   * jako nieprawidłowy zakres — cała aplikacja przestawała się uruchamiać.
   *
   * Polskie znaki i typografia dostają rozsądne odpowiedniki, bo myślnik
   * i cudzysłów drukarski wchodzą do nazw raportów same, z szablonów wydruku.
   */
  const ascii = czysta
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0142/g, 'l').replace(/\u0141/g, 'L')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/[\u00a0\u2007\u2009\u202f]/g, ' ')
    .replace(/[^\x20-\x7e]/g, '_')
    // Na końcu, nie wcześniej: transliteracja cudzysłowu drukarskiego sama
    // wstawia zwykły `"`, a ten stoi wewnątrz cudzysłowu i rozciąłby parametr.
    .replace(/["\\]/g, "'");

  return `filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(czysta)}`;
}

/**
 * Polityka bezpieczeństwa treści (CSP) — druga linia obrony po `esc()`.
 *
 * Widoki sklejają HTML z tekstu, więc jedno pominięte `esc()` wstrzykuje
 * znacznik. CSP nie naprawia takiej dziury, ale odbiera jej najgroźniejszy
 * skutek: wstrzyknięty `<script>` się nie wykona, a wykradzione dane nie mają
 * dokąd pojechać, bo `connect-src` puszcza wyłącznie własny origin.
 *
 * Skąd poszczególne pozycje:
 * - `script-src 'self'` bez `unsafe-inline` i `unsafe-eval` — aplikacja ładuje
 *   moduły ESM z dysku i nigdzie nie woła `eval` ani `new Function`;
 * - `style-src` z `unsafe-inline` — w kodzie jest ok. 120 atrybutów `style=`,
 *   m.in. kolory serii na wykresach liczone w locie. To świadome ustępstwo:
 *   przy stylach chodzi o wygląd, przy skryptach o wykonanie kodu;
 * - `img-src` z `data:` i `blob:` — podgląd załączonego zdjęcia przed wysyłką
 *   i miniatury skanów idą przez `URL.createObjectURL`;
 * - `font-src 'self'` — kroje leżą w `web/assets/fonts/` (zasada „zero sieci”);
 * - `base-uri 'none'` — wstrzyknięty `<base>` przekierowałby wszystkie
 *   względne adresy, w tym wysyłkę formularzy.
 *
 * Trasa załączników nadpisuje to własną, ostrzejszą polityką (`default-src
 * 'none'`) — nagłówki podane w `writeHead` mają pierwszeństwo przed
 * `setHeader`, więc plik od użytkownika nadal nie wykona niczego.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

/* --------------------------- Pliki statyczne -------------------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
};

/**
 * Serwuje plik aplikacji klienckiej z obsługą żądań warunkowych.
 *
 * Aplikacja to około trzydziestu modułów ES ładowanych przy każdym wejściu.
 * Bez `ETag` przeglądarka po wygaśnięciu `max-age` pobiera je wszystkie od nowa,
 * choć zwykle nic się w nich nie zmieniło. Ze znacznikiem wersji dostaje `304`
 * bez treści i używa własnej kopii — istotne przy pracy przez telefon
 * w terenie, gdzie łącze bywa wąskie.
 *
 * Znacznik składamy z rozmiaru i czasu modyfikacji pliku: zmiana treści zmienia
 * co najmniej jedno z nich, a odczyt obu jest darmowy (i tak wołamy `statSync`).
 */
function serveStatic(rootDir, urlPath, res, req = null) {
  // Normalizacja chroni przed wyjściem poza katalog (path traversal).
  const rel = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  let file = path.join(rootDir, rel);
  if (!file.startsWith(rootDir)) return false;
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!existsSync(file) || !statSync(file).isFile()) return false;

  const stat = statSync(file);
  const ext = path.extname(file).toLowerCase();
  const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    'Last-Modified': stat.mtime.toUTCString(),
    ETag: etag,
  };

  // Klient ma aktualną kopię — odsyłamy sam nagłówek.
  if (req?.headers['if-none-match'] === etag) {
    res.writeHead(304, headers).end();
    return true;
  }

  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  createReadStream(file).pipe(res);
  return true;
}

/* ------------------------------- Serwer ------------------------------- */

/**
 * Buduje serwer HTTP na podstawie routera.
 *
 * @param {object} options
 * @param {Router} options.router router z trasami API
 * @param {string} [options.staticDir] katalog aplikacji front-end (SPA fallback do index.html)
 * @param {string} [options.apiPrefix] prefiks tras API (żądania spoza prefiksu trafiają do SPA)
 * @param {string[]} [options.corsOrigins] dozwolone źródła CORS
 * @param {number} [options.bodyLimitBytes] maksymalny rozmiar treści żądania
 * @param {boolean} [options.trustProxy] czy `X-Forwarded-For` ma decydować
 *   o adresie klienta — domyślnie NIE, patrz komentarz przy `clientIp()`
 * @param {Function} [options.onRequest] hook wywoływany po dopasowaniu trasy,
 *   przed uruchomieniem handlerów (synchronizacja pamięci podręcznej)
 * @param {Function} [options.onResponse] hook wywoływany po odpowiedzi
 *   z czasem obsługi i kodem statusu (liczniki)
 */
export function createServer(options) {
  const {
    router,
    staticDir = '',
    apiPrefix = '/api',
    corsOrigins = [],
    bodyLimitBytes = 16 * 1024 * 1024,
    isProduction = true,
    trustProxy = false,
    onRequest = null,
    onResponse = null,
  } = options;

  const server = http.createServer(async (req, res) => {
    const started = process.hrtime.bigint();
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    /* Nagłówki bezpieczeństwa — jednakowe dla API i dla SPA. */
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Content-Security-Policy', CSP);

    /* CORS — domyślnie wyłączony (aplikacja serwuje własny front z tego samego origin). */
    const origin = req.headers.origin;
    if (origin && corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const ctx = {
      req,
      res,
      method: req.method,
      path: pathname,
      url,
      query: Object.fromEntries(url.searchParams.entries()),
      params: {},
      body: {},
      ip: clientIp(req, trustProxy),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 250),
      user: null,
      /** Ustawia nagłówek odpowiedzi. */
      set(name, value) { res.setHeader(name, value); return ctx; },
      /** Wymusza kod statusu odpowiedzi. */
      status(code) { ctx._status = code; return ctx; },
      /** Odpowiedź surowa (CSV, PDF, obraz) — omija serializację JSON. */
      send(status, headers, payload) {
        res.writeHead(status, headers);
        res.end(payload);
        ctx._handled = true;
      },
      /**
       * Plik do pobrania lub podglądu — komplet nagłówków w jednym miejscu.
       * @param {{filename:string, mime:string, body:string|Buffer,
       *          disposition?:'attachment'|'inline', headers?:object}} file
       */
      sendFile({ filename, mime, body, disposition = 'attachment', headers = {} }) {
        ctx.send(200, {
          'Content-Type': mime,
          'Content-Length': Buffer.byteLength(body),
          'Content-Disposition': `${disposition}; ${nazwaPliku(filename)}`,
          ...headers,
        }, body);
      },
    };

    try {
      if (pathname.startsWith(apiPrefix)) {
        const { route, params, pathMatched } = router.match(req.method, pathname);
        if (!route) {
          throw pathMatched
            ? new AppError(405, 'METHOD_NOT_ALLOWED', `Metoda ${req.method} nie jest dozwolona dla tego zasobu.`)
            : new NotFoundError(`Nie znaleziono zasobu API: ${pathname}`);
        }
        ctx.params = params;
        ctx.routePattern = route.pattern;
        onRequest?.(ctx);

        if (req.method !== 'GET' && req.method !== 'DELETE') {
          const buffer = await readBody(req, bodyLimitBytes);
          ctx.rawBody = buffer;
          ctx.body = parseBody(buffer, req.headers['content-type']);
        }

        let result;
        for (const handler of route.handlers) {
          result = await handler(ctx);
          if (result !== undefined || ctx._handled) break;
        }
        if (ctx._handled) return;

        if (result === undefined || result === null) {
          res.writeHead(ctx._status || 204).end();
        } else {
          const payload = JSON.stringify(result);
          res.writeHead(ctx._status || 200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': Buffer.byteLength(payload),
            'Cache-Control': 'no-store',
          });
          res.end(payload);
        }
        return;
      }

      /* Poza prefiksem API: pliki statyczne, a dla nieznanych ścieżek — SPA. */
      if (staticDir) {
        if (serveStatic(staticDir, pathname, res, req)) return;
        if (req.method === 'GET' && !path.extname(pathname)) {
          if (serveStatic(staticDir, '/index.html', res, req)) return;
        }
      }
      throw new NotFoundError('Nie znaleziono zasobu.');
    } catch (err) {
      sendError(ctx, err, isProduction);
    } finally {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      if (pathname.startsWith(apiPrefix)) {
        onResponse?.(ctx, { ms, status: res.statusCode });
        logger.debug('request', {
          method: req.method, path: pathname, status: res.statusCode,
          ms: Math.round(ms * 10) / 10, user: ctx.user?.email || null,
        });
      }
    }
  });

  server.headersTimeout = 30_000;
  server.requestTimeout = 120_000;
  server.keepAliveTimeout = 20_000;
  return server;
}

/** Zamienia wyjątek na odpowiedź JSON; szczegóły błędów 500 nie wychodzą na zewnątrz. */
function sendError(ctx, err, isProduction) {
  const { res } = ctx;
  if (res.headersSent) {
    res.end();
    return;
  }
  let status = 500;
  let body = {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Wystąpił nieoczekiwany błąd serwera. Zdarzenie zostało zapisane w dzienniku.',
    },
  };

  if (err instanceof AppError) {
    status = err.status;
    body = err.toJSON();
    if (status >= 500) logger.exception('Błąd aplikacji', err, { path: ctx.path });
    else logger.debug('Odrzucone żądanie', { path: ctx.path, code: err.code, message: err.message });
  } else {
    logger.exception('Nieobsłużony wyjątek', err, { path: ctx.path, method: ctx.method });
    if (!isProduction) body.error.debug = String(err?.stack || err);
  }

  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

export { serveStatic };

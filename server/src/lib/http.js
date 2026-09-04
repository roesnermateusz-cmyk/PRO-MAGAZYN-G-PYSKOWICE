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

/** Adres klienta z uwzględnieniem odwrotnego proxy (nginx / Caddy). */
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || '';
}

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

function serveStatic(rootDir, urlPath, res) {
  // Normalizacja chroni przed wyjściem poza katalog (path traversal).
  const rel = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  let file = path.join(rootDir, rel);
  if (!file.startsWith(rootDir)) return false;
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!existsSync(file) || !statSync(file).isFile()) return false;

  const stat = statSync(file);
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    'Last-Modified': stat.mtime.toUTCString(),
  });
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
 * @param {Function} [options.onRequest] hook wywoływany po zbudowaniu kontekstu (np. audyt)
 */
export function createServer(options) {
  const {
    router,
    staticDir = '',
    apiPrefix = '/api',
    corsOrigins = [],
    bodyLimitBytes = 16 * 1024 * 1024,
    isProduction = true,
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
      ip: clientIp(req),
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
        if (serveStatic(staticDir, pathname, res)) return;
        if (req.method === 'GET' && !path.extname(pathname)) {
          if (serveStatic(staticDir, '/index.html', res)) return;
        }
      }
      throw new NotFoundError('Nie znaleziono zasobu.');
    } catch (err) {
      sendError(ctx, err, isProduction);
    } finally {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      if (pathname.startsWith(apiPrefix)) {
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

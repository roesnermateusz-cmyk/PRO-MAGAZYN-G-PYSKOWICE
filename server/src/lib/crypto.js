/**
 * Funkcje kryptograficzne: hasła (scrypt), tokeny JWT (HMAC-SHA256), identyfikatory.
 * Wyłącznie moduły wbudowane Node.js — brak zależności zewnętrznych.
 */
import crypto from 'node:crypto';
import { UnauthorizedError } from './errors.js';

/* --------------------------- Identyfikatory --------------------------- */

/** UUID v4 — klucz główny rekordów biznesowych (bezpieczny przy scalaniu baz). */
export const uuid = () => crypto.randomUUID();

/** Krótki identyfikator techniczny (np. numer partii importu). */
export const shortId = (bytes = 8) => crypto.randomBytes(bytes).toString('base64url');

/* ------------------------------- Hasła -------------------------------- */

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

/**
 * Hashuje hasło algorytmem scrypt.
 * Format zapisu: `scrypt$N$r$p$sólBase64$hashBase64`.
 */
export function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Hasło musi mieć co najmniej 8 znaków.');
  }
  const salt = crypto.randomBytes(16);
  const { N, r, p, keylen } = SCRYPT_PARAMS;
  const hash = crypto.scryptSync(password.normalize('NFKC'), salt, keylen, { N, r, p, maxmem: 96 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/** Weryfikuje hasło w czasie stałym względem zapisanego hasha. */
export function verifyPassword(password, stored) {
  try {
    if (typeof password !== 'string' || typeof stored !== 'string') return false;
    const [scheme, N, r, p, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(password.normalize('NFKC'), salt, expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: 96 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** Ocena siły hasła używana przy zakładaniu i zmianie konta. */
export function passwordIssues(password) {
  const issues = [];
  if (typeof password !== 'string' || password.length < 10) issues.push('minimum 10 znaków');
  if (!/[a-ząćęłńóśźż]/.test(password || '')) issues.push('co najmniej jedna mała litera');
  if (!/[A-ZĄĆĘŁŃÓŚŹŻ]/.test(password || '')) issues.push('co najmniej jedna wielka litera');
  if (!/[0-9]/.test(password || '')) issues.push('co najmniej jedna cyfra');
  return issues;
}

/* ------------------------------- Tokeny ------------------------------- */

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/**
 * Podpisuje token JWT (alg HS256).
 * @param {object} payload zawartość tokenu
 * @param {string} secret klucz podpisu
 * @param {number} ttlSeconds czas życia w sekundach
 */
export function signToken(payload, secret, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { ...payload, iat: now, exp: now + ttlSeconds };
  const head = b64url(JSON.stringify(header));
  const data = b64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${data}`).digest('base64url');
  return `${head}.${data}.${sig}`;
}

/**
 * Weryfikuje token JWT i zwraca jego zawartość.
 * @throws {UnauthorizedError} gdy token jest nieprawidłowy lub wygasł
 */
export function verifyToken(token, secret) {
  if (typeof token !== 'string') throw new UnauthorizedError('Brak tokenu dostępu.');
  const parts = token.split('.');
  if (parts.length !== 3) throw new UnauthorizedError('Token dostępu jest nieprawidłowy.');
  const [head, data, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(`${head}.${data}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new UnauthorizedError('Token dostępu jest nieprawidłowy.');
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    throw new UnauthorizedError('Token dostępu jest uszkodzony.');
  }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new UnauthorizedError('Sesja wygasła — zaloguj się ponownie.');
  }
  return payload;
}

/** Losowy token odświeżania (przechowywany w bazie wyłącznie jako skrót SHA-256). */
export const newRefreshToken = () => crypto.randomBytes(48).toString('base64url');
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/** Skrót pliku — deduplikacja i kontrola integralności załączników. */
export const sha256Buffer = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

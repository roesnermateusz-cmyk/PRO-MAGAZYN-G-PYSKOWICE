/**
 * Dziennik techniczny wersji jednoplikowej.
 *
 * Zastępuje `server/src/lib/logger.js`, który pisze do `process.stdout` i do
 * pliku. Tutaj wpisy idą do konsoli przeglądarki i do pierścienia w pamięci —
 * ostatnie kilkaset zdarzeń da się pokazać użytkownikowi, gdy trzeba zgłosić
 * problem, bez proszenia go o otwieranie narzędzi programisty.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const RING_SIZE = 400;

/** Pola, których nie wpisujemy do dziennika nawet w wersji lokalnej. */
const SECRET = /haslo|hasło|password|token|secret|hash/i;

const ring = [];
let threshold = LEVELS.info;

function redact(context) {
  const out = {};
  for (const [key, value] of Object.entries(context)) {
    out[key] = SECRET.test(key) ? '[ukryte]' : value;
  }
  return out;
}

function emit(level, message, context) {
  if (LEVELS[level] < threshold) return;
  const entry = { ts: new Date().toISOString(), level, msg: message };
  if (context && typeof context === 'object') Object.assign(entry, redact(context));

  ring.push(entry);
  if (ring.length > RING_SIZE) ring.shift();

  const print = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  print(`[${level}] ${message}`, context ?? '');
}

export const logger = {
  debug: (msg, ctx) => emit('debug', msg, ctx),
  info: (msg, ctx) => emit('info', msg, ctx),
  warn: (msg, ctx) => emit('warn', msg, ctx),
  error: (msg, ctx) => emit('error', msg, ctx),
  exception: (msg, err, ctx = {}) =>
    emit('error', msg, { ...ctx, err: { name: err?.name, message: err?.message, stack: err?.stack } }),
};

/** Ostatnie zdarzenia — do zgłoszenia problemu bez konsoli przeglądarki. */
export const recentLog = () => [...ring];

export function setLogLevel(level) {
  threshold = LEVELS[level] ?? LEVELS.info;
}

export default logger;

/**
 * Dziennik zdarzeń — JSON Lines na stdout oraz opcjonalnie do pliku.
 * Format nadaje się do wpięcia w systemd/journalctl albo dowolny kolektor logów.
 */
import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';
import config from '../config/env.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[config.log.level] ?? LEVELS.info;

let fileStream = null;
if (config.log.file) {
  try {
    mkdirSync(path.dirname(config.log.file), { recursive: true });
    fileStream = createWriteStream(config.log.file, { flags: 'a' });
    fileStream.on('error', () => { fileStream = null; });
  } catch {
    fileStream = null;
  }
}

/** Usuwa z logów pola, które nigdy nie powinny zostać utrwalone. */
const SECRET_KEYS = new Set([
  'password', 'haslo', 'passwordHash', 'password_hash', 'token', 'accessToken',
  'refreshToken', 'refresh_token', 'secret', 'authorization', 'dataBase64',
]);

function redact(value, depth = 0) {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEYS.has(k) ? '[ukryte]' : redact(v, depth + 1);
  }
  return out;
}

function emit(level, message, context) {
  if (LEVELS[level] < threshold) return;
  const entry = { ts: new Date().toISOString(), level, msg: message };
  if (context && typeof context === 'object') Object.assign(entry, redact(context));
  let line;
  try {
    line = JSON.stringify(entry);
  } catch {
    line = JSON.stringify({ ts: entry.ts, level, msg: message, ctx: '[nieserializowalny]' });
  }
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
  if (fileStream) fileStream.write(line + '\n');
}

export const logger = {
  debug: (msg, ctx) => emit('debug', msg, ctx),
  info: (msg, ctx) => emit('info', msg, ctx),
  warn: (msg, ctx) => emit('warn', msg, ctx),
  error: (msg, ctx) => emit('error', msg, ctx),
  /** Loguje wyjątek wraz ze stosem (stos nigdy nie trafia do odpowiedzi HTTP). */
  exception: (msg, err, ctx = {}) =>
    emit('error', msg, { ...ctx, err: { name: err?.name, message: err?.message, stack: err?.stack } }),
};

export default logger;

/**
 * Konfiguracja środowiska.
 *
 * Wczytuje plik `.env` z katalogu głównego projektu (bez zależności zewnętrznych),
 * nakłada na niego zmienne środowiskowe procesu i waliduje wynik.
 * Konfiguracja jest niemutowalna — czytana raz przy starcie procesu.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT_DIR = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

/** Prosty parser pliku .env (KEY=VALUE, komentarze `#`, opcjonalne cudzysłowy). */
function parseEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const fileEnv = parseEnvFile(path.join(ROOT_DIR, '.env'));
const raw = { ...fileEnv, ...process.env };

const str = (key, fallback = '') => {
  const v = raw[key];
  return v === undefined || v === '' ? fallback : String(v);
};
const int = (key, fallback) => {
  const v = Number.parseInt(str(key, ''), 10);
  return Number.isFinite(v) ? v : fallback;
};
const bool = (key, fallback) => {
  const v = str(key, '').toLowerCase();
  if (v === '') return fallback;
  return v === 'true' || v === '1' || v === 'yes' || v === 'tak';
};
const list = (key) => str(key, '').split(',').map((s) => s.trim()).filter(Boolean);
const abs = (p) => (path.isAbsolute(p) ? p : path.resolve(ROOT_DIR, p));

const nodeEnv = str('NODE_ENV', 'development');
const isProduction = nodeEnv === 'production';

let authSecret = str('AUTH_SECRET', '');
const generatedSecret = !authSecret;
if (!authSecret) {
  if (isProduction) {
    throw new Error(
      'AUTH_SECRET jest wymagany w trybie production. ' +
        'Wygeneruj: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
    );
  }
  // Tryb deweloperski: klucz ulotny — po restarcie sesje wygasają.
  authSecret = crypto.randomBytes(48).toString('base64url');
}
if (isProduction && authSecret.length < 32) {
  throw new Error('AUTH_SECRET musi mieć co najmniej 32 znaki.');
}

export const config = Object.freeze({
  rootDir: ROOT_DIR,
  env: nodeEnv,
  isProduction,

  http: Object.freeze({
    port: int('PORT', 4173),
    host: str('HOST', '127.0.0.1'),
    corsOrigins: Object.freeze(list('CORS_ORIGINS')),
    bodyLimitBytes: int('ATTACHMENTS_MAX_MB', 12) * 1024 * 1024 + 512 * 1024,
  }),

  auth: Object.freeze({
    secret: authSecret,
    generatedSecret,
    accessTtlMin: int('AUTH_ACCESS_TTL_MIN', 30),
    refreshTtlDays: int('AUTH_REFRESH_TTL_DAYS', 14),
    maxFailed: int('AUTH_MAX_FAILED', 8),
    lockMinutes: int('AUTH_LOCK_MINUTES', 15),
  }),

  db: Object.freeze({
    file: abs(str('DB_FILE', './data/resinvest.db')),
    autoMigrate: bool('DB_AUTO_MIGRATE', true),
  }),

  attachments: Object.freeze({
    dir: abs(str('ATTACHMENTS_DIR', './data/attachments')),
    maxBytes: int('ATTACHMENTS_MAX_MB', 12) * 1024 * 1024,
    allowedMime: Object.freeze([
      'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf',
    ]),
  }),

  backup: Object.freeze({
    dir: abs(str('BACKUP_DIR', './data/backups')),
    keep: int('BACKUP_KEEP', 30),
  }),

  bootstrap: Object.freeze({
    email: str('BOOTSTRAP_ADMIN_EMAIL', 'admin@resinvest.local'),
    password: str('BOOTSTRAP_ADMIN_PASSWORD', ''),
    name: str('BOOTSTRAP_ADMIN_NAME', 'Administrator Systemu'),
  }),

  company: Object.freeze({
    name: str('COMPANY_NAME', 'ResInvest Commodities PL'),
    address: str('COMPANY_ADDRESS', 'ul. Gwarecka 16, 41-800 Zabrze'),
    nip: str('COMPANY_NIP', ''),
    defaultWarehouse: str('COMPANY_DEFAULT_WAREHOUSE', 'Magazyn RiC Zabrze'),
  }),

  log: Object.freeze({
    level: str('LOG_LEVEL', 'info'),
    file: str('LOG_FILE', '') ? abs(str('LOG_FILE', '')) : '',
  }),

  webDir: path.join(ROOT_DIR, 'web'),
});

export default config;

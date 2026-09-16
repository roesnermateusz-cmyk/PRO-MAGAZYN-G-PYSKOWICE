import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Katalog glowny pakietu serwera (działa tak samo dla src/ i dist/). */
export const SERVER_ROOT = path.resolve(here, '..', '..');
export const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

for (const candidate of [
  path.join(REPO_ROOT, '.env'),
  path.join(SERVER_ROOT, '.env'),
]) {
  if (fs.existsSync(candidate)) dotenv.config({ path: candidate });
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Zmienna środowiskowa ${name} musi być liczba całkowita (otrzymano "${raw}")`);
  }
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'tak'].includes(raw.toLowerCase());
}

const nodeEnv = str('NODE_ENV', 'development');
const isProduction = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

function resolveDataDir(): string {
  const configured = str('DATA_DIR', '');
  if (configured) return path.resolve(configured);
  return path.join(SERVER_ROOT, 'data');
}

const dataDir = resolveDataDir();

function resolveSecret(name: string, fallbackFile: string): string {
  const fromEnv = str(name, '');
  if (fromEnv) {
    if (isProduction && fromEnv.length < 32) {
      throw new Error(`${name} musi miec co najmniej 32 znaki w środowisku produkcyjnym.`);
    }
    return fromEnv;
  }
  if (isProduction) {
    // W produkcji sekret jest generowany raz i utrwalany, aby restart uslugi
    // nie uniewaznial wszystkich sesji, ale nigdy nie jest zaszyty w kodzie.
    fs.mkdirSync(dataDir, { recursive: true });
    const file = path.join(dataDir, fallbackFile);
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
    const generated = crypto.randomBytes(48).toString('base64url');
    fs.writeFileSync(file, generated, { mode: 0o600 });
    return generated;
  }
  return `dev-only-${fallbackFile}-secret-change-me-0123456789abcdef`;
}

export const env = {
  nodeEnv,
  isProduction,
  isTest,
  host: str('HOST', '0.0.0.0'),
  port: int('PORT', 4000),
  dataDir,
  databaseFile: str('DATABASE_FILE', '') || path.join(dataDir, 'resinvest.sqlite'),
  attachmentsDir: str('ATTACHMENTS_DIR', '') || path.join(dataDir, 'attachments'),
  backupDir: str('BACKUP_DIR', '') || path.join(dataDir, 'backups'),
  jwtSecret: resolveSecret('JWT_SECRET', 'jwt.secret'),
  refreshSecret: resolveSecret('REFRESH_SECRET', 'refresh.secret'),
  accessTokenTtlMinutes: int('ACCESS_TOKEN_TTL_MINUTES', 30),
  refreshTokenTtlDays: int('REFRESH_TOKEN_TTL_DAYS', 14),
  corsOrigins: str('CORS_ORIGINS', 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  maxUploadMb: int('MAX_UPLOAD_MB', 15),
  loginMaxAttempts: int('LOGIN_MAX_ATTEMPTS', 8),
  loginLockMinutes: int('LOGIN_LOCK_MINUTES', 15),
  backupEnabled: bool('BACKUP_ENABLED', true),
  backupIntervalHours: int('BACKUP_INTERVAL_HOURS', 12),
  backupKeep: int('BACKUP_KEEP', 30),
  serveClient: bool('SERVE_CLIENT', isProduction),
  clientDist: str('CLIENT_DIST', '') || path.join(REPO_ROOT, 'client', 'dist'),
  trustProxy: bool('TRUST_PROXY', false),
} as const;

export type AppEnv = typeof env;

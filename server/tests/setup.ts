import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Konfiguracja srodowiska testowego. Plik jest ladowany przez vitest PRZED
 * modulami testowanymi, dzieki czemu config/env.ts widzi juz wlasciwe wartosci.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resinvest-test-'));

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.DATA_DIR = dir;
process.env.DATABASE_FILE = path.join(dir, 'test.sqlite');
process.env.ATTACHMENTS_DIR = path.join(dir, 'attachments');
process.env.BACKUP_DIR = path.join(dir, 'backups');
process.env.BACKUP_ENABLED = 'false';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.REFRESH_SECRET = crypto.randomBytes(32).toString('hex');
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.SERVE_CLIENT = 'false';

process.on('exit', () => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Wspólne przygotowanie środowiska testowego.
 *
 * Każdy plik testowy dostaje własną bazę w katalogu tymczasowym — testy są
 * niezależne i można je uruchamiać równolegle.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let tempDir = null;

/**
 * Ustawia zmienne środowiskowe PRZED pierwszym importem modułów aplikacji.
 * Musi być wywołane na samej górze pliku testowego.
 */
export function prepareEnv(name = 'test') {
  tempDir = mkdtempSync(path.join(tmpdir(), `resinvest-${name}-`));
  process.env.NODE_ENV = 'test';
  process.env.DB_FILE = path.join(tempDir, 'test.db');
  process.env.ATTACHMENTS_DIR = path.join(tempDir, 'attachments');
  process.env.BACKUP_DIR = path.join(tempDir, 'backups');
  process.env.LOG_LEVEL = 'error';
  process.env.LOG_FILE = '';
  process.env.AUTH_SECRET = 'test-secret-klucz-do-testow-minimum-32-znaki';
  process.env.BOOTSTRAP_ADMIN_PASSWORD = 'TestoweHaslo123';
  process.env.PORT = '0';
  return tempDir;
}

export function cleanupEnv() {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
}

/** Kontekst żądania dla wywołań serwisowych w testach. */
export function testContext(overrides = {}) {
  return {
    user: {
      id: overrides.userId ?? 'test-user',
      email: 'test@resinvest.local',
      fullName: 'Jan Testowy',
      role: overrides.role ?? 'ADMIN',
    },
    ip: '127.0.0.1',
    userAgent: 'node:test',
    ...overrides,
  };
}

/** Domyślne pola dokumentu — testy nadpisują tylko to, co badają. */
export function operationInput(overrides = {}) {
  return {
    type: 'ZAKUP',
    operationDate: '2026-03-10',
    productName: 'Drewno opałowe z lasu',
    quantity: 100,
    unit: 'M3',
    supplierName: 'Nadleśnictwo Testowe',
    pricePurchase: 90,
    signature: 'Jan Testowy',
    ...overrides,
  };
}

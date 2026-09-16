import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { actingUser, docBase, line, setupFixture, stockOf, type TestFixture } from './helpers.js';
import { createDocument, postDocument } from '../src/modules/documents/documents.service.js';
import { closeDb, getDb } from '../src/db/index.js';
import { verifyStockIntegrity } from '../src/modules/documents/stock.engine.js';
import { todayIsoDate } from '../src/core/time.js';
import type { DocumentInput } from '../src/modules/documents/documents.types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(here, 'workers', 'post-document.worker.ts');
const today = todayIsoDate();

let fx: TestFixture;

beforeEach(() => {
  fx = setupFixture();
});

interface WorkerResult {
  ok: boolean;
  code?: string;
  status?: string;
  docNumber?: string;
}

/** Uruchamia zatwierdzenie dokumentu w osobnym procesie systemowym. */
function postInSeparateProcess(documentId: number, version: number, login: string): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', workerPath, String(documentId), String(version), login],
      {
        cwd: path.join(here, '..'),
        env: { ...process.env, LOG_LEVEL: 'error' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', () => {
      try {
        resolve(JSON.parse(stdout) as WorkerResult);
      } catch {
        reject(new Error(`Proces roboczy nie zwrocil poprawnej odpowiedzi.\nstdout: ${stdout}\nstderr: ${stderr}`));
      }
    });
  });
}

function seedStock(qty: number): void {
  const { user, actor } = actingUser(fx.db, 'admin');
  const pz = createDocument(fx.db, user, actor, {
    ...docBase(),
    docType: 'PZ',
    docDate: today,
    warehouseId: fx.warehouses.ZAB as number,
    supplierId: fx.partners['NADL-RUDY'] as number,
    lines: [line(fx.products['DREWNO-OPAL'] as number, qty)],
  });
  postDocument(fx.db, user, actor, pz.id, pz.version);
}

function draftIssue(qty: number, warehouseCode = 'ZAB'): { id: number; version: number } {
  const { user, actor } = actingUser(fx.db, 'admin');
  const input: DocumentInput = {
    ...docBase(),
    docType: 'WZ',
    docDate: today,
    warehouseId: fx.warehouses[warehouseCode] as number,
    customerId: fx.partners['EC-ZABRZE'] as number,
    lines: [line(fx.products['DREWNO-OPAL'] as number, qty, { unitPrice: 200 })],
  };
  const doc = createDocument(fx.db, user, actor, input);
  return { id: doc.id, version: doc.version };
}

describe('praca wielu uzytkownikow jednoczesnie', () => {
  it('dwa procesy nie zatwierdza tego samego dokumentu dwukrotnie', async () => {
    seedStock(100);
    const wz = draftIssue(40);

    // Zamykamy polaczenie procesu testowego, aby konkurowaly wylacznie procesy robocze.
    closeDb();

    const results = await Promise.all([
      postInSeparateProcess(wz.id, wz.version, 'admin'),
      postInSeparateProcess(wz.id, wz.version, 'manager'),
    ]);

    const succeeded = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(['INVALID_STATE', 'VERSION_CONFLICT']).toContain(failed[0]?.code);

    const fresh = setupFixtureReadback();
    expect(stockOf(fresh, fx.warehouses.ZAB as number, fx.products['DREWNO-OPAL'] as number)).toBe(60);
    expect(verifyStockIntegrity(fresh)).toEqual([]);
  });

  it('rownolegle wydania nie doprowadzaja do stanu ujemnego', async () => {
    seedStock(100);
    // Cztery wydania po 40 - lacznie 160 przy dostepnych 100 sztukach.
    const drafts = [draftIssue(40), draftIssue(40), draftIssue(40), draftIssue(40)];
    closeDb();

    const results = await Promise.all(
      drafts.map((d, index) => postInSeparateProcess(d.id, d.version, index % 2 === 0 ? 'admin' : 'manager')),
    );

    const succeeded = results.filter((r) => r.ok);
    const rejected = results.filter((r) => !r.ok);

    // Zmiescic moga sie dokladnie dwa wydania (2 x 40 = 80 <= 100).
    expect(succeeded).toHaveLength(2);
    expect(rejected).toHaveLength(2);
    for (const r of rejected) expect(r.code).toBe('INSUFFICIENT_STOCK');

    const fresh = setupFixtureReadback();
    const remaining = stockOf(fresh, fx.warehouses.ZAB as number, fx.products['DREWNO-OPAL'] as number);
    expect(remaining).toBe(20);
    expect(remaining).toBeGreaterThanOrEqual(0);
    expect(verifyStockIntegrity(fresh)).toEqual([]);
  });

  it('operacje na roznych magazynach wykonuja sie rownolegle bez konfliktu', async () => {
    const { user, actor } = actingUser(fx.db, 'admin');
    for (const code of ['ZAB', 'BRA', 'ROK']) {
      const pz = createDocument(fx.db, user, actor, {
        ...docBase(),
        docType: 'PZ',
        docDate: today,
        warehouseId: fx.warehouses[code] as number,
        supplierId: fx.partners['NADL-RUDY'] as number,
        lines: [line(fx.products['DREWNO-OPAL'] as number, 100)],
      });
      postDocument(fx.db, user, actor, pz.id, pz.version);
    }
    const drafts = ['ZAB', 'BRA', 'ROK'].map((code) => draftIssue(30, code));
    closeDb();

    const results = await Promise.all(drafts.map((d) => postInSeparateProcess(d.id, d.version, 'admin')));
    expect(results.every((r) => r.ok)).toBe(true);

    const fresh = setupFixtureReadback();
    for (const code of ['ZAB', 'BRA', 'ROK']) {
      expect(stockOf(fresh, fx.warehouses[code] as number, fx.products['DREWNO-OPAL'] as number)).toBe(70);
    }
    expect(verifyStockIntegrity(fresh)).toEqual([]);
  });
});

/**
 * Ponowne otwarcie bazy po zamknieciu polaczenia - getDb() tworzy nowe
 * polaczenie, gdy poprzednie zostalo zwolnione przez closeDb().
 */
function setupFixtureReadback() {
  return getDb();
}

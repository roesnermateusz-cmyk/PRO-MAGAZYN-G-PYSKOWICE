/**
 * Bezpieczeństwo danych: kopie zapasowe, eksport i import.
 *
 *  • `createBackup`   — spójna kopia pliku bazy (SQLite Online Backup API),
 *                       bez zatrzymywania pracy użytkowników,
 *  • `exportJson`     — pełny zrzut logiczny (przenośny, czytelny, wersjonowany),
 *  • `importJson`     — odtworzenie zrzutu (tryb `merge` lub `replace`),
 *  • `exportOperationsCsv` — rejestr operacji dla księgowości i Excela.
 *
 * Import zawsze przechodzi przez warstwę serwisową dokumentów, więc dane
 * wchodzące do systemu podlegają tej samej walidacji co ręczne wprowadzanie.
 */
import { mkdirSync, readdirSync, statSync, unlinkSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import config from '../../config/env.js';
import db from '../../db/index.js';
import { cache } from '../../lib/cache.js';
import logger from '../../lib/logger.js';
import { toCsv } from '../../lib/csv.js';
import { ValidationError, ConflictError } from '../../lib/errors.js';
import { audit } from '../../middleware/audit.js';
import { listOperations } from '../operations/operations.service.js';
import { bumpDocCounter, parseDocNo } from '../../domain/documents.js';
import { deriveMoves } from '../../domain/stock.js';
import { CONTENT_COLUMNS, DOCUMENT_COLUMNS } from '../../domain/operation-fields.js';
import { uuid } from '../../lib/crypto.js';

export const EXPORT_FORMAT_VERSION = 1;

/* ---------------------------- Kopia pliku ----------------------------- */

/**
 * Tworzy kopię pliku bazy w katalogu kopii i usuwa najstarsze ponad limit.
 * @returns {{file:string, sizeBytes:number, createdAt:string}}
 */
export function createBackup(ctx, label = 'auto') {
  mkdirSync(config.backup.dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `resinvest-${label}-${stamp}.db`;
  const target = path.join(config.backup.dir, name);

  // WAL wymaga checkpointu, żeby kopia pliku zawierała wszystkie transakcje.
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  copyFileSync(config.db.file, target);

  // Rotacja — zostawiamy `BACKUP_KEEP` najnowszych kopii.
  const files = readdirSync(config.backup.dir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => ({ f, t: statSync(path.join(config.backup.dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const old of files.slice(config.backup.keep)) {
    try { unlinkSync(path.join(config.backup.dir, old.f)); } catch { /* plik zajęty */ }
  }

  const size = statSync(target).size;
  logger.info('Utworzono kopię zapasową', { file: name, sizeBytes: size });
  if (ctx) audit(ctx, 'BACKUP', 'database', name, { sizeBytes: size });
  return { file: name, sizeBytes: size, createdAt: new Date().toISOString() };
}

export function listBackups() {
  mkdirSync(config.backup.dir, { recursive: true });
  return readdirSync(config.backup.dir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const s = statSync(path.join(config.backup.dir, f));
      return { file: f, sizeBytes: s.size, createdAt: new Date(s.mtimeMs).toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/* --------------------------- Eksport JSON ----------------------------- */

const EXPORT_TABLES = [
  'warehouses', 'products', 'partners', 'vehicles',
  'forest_districts', 'forest_ranges', 'loading_places',
  'operations', 'stock_moves', 'attachments', 'corrections',
  'periods', 'stock_snapshots', 'document_counters', 'settings',
];

/**
 * Pełny zrzut logiczny bazy (bez haseł i sesji).
 * @param {object} ctx
 * @param {{includeAudit?:boolean}} options
 */
export function exportJson(ctx, { includeAudit = false } = {}) {
  const data = {};
  for (const table of EXPORT_TABLES) data[table] = db.all(`SELECT * FROM ${table}`);
  data.users = db.all('SELECT id, email, full_name, role, phone, is_active, created_at FROM users');
  if (includeAudit) data.audit_log = db.all('SELECT * FROM audit_log ORDER BY id DESC LIMIT 50000');

  const payload = {
    format: 'resinvest-erp-export',
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy: ctx?.user?.email ?? 'system',
    company: config.company.name,
    counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])),
    data,
  };
  if (ctx) audit(ctx, 'EXPORT', 'database', null, { counts: payload.counts });
  return payload;
}

/**
 * Import zrzutu JSON.
 *
 * @param {object} payload dokument w formacie `resinvest-erp-export`
 * @param {{mode:'merge'|'replace'}} options
 *   `merge`   — dopisuje dokumenty, pomijając te o istniejącym numerze,
 *   `replace` — czyści rejestr dokumentów (kartoteki i użytkownicy zostają).
 * @param {object} ctx
 */
export function importJson(payload, { mode = 'merge' } = {}, ctx) {
  if (!payload || payload.format !== 'resinvest-erp-export') {
    throw new ValidationError('Plik nie jest kopią systemu ResInvest ERP.');
  }
  if (Number(payload.formatVersion) > EXPORT_FORMAT_VERSION) {
    throw new ConflictError(
      `Kopia pochodzi z nowszej wersji systemu (format ${payload.formatVersion}). Zaktualizuj aplikację przed importem.`,
    );
  }
  const source = payload.data || {};
  const summary = { operations: 0, skipped: 0, catalog: 0, errors: [] };

  // Import podmienia dowolną część bazy, więc nie da się wskazać dotkniętego
  // zakresu — czyścimy pamięć podręczną w całości. To jedyne miejsce w systemie,
  // gdzie takie zgrubne unieważnienie jest właściwe.
  cache.flush('import kopii zapasowej');

  return db.tx(() => {
    if (mode === 'replace') {
      db.run('DELETE FROM stock_moves');
      db.run('DELETE FROM corrections');
      db.run('DELETE FROM attachments');
      db.run('DELETE FROM operations');
      db.run('DELETE FROM stock_snapshots');
      db.run('DELETE FROM document_counters');
    }

    /* Kartoteki — wstawiane wprost, bo są słownikami bez logiki biznesowej. */
    summary.catalog += insertRows('warehouses', source.warehouses);
    summary.catalog += insertRows('products', source.products);
    summary.catalog += insertRows('partners', source.partners);
    summary.catalog += insertRows('vehicles', source.vehicles);
    summary.catalog += insertRows('forest_districts', source.forest_districts);
    summary.catalog += insertRows('forest_ranges', source.forest_ranges);
    summary.catalog += insertRows('loading_places', source.loading_places);

    /* Dokumenty — przez warstwę serwisową, z zachowaniem oryginalnych numerów. */
    for (const row of source.operations || []) {
      const exists = db.get('SELECT id FROM operations WHERE doc_no = :docNo', { docNo: row.doc_no });
      if (exists) { summary.skipped += 1; continue; }
      try {
        insertOperationRaw(row, ctx);
        const parsed = parseDocNo(row.doc_no);
        if (parsed) bumpDocCounter(db, parsed.series, parsed.year, parsed.number);
        summary.operations += 1;
      } catch (err) {
        summary.errors.push({ docNo: row.doc_no, message: err.message });
        if (summary.errors.length > 100) throw new ConflictError('Import przerwany — zbyt wiele błędnych dokumentów.');
      }
    }

    insertRows('periods', source.periods);
    insertRows('settings', source.settings, 'REPLACE');

    audit(ctx, 'IMPORT', 'database', null, { mode, ...summary, errors: summary.errors.length });
    return summary;
  });
}

/** Wstawia wiersze zachowując identyfikatory; kolizje są pomijane. */
function insertRows(table, rows, conflict = 'IGNORE') {
  if (!Array.isArray(rows) || !rows.length) return 0;
  const columns = db.all(`PRAGMA table_info(${table})`).map((c) => c.name);
  let inserted = 0;
  for (const row of rows) {
    const cols = columns.filter((c) => c in row);
    if (!cols.length) continue;
    try {
      db.run(
        `INSERT OR ${conflict} INTO ${table}(${cols.join(', ')})
              VALUES (${cols.map((c) => `:${c}`).join(', ')})`,
        Object.fromEntries(cols.map((c) => [c, row[c]])),
      );
      inserted += 1;
    } catch (err) {
      logger.warn('Pominięto wiersz przy imporcie', { table, message: err.message });
    }
  }
  return inserted;
}

/**
 * Wstawia dokument z kopii wraz z ruchami magazynowymi.
 * Zachowuje oryginalny numer i przeliczniki — kopia ma odtworzyć stan 1:1.
 */
function insertOperationRaw(row, ctx) {
  const columns = IMPORTABLE_COLUMNS.filter((c) => c in row);
  const payload = Object.fromEntries(columns.map((c) => [c, row[c]]));
  payload.created_by = db.get('SELECT id FROM users WHERE id = :id', { id: row.created_by })
    ? row.created_by
    : ctx.user.id;
  payload.updated_by = null;
  payload.cancelled_by = null;

  const cols = Object.keys(payload);
  db.run(
    `INSERT INTO operations(${cols.join(', ')}) VALUES (${cols.map((c) => `:${c}`).join(', ')})`,
    payload,
  );

  // Ruchy odtwarzamy z definicji dokumentu, żeby stan zawsze zgadzał się z rejestrem.
  db.run('DELETE FROM stock_moves WHERE operation_id = :id', { id: payload.id });
  for (const move of deriveMoves(payload)) {
    db.run(
      `INSERT INTO stock_moves(id, operation_id, move_date, warehouse_id, product_id,
                               direction, qty_mp, qty_m3, qty_tonne, energy_gj, value)
            VALUES (:id, :operationId, :moveDate, :warehouseId, :productId,
                    :direction, :qtyMp, :qtyM3, :qtyTonne, :energyGj, :value)`,
      {
        id: uuid(),
        operationId: payload.id,
        moveDate: payload.operation_date,
        warehouseId: move.warehouseId,
        productId: move.productId,
        direction: move.direction,
        qtyMp: move.qtyMp,
        qtyM3: move.qtyM3,
        qtyTonne: move.qtyTonne,
        energyGj: move.energyGj,
        value: move.value,
      },
    );
  }
}

/* ----------------------------- Eksport CSV ---------------------------- */

const CSV_COLUMNS = [
  { key: 'operationDate', label: 'Data operacji' },
  { key: 'docNo', label: 'Nr dokumentu' },
  { key: 'type', label: 'Typ' },
  { key: 'status', label: 'Status' },
  { key: 'productName', label: 'Produkt' },
  { key: 'grade', label: 'Rodzaj' },
  { key: 'quantity', label: 'Wolumen' },
  { key: 'unit', label: 'Jednostka' },
  { key: 'qtyM3', label: 'm3' },
  { key: 'qtyMp', label: 'MP' },
  { key: 'qtyTonne', label: 'Tony' },
  { key: 'energyGj', label: 'GJ' },
  { key: 'warehouseFrom', label: 'Magazyn źródłowy' },
  { key: 'warehouseTo', label: 'Magazyn docelowy' },
  { key: 'supplierName', label: 'Dostawca' },
  { key: 'recipientName', label: 'Odbiorca' },
  { key: 'forestDistrict', label: 'Nadleśnictwo' },
  { key: 'forestRange', label: 'Leśnictwo' },
  { key: 'haulageNoteNo', label: 'Nr kwitu wywozowego' },
  { key: 'loadingPlace', label: 'Miejsce załadunku' },
  { key: 'pricePurchase', label: 'Cena zakupu' },
  { key: 'valuePurchase', label: 'Wartość zakupu' },
  { key: 'priceSale', label: 'Cena sprzedaży' },
  { key: 'valueSale', label: 'Wartość sprzedaży' },
  { key: 'chippingMode', label: 'Rąbanie' },
  { key: 'chippingCost', label: 'Koszt rąbania' },
  { key: 'carrierName', label: 'Przewoźnik' },
  { key: 'vehiclePlate', label: 'Nr rejestracyjny' },
  { key: 'distanceKm', label: 'Km' },
  { key: 'transportCost', label: 'Koszt transportu' },
  { key: 'certificate', label: 'Certyfikat' },
  { key: 'isStored', label: 'Magazynowane', format: (v) => (v ? 'TAK' : 'NIE') },
  { key: 'chainRef', label: 'Łańcuch' },
  { key: 'signature', label: 'Podpis' },
  { key: 'notes', label: 'Uwagi' },
  { key: 'createdBy', label: 'Wprowadził' },
  { key: 'createdAt', label: 'Data wprowadzenia' },
];

/* Kolumny dokumentu przyjmowane z kopii — bez kolumn generowanych przez bazę. */
const IMPORTABLE_COLUMNS = Object.freeze([
  ...DOCUMENT_COLUMNS, ...CONTENT_COLUMNS,
  'status', 'revision', 'created_at', 'created_by', 'updated_at', 'updated_by',
  'cancelled_at', 'cancelled_by', 'cancel_reason',
]);

const CSV_PAGE = 500;
const CSV_MAX_ROWS = 200_000;

/** Rejestr operacji w CSV, z uwzględnieniem filtrów z listy (stronicowanie do końca wyniku). */
export function exportOperationsCsv(query, ctx) {
  const rows = [];
  // `withTotals: false` — suma i podsumowania liczone byłyby od nowa dla każdej
  // strony eksportu, a wynik i tak nie jest tu do niczego potrzebny.
  for (let offset = 0; rows.length < CSV_MAX_ROWS; offset += CSV_PAGE) {
    const page = listOperations({ ...query, limit: CSV_PAGE, offset }, { withTotals: false });
    rows.push(...page.items);
    if (page.items.length < CSV_PAGE) break;
  }
  if (ctx) audit(ctx, 'EXPORT_CSV', 'operations', null, { rows: rows.length });
  return toCsv(CSV_COLUMNS, rows);
}

export { CSV_COLUMNS };

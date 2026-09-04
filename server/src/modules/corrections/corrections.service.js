/**
 * Rejestr korekt — historia zmian dokumentów.
 *
 * Każda edycja dokumentu tworzy tu wpis z listą zmienionych pól (przed → po)
 * oraz pełną migawką stanu sprzed zmiany. Rejestr jest tylko do odczytu;
 * przywrócenie stanu odbywa się przez `operations.restoreCorrection`, które
 * tworzy kolejną korektę — historia nigdy nie jest nadpisywana.
 */
import db from '../../db/index.js';
import { validate } from '../../lib/validate.js';
import { NotFoundError } from '../../lib/errors.js';
import { FIELD_LABELS } from '../../domain/operation-fields.js';

/**
 * Kolumny wskazujące na kartotekę — ich wartości trzeba zamienić na nazwy,
 * żeby kontroler czytający rejestr widział „Magazyn RiC Zabrze”, a nie UUID.
 */
const REFERENCE_TABLES = Object.freeze({
  warehouse_from_id: 'warehouses',
  warehouse_to_id: 'warehouses',
  partner_from_id: 'partners',
  partner_to_id: 'partners',
  product_id: 'products',
});

/**
 * Zamienia klucze kartotek na nazwy — jednym zapytaniem na tabelę.
 *
 * Wcześniej nazwa rozwiązywana była pojedynczo, wewnątrz mapowania każdego
 * pola: strona rejestru z pięćdziesięcioma korektami dotykającymi magazynów
 * generowała blisko sto zapytań. Teraz są to najwyżej trzy.
 *
 * @param {Array<{changes_json:string}>} rows wiersze korekt
 * @returns {Map<string,string>} klucz → nazwa
 */
function resolveReferenceNames(rows) {
  /** @type {Record<string, Set<string>>} */
  const wanted = {};

  for (const row of rows) {
    for (const change of JSON.parse(row.changes_json)) {
      const table = REFERENCE_TABLES[change.field];
      if (!table) continue;
      wanted[table] ??= new Set();
      for (const value of [change.from, change.to]) {
        if (typeof value === 'string' && value) wanted[table].add(value);
      }
    }
  }

  const names = new Map();
  for (const [table, ids] of Object.entries(wanted)) {
    const list = [...ids];
    if (!list.length) continue;
    const placeholders = list.map((_, i) => `:id${i}`).join(', ');
    const params = Object.fromEntries(list.map((id, i) => [`id${i}`, id]));
    for (const r of db.all(`SELECT id, name FROM ${table} WHERE id IN (${placeholders})`, params)) {
      names.set(r.id, r.name);
    }
  }
  return names;
}

/** Wartość techniczna → postać czytelna dla człowieka. */
function displayValue(field, value, names) {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'is_stored') return value ? 'TAK' : 'NIE';
  if (REFERENCE_TABLES[field]) return names.get(value) ?? String(value);
  if (typeof value === 'number') return String(Math.round(value * 1000) / 1000);
  return String(value);
}

const mapChanges = (json, names) => JSON.parse(json).map((c) => ({
  field: c.field,
  label: c.label || FIELD_LABELS[c.field] || c.field,
  from: displayValue(c.field, c.from, names),
  to: displayValue(c.field, c.to, names),
}));

export function listCorrections(query = {}) {
  const f = validate(query, {
    operationId: { type: 'string', max: 40 },
    userId: { type: 'string', max: 40 },
    dateFrom: { type: 'date' },
    dateTo: { type: 'date' },
    q: { type: 'string', max: 120 },
    limit: { type: 'int', min: 1, max: 500, default: 100 },
    offset: { type: 'int', min: 0, default: 0 },
  });

  const where = ['1 = 1'];
  const params = { limit: f.limit, offset: f.offset };
  if (f.operationId) { where.push('c.operation_id = :operationId'); params.operationId = f.operationId; }
  if (f.userId) { where.push('c.changed_by = :userId'); params.userId = f.userId; }
  if (f.dateFrom) { where.push('c.changed_at >= :dateFrom'); params.dateFrom = f.dateFrom; }
  if (f.dateTo) { where.push('c.changed_at <= :dateTo'); params.dateTo = `${f.dateTo} 23:59:59`; }
  if (f.q) {
    where.push('(c.doc_no LIKE :q OR c.product_name LIKE :q OR c.changed_by_name LIKE :q)');
    params.q = `%${f.q}%`;
  }
  const whereSql = where.join(' AND ');

  const rows = db.all(
    `SELECT c.*, o.status AS operation_status
       FROM corrections c JOIN operations o ON o.id = c.operation_id
      WHERE ${whereSql}
      ORDER BY c.changed_at DESC
      LIMIT :limit OFFSET :offset`,
    params,
  );
  const total = db.value(`SELECT COUNT(*) FROM corrections c WHERE ${whereSql}`, params);
  const names = resolveReferenceNames(rows);

  return {
    items: rows.map((r) => ({
      id: r.id,
      operationId: r.operation_id,
      docNo: r.doc_no,
      operationType: r.operation_type,
      productName: r.product_name,
      changedAt: r.changed_at,
      changedBy: r.changed_by_name,
      reason: r.reason,
      operationStatus: r.operation_status,
      changes: mapChanges(r.changes_json, names),
    })),
    page: { total, limit: f.limit, offset: f.offset },
    stats: correctionStats(),
  };
}

export function getCorrection(id) {
  const row = db.get('SELECT * FROM corrections WHERE id = :id', { id });
  if (!row) throw new NotFoundError('Nie znaleziono wpisu korekty.');

  return {
    id: row.id,
    operationId: row.operation_id,
    docNo: row.doc_no,
    changedAt: row.changed_at,
    changedBy: row.changed_by_name,
    reason: row.reason,
    changes: mapChanges(row.changes_json, resolveReferenceNames([row])),
    snapshotBefore: JSON.parse(row.snapshot_before),
  };
}

/** Wskaźniki dla nagłówka widoku korekt. */
export function correctionStats() {
  const row = db.get(`
    SELECT COUNT(*) AS total,
           COUNT(DISTINCT operation_id) AS documents,
           SUM(CASE WHEN date(changed_at) = date('now') THEN 1 ELSE 0 END) AS today
      FROM corrections`);
  return { total: row.total || 0, documents: row.documents || 0, today: row.today || 0 };
}

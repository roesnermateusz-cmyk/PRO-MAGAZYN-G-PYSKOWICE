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
import { FIELD_LABELS } from '../operations/operations.service.js';

/** Wartości techniczne zamieniane na czytelne dla kontrolera. */
function displayValue(field, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'is_stored') return value ? 'TAK' : 'NIE';
  if (field.endsWith('_id')) {
    const row = db.get('SELECT name FROM warehouses WHERE id = :id', { id: value })
      || db.get('SELECT name FROM partners WHERE id = :id', { id: value })
      || db.get('SELECT name FROM products WHERE id = :id', { id: value });
    return row?.name ?? String(value);
  }
  if (typeof value === 'number') return String(Math.round(value * 1000) / 1000);
  return String(value);
}

const mapChanges = (json) => JSON.parse(json).map((c) => ({
  field: c.field,
  label: c.label || FIELD_LABELS[c.field] || c.field,
  from: displayValue(c.field, c.from),
  to: displayValue(c.field, c.to),
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
  }, { partial: false });

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

  const rows = db.all(
    `SELECT c.*, o.status AS operation_status
       FROM corrections c JOIN operations o ON o.id = c.operation_id
      WHERE ${where.join(' AND ')}
      ORDER BY c.changed_at DESC
      LIMIT :limit OFFSET :offset`,
    params,
  );
  const total = db.value(
    `SELECT COUNT(*) FROM corrections c WHERE ${where.join(' AND ')}`, params,
  );

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
      changes: mapChanges(r.changes_json),
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
    changes: mapChanges(row.changes_json),
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

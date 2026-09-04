/**
 * Okresy rozliczeniowe (miesiące obrachunkowe).
 *
 * Zamknięcie miesiąca:
 *  • blokuje dopisywanie i korygowanie dokumentów z tego miesiąca,
 *  • utrwala migawkę stanów magazynowych na koniec miesiąca (`stock_snapshots`),
 *    dzięki czemu raport miesięczny jest odtwarzalny co do liczby nawet po
 *    późniejszych zmianach w kartotekach.
 *
 * Miesiąc bez wpisu w tabeli jest traktowany jako OTWARTY.
 */
import db from '../../db/index.js';
import { cache, TAG } from '../../lib/cache.js';
import { PeriodClosedError, ConflictError, NotFoundError, ForbiddenError } from '../../lib/errors.js';
import { validate } from '../../lib/validate.js';
import { audit } from '../../middleware/audit.js';
import { roundQty } from '../../domain/units.js';

/** @returns {'OPEN'|'CLOSED'} */
export function periodStatus(month) {
  const row = db.get('SELECT status FROM periods WHERE month = :month', { month });
  return row?.status === 'CLOSED' ? 'CLOSED' : 'OPEN';
}

/**
 * Rzuca wyjątek, jeżeli miesiąc jest zamknięty.
 * Zamknięcie obowiązuje wszystkich — również administratora. Aby zaksięgować
 * dokument wstecz, kierownik musi świadomie otworzyć okres (ślad w audycie).
 */
export function assertPeriodOpen(month) {
  if (periodStatus(month) === 'CLOSED') throw new PeriodClosedError(month);
}

/** Lista okresów: zamknięte z bazy + miesiące, w których są dokumenty. */
export function listPeriods() {
  const rows = db.all(`
    SELECT m.month,
           COALESCE(p.status, 'OPEN')  AS status,
           p.closed_at, p.reopened_at, p.note,
           uc.full_name AS closed_by_name,
           ur.full_name AS reopened_by_name,
           m.documents, m.qty_mp
      FROM (
        SELECT operation_month AS month, COUNT(*) AS documents, ROUND(SUM(qty_mp), 3) AS qty_mp
          FROM operations WHERE status = 'POSTED' GROUP BY operation_month
        UNION
        SELECT month, 0, 0 FROM periods
      ) m
      LEFT JOIN periods p ON p.month = m.month
      LEFT JOIN users uc  ON uc.id = p.closed_by
      LEFT JOIN users ur  ON ur.id = p.reopened_by
     GROUP BY m.month
     ORDER BY m.month DESC`);
  return rows.map((r) => ({
    month: r.month,
    status: r.status,
    documents: r.documents || 0,
    qtyMp: r.qty_mp || 0,
    closedAt: r.closed_at,
    closedBy: r.closed_by_name,
    reopenedAt: r.reopened_at,
    reopenedBy: r.reopened_by_name,
    note: r.note,
  }));
}

/**
 * Zamyka miesiąc i zapisuje migawkę stanów magazynowych na jego koniec.
 * Wymaga, aby wszystkie wcześniejsze miesiące z dokumentami były zamknięte —
 * inaczej migawki traciłyby ciągłość.
 */
export function closePeriod(month, { note } = {}, ctx) {
  cache.bump([TAG.PERIODS, TAG.STOCK, TAG.DOCUMENTS]);
  const clean = validate({ month, note }, {
    month: { type: 'month', required: true, label: 'Miesiąc' },
    note: { type: 'string', max: 500, label: 'Uwagi' },
  });

  return db.tx(() => {
    if (periodStatus(clean.month) === 'CLOSED') {
      throw new ConflictError(`Okres ${clean.month} jest już zamknięty.`);
    }
    const openEarlier = db.get(
      `SELECT o.operation_month AS month
         FROM operations o
         LEFT JOIN periods p ON p.month = o.operation_month
        WHERE o.status = 'POSTED'
          AND o.operation_month < :month
          AND COALESCE(p.status, 'OPEN') = 'OPEN'
        ORDER BY o.operation_month LIMIT 1`,
      { month: clean.month },
    );
    if (openEarlier) {
      throw new ConflictError(
        `Najpierw zamknij wcześniejszy okres ${openEarlier.month} — okresy zamyka się chronologicznie.`,
      );
    }

    const lastDay = endOfMonth(clean.month);
    const snapshot = db.all(
      `SELECT warehouse_id, product_id,
              SUM(qty_mp) AS qty_mp, SUM(qty_m3) AS qty_m3,
              SUM(qty_tonne) AS qty_tonne, SUM(energy_gj) AS energy_gj
         FROM stock_moves
        WHERE move_date <= :lastDay
        GROUP BY warehouse_id, product_id`,
      { lastDay },
    );

    db.run('DELETE FROM stock_snapshots WHERE month = :month', { month: clean.month });
    for (const s of snapshot) {
      db.run(
        `INSERT INTO stock_snapshots(month, warehouse_id, product_id, qty_mp, qty_m3, qty_tonne, energy_gj)
              VALUES (:month, :warehouseId, :productId, :qtyMp, :qtyM3, :qtyTonne, :energyGj)`,
        {
          month: clean.month,
          warehouseId: s.warehouse_id,
          productId: s.product_id,
          qtyMp: roundQty(s.qty_mp),
          qtyM3: roundQty(s.qty_m3),
          qtyTonne: roundQty(s.qty_tonne),
          energyGj: roundQty(s.energy_gj),
        },
      );
    }

    db.run(
      `INSERT INTO periods(month, status, closed_at, closed_by, note)
            VALUES (:month, 'CLOSED', datetime('now'), :userId, :note)
       ON CONFLICT(month) DO UPDATE
          SET status = 'CLOSED', closed_at = datetime('now'),
              closed_by = :userId, note = :note, reopened_at = NULL, reopened_by = NULL`,
      { month: clean.month, userId: ctx.user.id, note: clean.note ?? null },
    );

    audit(ctx, 'CLOSE_PERIOD', 'periods', clean.month, { positions: snapshot.length });
    return { month: clean.month, status: 'CLOSED', snapshotPositions: snapshot.length };
  });
}

/** Otwiera zamknięty okres — wyłącznie ADMIN i KIEROWNIK, zawsze z uzasadnieniem. */
export function reopenPeriod(month, { reason } = {}, ctx) {
  cache.bump([TAG.PERIODS, TAG.STOCK, TAG.DOCUMENTS]);
  if (!['ADMIN', 'KIEROWNIK'].includes(ctx.user.role)) {
    throw new ForbiddenError('Otwarcie zamkniętego okresu wymaga uprawnień kierownika.');
  }
  const clean = validate({ month, reason }, {
    month: { type: 'month', required: true, label: 'Miesiąc' },
    reason: { type: 'string', required: true, min: 5, max: 500, label: 'Uzasadnienie' },
  });

  const row = db.get('SELECT * FROM periods WHERE month = :month', { month: clean.month });
  if (!row || row.status !== 'CLOSED') throw new NotFoundError(`Okres ${clean.month} nie jest zamknięty.`);

  const laterClosed = db.get(
    "SELECT month FROM periods WHERE status = 'CLOSED' AND month > :month ORDER BY month LIMIT 1",
    { month: clean.month },
  );
  if (laterClosed) {
    throw new ConflictError(
      `Najpierw otwórz późniejszy okres ${laterClosed.month} — okresy otwiera się od najnowszego.`,
    );
  }

  db.run(
    `UPDATE periods
        SET status = 'OPEN', reopened_at = datetime('now'), reopened_by = :userId,
            note = COALESCE(note || ' | ', '') || :reason
      WHERE month = :month`,
    { month: clean.month, userId: ctx.user.id, reason: `Otwarcie: ${clean.reason}` },
  );
  audit(ctx, 'REOPEN_PERIOD', 'periods', clean.month, { reason: clean.reason });
  return { month: clean.month, status: 'OPEN' };
}

/** Ostatni dzień miesiąca w formacie RRRR-MM-DD. */
export function endOfMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, '0')}`;
}

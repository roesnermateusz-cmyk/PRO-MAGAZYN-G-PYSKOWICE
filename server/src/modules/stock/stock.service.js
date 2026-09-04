/**
 * Stany magazynowe.
 *
 * Wszystkie odczyty opierają się na sumowaniu tabeli `stock_moves`, dzięki czemu
 * stan bieżący, stan historyczny i kartoteka magazynowa pochodzą z jednego źródła.
 */
import db from '../../db/index.js';
import { roundQty } from '../../domain/units.js';
import { validate } from '../../lib/validate.js';

/**
 * Stan magazynowy na dzień (domyślnie: bieżący).
 * @param {{date?:string, warehouseId?:string, productId?:string, includeZero?:boolean}} query
 */
export function currentStock(query = {}) {
  const f = validate(query, {
    date: { type: 'date' },
    warehouseId: { type: 'string', max: 40 },
    productId: { type: 'string', max: 40 },
    includeZero: { type: 'bool', default: false },
  }, { partial: true });

  const where = ['1 = 1'];
  const params = {};
  if (f.date) { where.push('m.move_date <= :date'); params.date = f.date; }
  if (f.warehouseId) { where.push('m.warehouse_id = :warehouseId'); params.warehouseId = f.warehouseId; }
  if (f.productId) { where.push('m.product_id = :productId'); params.productId = f.productId; }

  const rows = db.all(
    `SELECT m.warehouse_id, w.name AS warehouse_name,
            m.product_id, p.name AS product_name, p.category, p.default_unit,
            SUM(m.qty_mp) AS qty_mp, SUM(m.qty_m3) AS qty_m3,
            SUM(m.qty_tonne) AS qty_tonne, SUM(m.energy_gj) AS energy_gj,
            SUM(m.value) AS value, MAX(m.move_date) AS last_move
       FROM stock_moves m
       JOIN warehouses w ON w.id = m.warehouse_id
       JOIN products   p ON p.id = m.product_id
      WHERE ${where.join(' AND ')}
      GROUP BY m.warehouse_id, m.product_id
      ORDER BY w.name, p.category, p.name`,
    params,
  );

  const items = rows
    .map((r) => ({
      warehouseId: r.warehouse_id,
      warehouseName: r.warehouse_name,
      productId: r.product_id,
      productName: r.product_name,
      category: r.category,
      defaultUnit: r.default_unit,
      qtyMp: roundQty(r.qty_mp),
      qtyM3: roundQty(r.qty_m3),
      qtyTonne: roundQty(r.qty_tonne),
      energyGj: roundQty(r.energy_gj),
      value: roundQty(r.value),
      lastMoveDate: r.last_move,
    }))
    .filter((r) => f.includeZero || Math.abs(r.qtyMp) > 0.001);

  const totals = items.reduce(
    (a, r) => ({
      qtyMp: roundQty(a.qtyMp + r.qtyMp),
      qtyM3: roundQty(a.qtyM3 + r.qtyM3),
      qtyTonne: roundQty(a.qtyTonne + r.qtyTonne),
      energyGj: roundQty(a.energyGj + r.energyGj),
    }),
    { qtyMp: 0, qtyM3: 0, qtyTonne: 0, energyGj: 0 },
  );

  // Podsumowanie w podziale na produkt (widok „pryzmy” na pulpicie).
  const byProduct = new Map();
  for (const r of items) {
    const acc = byProduct.get(r.productId) || {
      productId: r.productId, productName: r.productName, category: r.category,
      qtyMp: 0, qtyM3: 0, qtyTonne: 0, energyGj: 0, warehouses: [],
    };
    acc.qtyMp = roundQty(acc.qtyMp + r.qtyMp);
    acc.qtyM3 = roundQty(acc.qtyM3 + r.qtyM3);
    acc.qtyTonne = roundQty(acc.qtyTonne + r.qtyTonne);
    acc.energyGj = roundQty(acc.energyGj + r.energyGj);
    acc.warehouses.push({ warehouseId: r.warehouseId, warehouseName: r.warehouseName, qtyMp: r.qtyMp });
    byProduct.set(r.productId, acc);
  }

  return {
    asOf: f.date || new Date().toISOString().slice(0, 10),
    items,
    byProduct: [...byProduct.values()].sort((a, b) => b.qtyMp - a.qtyMp),
    totals,
  };
}

/**
 * Kartoteka magazynowa produktu — chronologiczny ciąg ruchów wraz ze stanem
 * narastającym (podstawa uzgodnień i kontroli).
 *
 * Bilanse liczone są agregatem po całym okresie, niezależnie od `limit`.
 * Wcześniej stan końcowy brał się z sumowania wyświetlonych wierszy, więc przy
 * historii dłuższej niż limit kartoteka pokazywała saldo urwane w połowie —
 * rozbieżne z listą stanów, która sumuje wszystko. `limit` ogranicza wyłącznie
 * długość wypisu, nigdy liczb.
 *
 * Gdy ruchów jest więcej niż `limit`, pokazujemy okno NAJNOWSZE — kartotekę
 * czyta się od bieżącego stanu wstecz. Saldo pierwszego wiersza okna wynika
 * z odjęcia sumy okna od stanu końcowego, więc kolumna „Saldo MP” pozostaje
 * ciągła i kończy się rzeczywistym stanem magazynu.
 */
export function stockLedger(query) {
  const f = validate(query, {
    productId: { type: 'string', required: true, max: 40, label: 'Produkt' },
    warehouseId: { type: 'string', max: 40 },
    dateFrom: { type: 'date' },
    dateTo: { type: 'date' },
    limit: { type: 'int', min: 1, max: 2000, default: 500 },
  });

  const where = ['m.product_id = :productId'];
  const params = { productId: f.productId, limit: f.limit };
  if (f.warehouseId) { where.push('m.warehouse_id = :warehouseId'); params.warehouseId = f.warehouseId; }

  // Bilans otwarcia okresu liczony osobno, żeby stan narastający był poprawny.
  let opening = 0;
  if (f.dateFrom) {
    opening = db.value(
      `SELECT COALESCE(SUM(m.qty_mp), 0) FROM stock_moves m
        WHERE ${where.join(' AND ')} AND m.move_date < :dateFrom`,
      { ...params, dateFrom: f.dateFrom },
    );
    where.push('m.move_date >= :dateFrom');
    params.dateFrom = f.dateFrom;
  }
  if (f.dateTo) { where.push('m.move_date <= :dateTo'); params.dateTo = f.dateTo; }

  const whereSql = where.join(' AND ');

  // Obrót i liczba ruchów całego okresu — podstawa bilansów i informacji o obcięciu.
  const period = db.get(
    `SELECT COUNT(*) AS moves, COALESCE(SUM(m.qty_mp), 0) AS qty_mp
       FROM stock_moves m WHERE ${whereSql}`,
    params,
  );
  const closing = roundQty(opening + period.qty_mp);
  const truncated = period.moves > f.limit;

  // Okno pobierane od najnowszych, wypisywane chronologicznie.
  const rows = db.all(
    `SELECT m.*, o.doc_no, o.type, o.supplier_name, o.recipient_name, o.status,
            w.name AS warehouse_name
       FROM stock_moves m
       JOIN operations o ON o.id = m.operation_id
       JOIN warehouses w ON w.id = m.warehouse_id
      WHERE ${whereSql}
      ORDER BY m.move_date DESC, m.created_at DESC
      LIMIT :limit`,
    params,
  ).reverse();

  // Saldo startowe okna: stan końcowy pomniejszony o obrót samego okna.
  // Przy pełnym wypisie jest tożsame z bilansem otwarcia — bierzemy go wprost,
  // żeby zaokrąglenia pośrednie nie przesunęły pierwszego wiersza.
  let running = truncated
    ? roundQty(closing - rows.reduce((sum, r) => sum + r.qty_mp, 0))
    : roundQty(opening);

  const items = rows.map((r) => {
    running = roundQty(running + r.qty_mp);
    return {
      date: r.move_date,
      operationId: r.operation_id,
      docNo: r.doc_no,
      type: r.type,
      warehouseName: r.warehouse_name,
      counterparty: r.qty_mp >= 0 ? r.supplier_name : r.recipient_name,
      qtyMp: roundQty(r.qty_mp),
      qtyTonne: roundQty(r.qty_tonne),
      balanceMp: running,
    };
  });

  return {
    opening: roundQty(opening),
    closing,
    items,
    moves: period.moves,
    truncated,
  };
}

/** Pozycje ze stanem ujemnym — sygnał braku dokumentu przyjęcia. */
export function negativeStock() {
  return db.all(
    `SELECT warehouse_name, product_name, qty_mp, qty_tonne
       FROM v_stock_current WHERE qty_mp < -0.001 ORDER BY qty_mp`,
  ).map((r) => ({
    warehouseName: r.warehouse_name,
    productName: r.product_name,
    qtyMp: r.qty_mp,
    qtyTonne: r.qty_tonne,
  }));
}

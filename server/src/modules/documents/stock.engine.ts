import type { Db } from '../../db/index.js';
import { insufficientStock } from '../../core/errors.js';
import { nowIso } from '../../core/time.js';
import { roundQty, type BaseUnit } from '../../core/units.js';
import type { DocumentLineRow, DocumentRow } from './documents.types.js';
import { STOCK_AFFECTING } from './documents.types.js';

/** Tolerancja porownan ilosci - eliminuje falszywe alarmy zaokraglen IEEE-754. */
const EPS = 1e-6;

export interface PlannedMovement {
  warehouseId: number;
  productId: number;
  direction: 'IN' | 'OUT';
  qtyBase: number;
  baseUnit: BaseUnit;
  lineId: number | null;
}

/**
 * Wyznacza ruchy magazynowe wynikajace z dokumentu.
 *
 *   PZ   -> IN  do magazynu dokumentu
 *   WZ   -> OUT z magazynu dokumentu
 *   MM   -> OUT z magazynu zrodlowego + IN do docelowego (para nierozlaczna)
 *   PROD -> OUT surowca (INPUT) + IN wyrobu (OUTPUT) w magazynie dokumentu
 *   TR, SD -> brak wplywu na stan
 */
export function planMovements(doc: DocumentRow, lines: DocumentLineRow[]): PlannedMovement[] {
  if (!STOCK_AFFECTING.has(doc.doc_type)) return [];

  const movements: PlannedMovement[] = [];

  for (const line of lines) {
    const common = {
      productId: line.product_id,
      qtyBase: roundQty(line.qty_base),
      baseUnit: line.base_unit,
      lineId: line.id,
    };

    switch (doc.doc_type) {
      case 'PZ':
        movements.push({ ...common, warehouseId: requireWh(doc.warehouse_id, 'magazyn dokumentu'), direction: 'IN' });
        break;
      case 'WZ':
        movements.push({ ...common, warehouseId: requireWh(doc.warehouse_id, 'magazyn dokumentu'), direction: 'OUT' });
        break;
      case 'MM':
        movements.push({ ...common, warehouseId: requireWh(doc.warehouse_from_id, 'magazyn zrodlowy'), direction: 'OUT' });
        movements.push({ ...common, warehouseId: requireWh(doc.warehouse_to_id, 'magazyn docelowy'), direction: 'IN' });
        break;
      case 'PROD':
        movements.push({
          ...common,
          warehouseId: requireWh(doc.warehouse_id, 'magazyn produkcji'),
          direction: line.line_role === 'OUTPUT' ? 'IN' : 'OUT',
        });
        break;
      default:
        break;
    }
  }

  return movements;
}

function requireWh(value: number | null, label: string): number {
  if (value === null) throw new Error(`Dokument nie ma ustawionego pola: ${label}.`);
  return value;
}

export function getStockQty(db: Db, warehouseId: number, productId: number): number {
  const row = db
    .prepare('SELECT qty_base FROM stock WHERE warehouse_id = ? AND product_id = ?')
    .get(warehouseId, productId) as { qty_base: number } | undefined;
  return row ? roundQty(row.qty_base) : 0;
}

interface ApplyOptions {
  allowNegative: boolean;
  reason: 'POSTING' | 'REVERSAL';
  userId: number;
}

/**
 * Zapisuje ruchy magazynowe i aktualizuje salda.
 * MUSI byc wywolane wewnatrz transakcji zapisu - w przeciwnym razie mozliwy
 * jest stan czesciowy (np. minus w magazynie A bez plusa w magazynie B).
 */
export function applyMovements(
  db: Db,
  doc: DocumentRow,
  movements: PlannedMovement[],
  options: ApplyOptions,
): void {
  if (movements.length === 0) return;

  // 1. Agregacja netto per (magazyn, produkt) - pozwala poprawnie ocenic
  //    dokument zawierajacy kilka pozycji tego samego produktu.
  const net = new Map<string, { warehouseId: number; productId: number; delta: number }>();
  for (const m of movements) {
    const key = `${m.warehouseId}:${m.productId}`;
    const delta = m.direction === 'IN' ? m.qtyBase : -m.qtyBase;
    const existing = net.get(key);
    if (existing) existing.delta = roundQty(existing.delta + delta);
    else net.set(key, { warehouseId: m.warehouseId, productId: m.productId, delta: roundQty(delta) });
  }

  // 2. Kontrola dostepnosci PRZED jakimkolwiek zapisem.
  if (!options.allowNegative) {
    const shortages: Array<{ warehouseId: number; productId: number; available: number; required: number }> = [];
    for (const entry of net.values()) {
      if (entry.delta >= 0) continue;
      const available = getStockQty(db, entry.warehouseId, entry.productId);
      if (available + entry.delta < -EPS) {
        shortages.push({
          warehouseId: entry.warehouseId,
          productId: entry.productId,
          available,
          required: roundQty(-entry.delta),
        });
      }
    }
    if (shortages.length > 0) {
      throw insufficientStock(
        'Niewystarczajacy stan magazynowy do wykonania operacji.',
        shortages.map((s) => ({
          ...s,
          warehouseName: warehouseName(db, s.warehouseId),
          productName: productName(db, s.productId),
        })),
      );
    }
  }

  // 3. Zapis ruchow (ksiega niemodyfikowalna).
  const insertMovement = db.prepare(
    `INSERT INTO stock_movements
       (document_id, document_line_id, warehouse_id, product_id, direction,
        qty_base, base_unit, doc_date, reason, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const stamp = nowIso();
  for (const m of movements) {
    insertMovement.run(
      doc.id,
      m.lineId,
      m.warehouseId,
      m.productId,
      m.direction,
      m.qtyBase,
      m.baseUnit,
      doc.doc_date,
      options.reason,
      stamp,
      options.userId,
    );
  }

  // 4. Aktualizacja sald.
  const upsert = db.prepare(
    `INSERT INTO stock (warehouse_id, product_id, qty_base, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (warehouse_id, product_id)
       DO UPDATE SET qty_base = ROUND(stock.qty_base + excluded.qty_base, 4),
                     updated_at = excluded.updated_at`,
  );
  for (const entry of net.values()) {
    upsert.run(entry.warehouseId, entry.productId, entry.delta, stamp);
  }
}

/** Buduje ruchy odwrotne do juz zaksiegowanych (storno przy anulowaniu). */
export function planReversal(db: Db, documentId: number): PlannedMovement[] {
  const rows = db
    .prepare(
      `SELECT document_line_id, warehouse_id, product_id, direction, qty_base, base_unit, reason
         FROM stock_movements
        WHERE document_id = ?
        ORDER BY id`,
    )
    .all(documentId) as Array<{
    document_line_id: number | null;
    warehouse_id: number;
    product_id: number;
    direction: 'IN' | 'OUT';
    qty_base: number;
    base_unit: BaseUnit;
    reason: string;
  }>;

  // Storno dotyczy wylacznie ruchow ksiegowania; ruchy typu REVERSAL pomijamy,
  // zeby wielokrotne anulowanie nie mnozylo korekt.
  return rows
    .filter((r) => r.reason === 'POSTING')
    .map((r) => ({
      warehouseId: r.warehouse_id,
      productId: r.product_id,
      direction: r.direction === 'IN' ? ('OUT' as const) : ('IN' as const),
      qtyBase: roundQty(r.qty_base),
      baseUnit: r.base_unit,
      lineId: r.document_line_id,
    }));
}

function warehouseName(db: Db, id: number): string {
  const row = db.prepare('SELECT name FROM warehouses WHERE id = ?').get(id) as { name: string } | undefined;
  return row?.name ?? `#${id}`;
}

function productName(db: Db, id: number): string {
  const row = db.prepare('SELECT name FROM products WHERE id = ?').get(id) as { name: string } | undefined;
  return row?.name ?? `#${id}`;
}

/**
 * Kontrola integralnosci: porownuje salda w tabeli stock z suma ruchow.
 * Uzywana przez endpoint konserwacji i testy regresyjne.
 */
export function verifyStockIntegrity(db: Db): Array<{
  warehouseId: number;
  productId: number;
  balance: number;
  ledger: number;
}> {
  const rows = db
    .prepare(
      `SELECT w.warehouse_id AS warehouseId,
              w.product_id   AS productId,
              w.balance      AS balance,
              COALESCE(m.ledger, 0) AS ledger
         FROM (SELECT warehouse_id, product_id, qty_base AS balance FROM stock) w
         LEFT JOIN (
              SELECT warehouse_id, product_id,
                     SUM(CASE WHEN direction = 'IN' THEN qty_base ELSE -qty_base END) AS ledger
                FROM stock_movements
               GROUP BY warehouse_id, product_id
         ) m ON m.warehouse_id = w.warehouse_id AND m.product_id = w.product_id`,
    )
    .all() as Array<{ warehouseId: number; productId: number; balance: number; ledger: number }>;

  return rows.filter((r) => Math.abs(r.balance - r.ledger) > EPS);
}

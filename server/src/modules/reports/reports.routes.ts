import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { requireCtx } from '../../core/context.js';
import { asyncHandler } from '../../middleware/async.js';
import { requirePermission, assertWarehouseAccess } from '../../middleware/auth.js';
import { parseQuery } from '../../middleware/validate.js';
import { isIsoDate, monthRange, todayIsoDate, yearRange } from '../../core/time.js';
import { roundQty } from '../../core/units.js';
import { toPln } from '../../core/money.js';
import { writeAudit } from '../../core/audit.js';
import { badRequest } from '../../core/errors.js';

export const reportsRouter = Router();

const periodSchema = z
  .object({
    /** Tryb okresu: konkretny miesiac, caly rok lub zakres dat. */
    mode: z.enum(['month', 'year', 'range']).default('month'),
    month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    dateFrom: z.string().refine(isIsoDate).optional(),
    dateTo: z.string().refine(isIsoDate).optional(),
    warehouseId: z.coerce.number().int().positive().optional(),
  })
  .transform((v) => {
    if (v.mode === 'month') {
      const month = v.month ?? todayIsoDate().slice(0, 7);
      return { ...v, ...monthRange(month), label: month };
    }
    if (v.mode === 'year') {
      const year = v.year ?? new Date().getFullYear();
      return { ...v, ...yearRange(year), label: String(year) };
    }
    if (!v.dateFrom || !v.dateTo) {
      throw new Error('Tryb zakresu wymaga dat dateFrom i dateTo.');
    }
    return { ...v, from: v.dateFrom, to: v.dateTo, label: `${v.dateFrom} - ${v.dateTo}` };
  });

interface Scope {
  from: string;
  to: string;
  label: string;
  warehouseIds: number[];
}

function resolveScope(req: Parameters<typeof requireCtx>[0]): Scope {
  const { user } = requireCtx(req);
  const parsed = parseQuery(req, periodSchema);
  if (parsed.from > parsed.to) throw badRequest('Data początkowa nie może być późniejsza niż końcowa.');
  const warehouseIds = parsed.warehouseId
    ? [assertWarehouseAccess(user.warehouseIds, parsed.warehouseId)]
    : user.warehouseIds;
  return { from: parsed.from, to: parsed.to, label: parsed.label, warehouseIds };
}

function warehouseFilter(ids: number[]): string {
  if (ids.length === 0) return '1 = 0';
  const list = ids.join(',');
  return `(d.warehouse_id IN (${list}) OR d.warehouse_from_id IN (${list}) OR d.warehouse_to_id IN (${list})
           OR (d.warehouse_id IS NULL AND d.warehouse_from_id IS NULL AND d.warehouse_to_id IS NULL))`;
}

/** Zestawienie zbiorcze: obroty wg typu dokumentu i wg produktu. */
reportsRouter.get(
  '/summary',
  requirePermission('reports.view'),
  asyncHandler((req, res) => {
    const scope = resolveScope(req);
    const db = getDb();

    const byType = db
      .prepare(
        `SELECT d.doc_type,
                COUNT(*) AS documents,
                COALESCE(SUM(d.total_value_gr), 0) AS value_gr,
                COALESCE(SUM(d.total_cost_gr), 0) AS cost_gr
           FROM documents d
          WHERE d.status = 'POSTED' AND d.doc_date BETWEEN ? AND ? AND ${warehouseFilter(scope.warehouseIds)}
          GROUP BY d.doc_type
          ORDER BY d.doc_type`,
      )
      .all(scope.from, scope.to) as Array<{ doc_type: string; documents: number; value_gr: number; cost_gr: number }>;

    const byProduct = db
      .prepare(
        `SELECT p.id, p.code, p.name, p.base_unit, d.doc_type,
                COALESCE(SUM(dl.qty_base), 0) AS qty_base,
                COALESCE(SUM(dl.qty_m3), 0)   AS qty_m3,
                COALESCE(SUM(dl.qty_mp), 0)   AS qty_mp,
                COALESCE(SUM(dl.qty_t), 0)    AS qty_t,
                COALESCE(SUM(dl.value_gr), 0) AS value_gr
           FROM document_lines dl
           JOIN documents d ON d.id = dl.document_id
           JOIN products  p ON p.id = dl.product_id
          WHERE d.status = 'POSTED' AND d.doc_date BETWEEN ? AND ? AND ${warehouseFilter(scope.warehouseIds)}
          GROUP BY p.id, d.doc_type
          ORDER BY p.name, d.doc_type`,
      )
      .all(scope.from, scope.to) as Array<Record<string, any>>;

    const byMonth = db
      .prepare(
        `SELECT substr(d.doc_date, 1, 7) AS month, d.doc_type,
                COUNT(*) AS documents,
                COALESCE(SUM(d.total_value_gr), 0) AS value_gr
           FROM documents d
          WHERE d.status = 'POSTED' AND d.doc_date BETWEEN ? AND ? AND ${warehouseFilter(scope.warehouseIds)}
          GROUP BY month, d.doc_type
          ORDER BY month`,
      )
      .all(scope.from, scope.to) as Array<{ month: string; doc_type: string; documents: number; value_gr: number }>;

    res.json({
      period: { from: scope.from, to: scope.to, label: scope.label },
      byType: byType.map((r) => ({
        docType: r.doc_type,
        documents: r.documents,
        value: toPln(r.value_gr),
        cost: toPln(r.cost_gr),
      })),
      byProduct: byProduct.map((r) => ({
        productId: r.id,
        productCode: r.code,
        productName: r.name,
        baseUnit: r.base_unit,
        docType: r.doc_type,
        qtyBase: roundQty(r.qty_base),
        qtyM3: roundQty(r.qty_m3),
        qtyMp: roundQty(r.qty_mp),
        qtyT: roundQty(r.qty_t),
        value: toPln(r.value_gr),
      })),
      byMonth: byMonth.map((r) => ({
        month: r.month,
        docType: r.doc_type,
        documents: r.documents,
        value: toPln(r.value_gr),
      })),
    });
  }),
);

/** Raport produkcji: zużycie surowca, wyroby, koszt rąbania, wydajnosc. */
reportsRouter.get(
  '/production',
  requirePermission('reports.view'),
  asyncHandler((req, res) => {
    const scope = resolveScope(req);
    const db = getDb();

    const rows = db
      .prepare(
        `SELECT d.id, d.doc_number, d.doc_date, d.production_place, d.chipping_mode,
                d.chipping_company, d.chipping_rate_gr, d.chipping_cost_gr,
                w.name AS warehouse_name, u.full_name AS created_by,
                (SELECT COALESCE(SUM(dl.qty_base), 0) FROM document_lines dl
                  WHERE dl.document_id = d.id AND dl.line_role = 'INPUT') AS input_qty,
                (SELECT COALESCE(SUM(dl.qty_base), 0) FROM document_lines dl
                  WHERE dl.document_id = d.id AND dl.line_role = 'OUTPUT') AS output_qty,
                (SELECT COALESCE(SUM(dl.qty_t), 0) FROM document_lines dl
                  WHERE dl.document_id = d.id AND dl.line_role = 'OUTPUT') AS output_t
           FROM documents d
           LEFT JOIN warehouses w ON w.id = d.warehouse_id
           JOIN users u ON u.id = d.created_by
          WHERE d.doc_type = 'PROD' AND d.status = 'POSTED'
            AND d.doc_date BETWEEN ? AND ? AND ${warehouseFilter(scope.warehouseIds)}
          ORDER BY d.doc_date DESC, d.id DESC`,
      )
      .all(scope.from, scope.to) as Array<Record<string, any>>;

    const items = rows.map((r) => ({
      id: r.id,
      docNumber: r.doc_number,
      docDate: r.doc_date,
      warehouseName: r.warehouse_name,
      productionPlace: r.production_place,
      chippingMode: r.chipping_mode,
      chippingCompany: r.chipping_company,
      chippingRate: toPln(r.chipping_rate_gr),
      chippingCost: toPln(r.chipping_cost_gr),
      inputQty: roundQty(r.input_qty),
      outputQty: roundQty(r.output_qty),
      outputT: roundQty(r.output_t),
      yield: r.input_qty > 0 ? Math.round((r.output_qty / r.input_qty) * 1000) / 1000 : null,
      createdBy: r.created_by,
    }));

    res.json({
      period: { from: scope.from, to: scope.to, label: scope.label },
      items,
      totals: {
        documents: items.length,
        inputQty: roundQty(items.reduce((s, i) => s + i.inputQty, 0)),
        outputQty: roundQty(items.reduce((s, i) => s + i.outputQty, 0)),
        chippingCost: Math.round(items.reduce((s, i) => s + i.chippingCost, 0) * 100) / 100,
      },
    });
  }),
);

/** Raport transportu wraz z wyliczonymi wskaznikami kosztowymi. */
reportsRouter.get(
  '/transport',
  requirePermission('reports.view'),
  asyncHandler((req, res) => {
    const scope = resolveScope(req);
    const db = getDb();

    const rows = db
      .prepare(
        `SELECT d.id, d.doc_number, d.doc_date, d.vehicle_plate, d.driver_name,
                d.load_place, d.unload_place, d.distance_km,
                d.transport_rate_gr, d.transport_cost_gr,
                pc.name AS carrier_name,
                (SELECT COALESCE(SUM(dl.qty_t), 0) FROM document_lines dl WHERE dl.document_id = d.id) AS qty_t,
                (SELECT COALESCE(SUM(dl.qty_mp), 0) FROM document_lines dl WHERE dl.document_id = d.id) AS qty_mp,
                (SELECT COALESCE(SUM(dl.qty_m3), 0) FROM document_lines dl WHERE dl.document_id = d.id) AS qty_m3
           FROM documents d
           LEFT JOIN partners pc ON pc.id = d.carrier_id
          WHERE d.doc_type = 'TR' AND d.status = 'POSTED'
            AND d.doc_date BETWEEN ? AND ? AND ${warehouseFilter(scope.warehouseIds)}
          ORDER BY d.doc_date DESC, d.id DESC`,
      )
      .all(scope.from, scope.to) as Array<Record<string, any>>;

    const items = rows.map((r) => {
      const cost = toPln(r.transport_cost_gr);
      return {
        id: r.id,
        docNumber: r.doc_number,
        docDate: r.doc_date,
        carrierName: r.carrier_name,
        vehiclePlate: r.vehicle_plate,
        driverName: r.driver_name,
        loadPlace: r.load_place,
        unloadPlace: r.unload_place,
        distanceKm: roundQty(r.distance_km),
        rate: toPln(r.transport_rate_gr),
        cost,
        qtyT: roundQty(r.qty_t),
        qtyMp: roundQty(r.qty_mp),
        qtyM3: roundQty(r.qty_m3),
        costPerKm: r.distance_km > 0 ? Math.round((cost / r.distance_km) * 100) / 100 : null,
        costPerT: r.qty_t > 0 ? Math.round((cost / r.qty_t) * 100) / 100 : null,
        costPerMp: r.qty_mp > 0 ? Math.round((cost / r.qty_mp) * 100) / 100 : null,
        costPerM3: r.qty_m3 > 0 ? Math.round((cost / r.qty_m3) * 100) / 100 : null,
      };
    });

    res.json({
      period: { from: scope.from, to: scope.to, label: scope.label },
      items,
      totals: {
        documents: items.length,
        distanceKm: roundQty(items.reduce((s, i) => s + i.distanceKm, 0)),
        cost: Math.round(items.reduce((s, i) => s + i.cost, 0) * 100) / 100,
      },
    });
  }),
);

/** Zakupy i sprzedaż wg kontrahenta. */
reportsRouter.get(
  '/partners',
  requirePermission('reports.view'),
  asyncHandler((req, res) => {
    const scope = resolveScope(req);
    const db = getDb();

    const rows = db
      .prepare(
        `SELECT pt.id, pt.name, pt.code,
                SUM(CASE WHEN d.doc_type IN ('PZ') THEN d.total_value_gr ELSE 0 END) AS purchase_gr,
                SUM(CASE WHEN d.doc_type IN ('WZ', 'SD') THEN d.total_value_gr ELSE 0 END) AS sale_gr,
                COUNT(*) AS documents
           FROM documents d
           JOIN partners pt ON pt.id = COALESCE(d.customer_id, d.supplier_id)
          WHERE d.status = 'POSTED' AND d.doc_type IN ('PZ', 'WZ', 'SD')
            AND d.doc_date BETWEEN ? AND ? AND ${warehouseFilter(scope.warehouseIds)}
          GROUP BY pt.id
          ORDER BY (purchase_gr + sale_gr) DESC`,
      )
      .all(scope.from, scope.to) as Array<Record<string, any>>;

    res.json({
      period: { from: scope.from, to: scope.to, label: scope.label },
      items: rows.map((r) => ({
        partnerId: r.id,
        partnerCode: r.code,
        partnerName: r.name,
        documents: r.documents,
        purchaseValue: toPln(r.purchase_gr),
        saleValue: toPln(r.sale_gr),
      })),
    });
  }),
);

/** Eksport zestawien do CSV (separator srednik, kodowanie UTF-8 z BOM). */
reportsRouter.get(
  '/export',
  requirePermission('reports.export'),
  asyncHandler((req, res) => {
    const { actor } = requireCtx(req);
    const { kind } = parseQuery(req, z.object({ kind: z.enum(['documents', 'stock', 'movements']) }));
    const scope = resolveScope(req);
    const db = getDb();

    let header: string[] = [];
    let rows: string[][] = [];

    if (kind === 'documents') {
      header = ['Numer', 'Typ', 'Data', 'Status', 'Magazyn', 'Kontrahent', 'Ilość bazowa', 'MP', 'm3', 't', 'Wartość PLN'];
      const data = db
        .prepare(
          `SELECT d.doc_number, d.doc_type, d.doc_date, d.status,
                  COALESCE(w.name, wf.name, '') AS warehouse,
                  COALESCE(pc.name, ps.name, '') AS partner,
                  d.total_value_gr,
                  (SELECT COALESCE(SUM(dl.qty_base), 0) FROM document_lines dl
                    WHERE dl.document_id = d.id AND dl.line_role <> 'INPUT') AS qty_base,
                  (SELECT COALESCE(SUM(dl.qty_mp), 0) FROM document_lines dl
                    WHERE dl.document_id = d.id AND dl.line_role <> 'INPUT') AS qty_mp,
                  (SELECT COALESCE(SUM(dl.qty_m3), 0) FROM document_lines dl
                    WHERE dl.document_id = d.id AND dl.line_role <> 'INPUT') AS qty_m3,
                  (SELECT COALESCE(SUM(dl.qty_t), 0) FROM document_lines dl
                    WHERE dl.document_id = d.id AND dl.line_role <> 'INPUT') AS qty_t
             FROM documents d
             LEFT JOIN warehouses w  ON w.id  = d.warehouse_id
             LEFT JOIN warehouses wf ON wf.id = d.warehouse_from_id
             LEFT JOIN partners  ps  ON ps.id = d.supplier_id
             LEFT JOIN partners  pc  ON pc.id = d.customer_id
            WHERE d.doc_date BETWEEN ? AND ? AND ${warehouseFilter(scope.warehouseIds)}
            ORDER BY d.doc_date, d.doc_number`,
        )
        .all(scope.from, scope.to) as Array<Record<string, any>>;
      rows = data.map((r) => [
        r.doc_number,
        r.doc_type,
        r.doc_date,
        r.status,
        r.warehouse,
        r.partner,
        num(r.qty_base),
        num(r.qty_mp),
        num(r.qty_m3),
        num(r.qty_t),
        num(toPln(r.total_value_gr)),
      ]);
    } else if (kind === 'stock') {
      header = ['Magazyn', 'Kod produktu', 'Produkt', 'Jednostka', 'Stan', 'Aktualizacja'];
      const list = scope.warehouseIds.length > 0 ? scope.warehouseIds.join(',') : '0';
      const data = db
        .prepare(
          `SELECT w.name AS warehouse, p.code, p.name, p.base_unit, s.qty_base, s.updated_at
             FROM stock s JOIN warehouses w ON w.id = s.warehouse_id JOIN products p ON p.id = s.product_id
            WHERE s.warehouse_id IN (${list})
            ORDER BY w.name, p.name`,
        )
        .all() as Array<Record<string, any>>;
      rows = data.map((r) => [r.warehouse, r.code, r.name, r.base_unit, num(r.qty_base), r.updated_at]);
    } else {
      header = ['Data', 'Dokument', 'Typ', 'Magazyn', 'Produkt', 'Kierunek', 'Ilość', 'Jednostka', 'Użytkownik'];
      const list = scope.warehouseIds.length > 0 ? scope.warehouseIds.join(',') : '0';
      const data = db
        .prepare(
          `SELECT m.doc_date, d.doc_number, d.doc_type, w.name AS warehouse, p.name AS product,
                  m.direction, m.qty_base, m.base_unit, u.full_name
             FROM stock_movements m
             JOIN documents d ON d.id = m.document_id
             JOIN warehouses w ON w.id = m.warehouse_id
             JOIN products p ON p.id = m.product_id
             JOIN users u ON u.id = m.created_by
            WHERE m.warehouse_id IN (${list}) AND m.doc_date BETWEEN ? AND ?
            ORDER BY m.doc_date, m.id`,
        )
        .all(scope.from, scope.to) as Array<Record<string, any>>;
      rows = data.map((r) => [
        r.doc_date,
        r.doc_number,
        r.doc_type,
        r.warehouse,
        r.product,
        r.direction,
        num(r.qty_base),
        r.base_unit,
        r.full_name,
      ]);
    }

    db.transaction(() => {
      writeAudit(db, {
        actor,
        action: 'EXPORT',
        module: 'reports',
        entityType: 'export',
        entityId: kind,
        entityLabel: `${kind} ${scope.from}..${scope.to}`,
        changes: [{ field: 'rows', before: null, after: rows.length }],
      });
    })();

    const csv = [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="resinvest-${kind}-${scope.from}_${scope.to}.csv"`);
    // BOM zapewnia poprawne otwarcie pliku w Microsoft Excel.
    const BOM = '﻿';
    res.send(`${BOM}${csv}`);
  }),
);

function num(value: number): string {
  // Przecinek dziesietny - zgodnie z polskim ustawieniem regionalnym Excela.
  return String(Math.round(value * 10000) / 10000).replace('.', ',');
}

function csvCell(value: string): string {
  const v = value ?? '';
  return /[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

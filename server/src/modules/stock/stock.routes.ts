import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { requireCtx } from '../../core/context.js';
import { asyncHandler } from '../../middleware/async.js';
import { requirePermission, assertWarehouseAccess } from '../../middleware/auth.js';
import { parseQuery } from '../../middleware/validate.js';
import { isIsoDate, todayIsoDate } from '../../core/time.js';
import { deriveQuantities, roundQty, type BaseUnit } from '../../core/units.js';
import { toPln } from '../../core/money.js';
import { getConversionRates, getSetting } from '../settings/settings.service.js';
import { verifyStockIntegrity } from '../documents/stock.engine.js';

export const stockRouter = Router();

/** Aktualne stany magazynowe z przeliczeniem na m3 / MP / t. */
stockRouter.get(
  '/',
  requirePermission('stock.view'),
  asyncHandler((req, res) => {
    const { user } = requireCtx(req);
    const { warehouseId, includeZero, search } = parseQuery(
      req,
      z.object({
        warehouseId: z.coerce.number().int().positive().optional(),
        includeZero: z.coerce.boolean().default(false),
        search: z.string().max(120).optional(),
      }),
    );

    const db = getDb();
    const scope = warehouseId
      ? [assertWarehouseAccess(user.warehouseIds, warehouseId)]
      : user.warehouseIds;
    if (scope.length === 0) {
      res.json({ items: [], totals: { qtyM3: 0, qtyMp: 0, qtyT: 0 } });
      return;
    }

    const params: Record<string, unknown> = {};
    const where = [`s.warehouse_id IN (${scope.join(',')})`];
    if (!includeZero) where.push('ABS(s.qty_base) > 0.0001');
    if (search) {
      where.push('(p.name LIKE @search OR p.code LIKE @search)');
      params.search = `%${search}%`;
    }

    const rows = db
      .prepare(
        `SELECT s.warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name,
                s.product_id, p.code AS product_code, p.name AS product_name,
                p.base_unit, p.m3_per_mp, p.t_per_mp, s.qty_base, s.updated_at
           FROM stock s
           JOIN warehouses w ON w.id = s.warehouse_id
           JOIN products   p ON p.id = s.product_id
          WHERE ${where.join(' AND ')}
          ORDER BY w.name, p.name`,
      )
      .all(params) as Array<{
      warehouse_id: number;
      warehouse_code: string;
      warehouse_name: string;
      product_id: number;
      product_code: string;
      product_name: string;
      base_unit: BaseUnit;
      m3_per_mp: number | null;
      t_per_mp: number | null;
      qty_base: number;
      updated_at: string;
    }>;

    const global = getConversionRates(db);
    const policy = getSetting(db, 'stockPolicy');

    const items = rows.map((r) => {
      const rates = { m3PerMp: r.m3_per_mp ?? global.m3PerMp, tPerMp: r.t_per_mp ?? global.tPerMp };
      const derived = deriveQuantities(r.qty_base, r.base_unit, rates);
      return {
        warehouseId: r.warehouse_id,
        warehouseCode: r.warehouse_code,
        warehouseName: r.warehouse_name,
        productId: r.product_id,
        productCode: r.product_code,
        productName: r.product_name,
        baseUnit: r.base_unit,
        qtyBase: roundQty(r.qty_base),
        qtyM3: derived.m3,
        qtyMp: derived.mp,
        qtyT: derived.t,
        isLow: r.qty_base > 0 && r.qty_base <= policy.lowStockThreshold,
        isNegative: r.qty_base < 0,
        updatedAt: r.updated_at,
      };
    });

    res.json({
      items,
      totals: {
        qtyM3: roundQty(items.reduce((s, i) => s + i.qtyM3, 0)),
        qtyMp: roundQty(items.reduce((s, i) => s + i.qtyMp, 0)),
        qtyT: roundQty(items.reduce((s, i) => s + i.qtyT, 0)),
      },
    });
  }),
);

/** Kartoteka ruchow magazynowych z saldem narastajaco. */
stockRouter.get(
  '/movements',
  requirePermission('stock.view'),
  asyncHandler((req, res) => {
    const { user } = requireCtx(req);
    const query = parseQuery(
      req,
      z.object({
        warehouseId: z.coerce.number().int().positive().optional(),
        productId: z.coerce.number().int().positive().optional(),
        dateFrom: z.string().refine(isIsoDate).optional(),
        dateTo: z.string().refine(isIsoDate).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(500).default(50),
      }),
    );

    const db = getDb();
    const scope = query.warehouseId
      ? [assertWarehouseAccess(user.warehouseIds, query.warehouseId)]
      : user.warehouseIds;
    if (scope.length === 0) {
      res.json({ items: [], total: 0, page: query.page, pageSize: query.pageSize });
      return;
    }

    const where = [`m.warehouse_id IN (${scope.join(',')})`];
    const params: Record<string, unknown> = {};
    if (query.productId) {
      where.push('m.product_id = @productId');
      params.productId = query.productId;
    }
    if (query.dateFrom) {
      where.push('m.doc_date >= @dateFrom');
      params.dateFrom = query.dateFrom;
    }
    if (query.dateTo) {
      where.push('m.doc_date <= @dateTo');
      params.dateTo = query.dateTo;
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const total = (
      db.prepare(`SELECT COUNT(*) AS c FROM stock_movements m ${whereSql}`).get(params) as { c: number }
    ).c;

    const rows = db
      .prepare(
        `SELECT m.id, m.doc_date, m.direction, m.qty_base, m.base_unit, m.reason,
                m.created_at, u.full_name AS user_name,
                w.name AS warehouse_name, p.code AS product_code, p.name AS product_name,
                d.id AS document_id, d.doc_number, d.doc_type, d.status
           FROM stock_movements m
           JOIN warehouses w ON w.id = m.warehouse_id
           JOIN products   p ON p.id = m.product_id
           JOIN documents  d ON d.id = m.document_id
           JOIN users      u ON u.id = m.created_by
           ${whereSql}
          ORDER BY m.doc_date DESC, m.id DESC
          LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit: query.pageSize, offset: (query.page - 1) * query.pageSize }) as Array<
      Record<string, any>
    >;

    res.json({
      items: rows.map((r) => ({
        id: r.id,
        docDate: r.doc_date,
        direction: r.direction,
        qtyBase: roundQty(r.qty_base),
        baseUnit: r.base_unit,
        reason: r.reason,
        createdAt: r.created_at,
        userName: r.user_name,
        warehouseName: r.warehouse_name,
        productCode: r.product_code,
        productName: r.product_name,
        documentId: r.document_id,
        docNumber: r.doc_number,
        docType: r.doc_type,
        docStatus: r.status,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    });
  }),
);

/** Dane pulpitu - wylacznie wartosci wyliczone z bazy. */
stockRouter.get(
  '/dashboard',
  requirePermission('stock.view'),
  asyncHandler((req, res) => {
    const { user } = requireCtx(req);
    const { warehouseId, month } = parseQuery(
      req,
      z.object({
        warehouseId: z.coerce.number().int().positive().optional(),
        month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      }),
    );

    const db = getDb();
    const scope = warehouseId
      ? [assertWarehouseAccess(user.warehouseIds, warehouseId)]
      : user.warehouseIds;

    const emptyResponse = {
      stock: [],
      period: { month: month ?? todayIsoDate().slice(0, 7), from: '', to: '' },
      operations: [],
      recentDocuments: [],
      alerts: [],
    };
    if (scope.length === 0) {
      res.json(emptyResponse);
      return;
    }

    const period = month ?? todayIsoDate().slice(0, 7);
    const from = `${period}-01`;
    const to = `${period}-31`;
    const list = scope.join(',');

    const global = getConversionRates(db);
    const stockRows = db
      .prepare(
        `SELECT p.id, p.code, p.name, p.base_unit, p.kind, p.m3_per_mp, p.t_per_mp,
                SUM(s.qty_base) AS qty
           FROM stock s JOIN products p ON p.id = s.product_id
          WHERE s.warehouse_id IN (${list})
          GROUP BY p.id
         HAVING ABS(SUM(s.qty_base)) > 0.0001
          ORDER BY p.name`,
      )
      .all() as Array<{
      id: number;
      code: string;
      name: string;
      base_unit: BaseUnit;
      kind: string;
      m3_per_mp: number | null;
      t_per_mp: number | null;
      qty: number;
    }>;

    const stock = stockRows.map((r) => {
      const rates = { m3PerMp: r.m3_per_mp ?? global.m3PerMp, tPerMp: r.t_per_mp ?? global.tPerMp };
      const derived = deriveQuantities(r.qty, r.base_unit, rates);
      return {
        productId: r.id,
        productCode: r.code,
        productName: r.name,
        kind: r.kind,
        baseUnit: r.base_unit,
        qtyBase: roundQty(r.qty),
        qtyM3: derived.m3,
        qtyMp: derived.mp,
        qtyT: derived.t,
      };
    });

    const operations = db
      .prepare(
        `SELECT d.doc_type,
                COUNT(*) AS count,
                COALESCE(SUM(d.total_value_gr), 0) AS value_gr,
                COALESCE(SUM(
                  (SELECT COALESCE(SUM(dl.qty_base), 0) FROM document_lines dl
                    WHERE dl.document_id = d.id AND dl.line_role <> 'INPUT')
                ), 0) AS qty
           FROM documents d
          WHERE d.status = 'POSTED'
            AND d.doc_date BETWEEN ? AND ?
            AND (d.warehouse_id IN (${list}) OR d.warehouse_from_id IN (${list}) OR d.warehouse_to_id IN (${list})
                 OR (d.warehouse_id IS NULL AND d.warehouse_from_id IS NULL AND d.warehouse_to_id IS NULL))
          GROUP BY d.doc_type`,
      )
      .all(from, to) as Array<{ doc_type: string; count: number; value_gr: number; qty: number }>;

    const recentDocuments = db
      .prepare(
        `SELECT d.id, d.doc_type, d.doc_number, d.doc_date, d.status, d.total_value_gr,
                u.full_name AS created_by,
                COALESCE(pc.name, ps.name) AS partner_name
           FROM documents d
           LEFT JOIN partners ps ON ps.id = d.supplier_id
           LEFT JOIN partners pc ON pc.id = d.customer_id
           JOIN users u ON u.id = d.created_by
          WHERE d.warehouse_id IN (${list}) OR d.warehouse_from_id IN (${list}) OR d.warehouse_to_id IN (${list})
             OR (d.warehouse_id IS NULL AND d.warehouse_from_id IS NULL AND d.warehouse_to_id IS NULL)
          ORDER BY d.created_at DESC
          LIMIT 12`,
      )
      .all() as Array<Record<string, any>>;

    const policy = getSetting(db, 'stockPolicy');
    const alerts: Array<{ level: 'warning' | 'error' | 'info'; code: string; message: string; count?: number }> = [];

    const negative = db
      .prepare(
        `SELECT COUNT(*) AS c FROM stock WHERE warehouse_id IN (${list}) AND qty_base < -0.0001`,
      )
      .get() as { c: number };
    if (negative.c > 0) {
      alerts.push({
        level: 'error',
        code: 'NEGATIVE_STOCK',
        message: 'Wykryto ujemny stan magazynowy.',
        count: negative.c,
      });
    }

    const lowStock = stock.filter((s) => s.qtyBase > 0 && s.qtyBase <= policy.lowStockThreshold);
    if (lowStock.length > 0) {
      alerts.push({
        level: 'warning',
        code: 'LOW_STOCK',
        message: 'Produkty ponizej progu ostrzegawczego.',
        count: lowStock.length,
      });
    }

    const drafts = db
      .prepare(
        `SELECT COUNT(*) AS c FROM documents
          WHERE status = 'DRAFT'
            AND (warehouse_id IN (${list}) OR warehouse_from_id IN (${list}) OR warehouse_to_id IN (${list})
                 OR (warehouse_id IS NULL AND warehouse_from_id IS NULL AND warehouse_to_id IS NULL))`,
      )
      .get() as { c: number };
    if (drafts.c > 0) {
      alerts.push({
        level: 'info',
        code: 'PENDING_DRAFTS',
        message: 'Dokumenty robocze oczekujace na zatwierdzenie.',
        count: drafts.c,
      });
    }

    res.json({
      stock,
      period: { month: period, from, to },
      operations: operations.map((o) => ({
        docType: o.doc_type,
        count: o.count,
        value: toPln(o.value_gr),
        qty: roundQty(o.qty),
      })),
      recentDocuments: recentDocuments.map((r) => ({
        id: r.id,
        docType: r.doc_type,
        docNumber: r.doc_number,
        docDate: r.doc_date,
        status: r.status,
        totalValue: toPln(r.total_value_gr),
        createdBy: r.created_by,
        partnerName: r.partner_name,
      })),
      alerts,
    });
  }),
);

/** Kontrola spojnosci sald z ksiega ruchow. */
stockRouter.get(
  '/integrity',
  requirePermission('admin.backup'),
  asyncHandler((_req, res) => {
    const mismatches = verifyStockIntegrity(getDb());
    res.json({ consistent: mismatches.length === 0, mismatches });
  }),
);

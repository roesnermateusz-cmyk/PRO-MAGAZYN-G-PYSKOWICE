import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { requireCtx } from '../../core/context.js';
import { asyncHandler } from '../../middleware/async.js';
import { requirePermission } from '../../middleware/auth.js';
import { parseBody, parseIdParam, parseQuery } from '../../middleware/validate.js';
import { conflict, notFound } from '../../core/errors.js';
import { nowIso } from '../../core/time.js';
import { diffFields, writeAudit } from '../../core/audit.js';
import { BASE_UNITS, type BaseUnit } from '../../core/units.js';

export const productsRouter = Router();

const productSchema = z.object({
  code: z.string().min(2).max(32).regex(/^[A-Za-z0-9_-]+$/, 'Kod może zawierać litery, cyfry, myslnik i podkreslenie.'),
  name: z.string().min(2).max(160),
  kind: z.enum(['RAW', 'FINISHED', 'GOODS', 'SERVICE']),
  baseUnit: z.enum(BASE_UNITS as unknown as [BaseUnit, ...BaseUnit[]]),
  /** Przeliczniki indywidualne; null = użyj globalnych z ustawien. */
  m3PerMp: z.number().positive().max(1000).nullable().default(null),
  tPerMp: z.number().positive().max(1000).nullable().default(null),
  isActive: z.boolean().default(true),
  notes: z.string().max(1000).default(''),
});

interface ProductRow {
  id: number;
  code: string;
  name: string;
  kind: string;
  base_unit: BaseUnit;
  m3_per_mp: number | null;
  t_per_mp: number | null;
  is_active: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

function toDto(row: ProductRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    baseUnit: row.base_unit,
    m3PerMp: row.m3_per_mp,
    tPerMp: row.t_per_mp,
    isActive: row.is_active === 1,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

productsRouter.get(
  '/',
  asyncHandler((req, res) => {
    const { includeInactive, search, kind } = parseQuery(
      req,
      z.object({
        includeInactive: z.coerce.boolean().default(false),
        search: z.string().max(120).optional(),
        kind: z.enum(['RAW', 'FINISHED', 'GOODS', 'SERVICE']).optional(),
      }),
    );
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (!includeInactive) where.push('is_active = 1');
    if (search) {
      where.push('(name LIKE @search OR code LIKE @search)');
      params.search = `%${search}%`;
    }
    if (kind) {
      where.push('kind = @kind');
      params.kind = kind;
    }
    const sql = `SELECT * FROM products ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY name`;
    const rows = getDb().prepare(sql).all(params) as ProductRow[];
    res.json({ items: rows.map(toDto) });
  }),
);

productsRouter.post(
  '/',
  requirePermission('admin.products'),
  asyncHandler((req, res) => {
    const { actor } = requireCtx(req);
    const input = parseBody(req, productSchema);
    const db = getDb();

    const id = db.transaction(() => {
      if (db.prepare('SELECT id FROM products WHERE code = ?').get(input.code)) {
        throw conflict(`Produkt o kodzie "${input.code}" już istnieje.`, 'DUPLICATE');
      }
      const stamp = nowIso();
      const result = db
        .prepare(
          `INSERT INTO products (code, name, kind, base_unit, m3_per_mp, t_per_mp, is_active, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.code.toUpperCase(),
          input.name,
          input.kind,
          input.baseUnit,
          input.m3PerMp,
          input.tPerMp,
          input.isActive ? 1 : 0,
          input.notes,
          stamp,
          stamp,
        );
      const newId = Number(result.lastInsertRowid);
      writeAudit(db, {
        actor,
        action: 'CREATE',
        module: 'products',
        entityType: 'product',
        entityId: newId,
        entityLabel: input.name,
        changes: [
          { field: 'code', before: null, after: input.code.toUpperCase() },
          { field: 'baseUnit', before: null, after: input.baseUnit },
        ],
      });
      return newId;
    }).immediate();

    res.status(201).json(toDto(db.prepare('SELECT * FROM products WHERE id = ?').get(id) as ProductRow));
  }),
);

productsRouter.put(
  '/:id',
  requirePermission('admin.products'),
  asyncHandler((req, res) => {
    const { actor } = requireCtx(req);
    const id = parseIdParam(req);
    const input = parseBody(req, productSchema);
    const db = getDb();

    db.transaction(() => {
      const before = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as ProductRow | undefined;
      if (!before) throw notFound('Nie znaleziono produktu.');
      if (db.prepare('SELECT id FROM products WHERE code = ? AND id <> ?').get(input.code, id)) {
        throw conflict(`Produkt o kodzie "${input.code}" już istnieje.`, 'DUPLICATE');
      }

      // Zmiana jednostki bazowej po wystąpieniu ruchow zafałszowałaby stan.
      if (before.base_unit !== input.baseUnit) {
        const used = db.prepare('SELECT COUNT(*) AS c FROM stock_movements WHERE product_id = ?').get(id) as {
          c: number;
        };
        if (used.c > 0) {
          throw conflict(
            'Nie można zmienić jednostki bazowej produktu, dla którego istnieja ruchy magazynowe. Utworz nowy produkt.',
            'IN_USE',
          );
        }
      }

      db.prepare(
        `UPDATE products SET code = ?, name = ?, kind = ?, base_unit = ?, m3_per_mp = ?, t_per_mp = ?,
                             is_active = ?, notes = ?, updated_at = ?
          WHERE id = ?`,
      ).run(
        input.code.toUpperCase(),
        input.name,
        input.kind,
        input.baseUnit,
        input.m3PerMp,
        input.tPerMp,
        input.isActive ? 1 : 0,
        input.notes,
        nowIso(),
        id,
      );

      writeAudit(db, {
        actor,
        action: 'UPDATE',
        module: 'products',
        entityType: 'product',
        entityId: id,
        entityLabel: input.name,
        changes: diffFields(
          {
            code: before.code,
            name: before.name,
            kind: before.kind,
            baseUnit: before.base_unit,
            m3PerMp: before.m3_per_mp,
            tPerMp: before.t_per_mp,
            isActive: before.is_active === 1,
            notes: before.notes,
          },
          { ...input, code: input.code.toUpperCase() },
        ),
      });
    }).immediate();

    res.json(toDto(db.prepare('SELECT * FROM products WHERE id = ?').get(id) as ProductRow));
  }),
);

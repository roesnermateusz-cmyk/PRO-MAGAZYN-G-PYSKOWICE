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

export const warehousesRouter = Router();

const warehouseSchema = z.object({
  code: z.string().min(2).max(16).regex(/^[A-Za-z0-9_-]+$/, 'Kod może zawierać litery, cyfry, myslnik i podkreslenie.'),
  name: z.string().min(2).max(120),
  address: z.string().max(200).default(''),
  postalCode: z.string().max(20).default(''),
  city: z.string().max(100).default(''),
  notes: z.string().max(1000).default(''),
  isActive: z.boolean().default(true),
});

interface WarehouseRow {
  id: number;
  code: string;
  name: string;
  address: string;
  postal_code: string;
  city: string;
  notes: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

function toDto(row: WarehouseRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    address: row.address,
    postalCode: row.postal_code,
    city: row.city,
    notes: row.notes,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Lista magazynów dostępnych dla zalogowanego użytkownika. */
warehousesRouter.get(
  '/',
  asyncHandler((req, res) => {
    const { user } = requireCtx(req);
    const { all } = parseQuery(req, z.object({ all: z.coerce.boolean().default(false) }));
    const db = getDb();

    const includeAll = all && user.permissions.has('admin.warehouses');
    const rows = includeAll
      ? (db.prepare('SELECT * FROM warehouses ORDER BY name').all() as WarehouseRow[])
      : user.warehouseIds.length === 0
        ? []
        : (db
            .prepare(
              `SELECT * FROM warehouses WHERE id IN (${user.warehouseIds.map(() => '?').join(',')}) ORDER BY name`,
            )
            .all(...user.warehouseIds) as WarehouseRow[]);

    res.json({ items: rows.map(toDto) });
  }),
);

warehousesRouter.post(
  '/',
  requirePermission('admin.warehouses'),
  asyncHandler((req, res) => {
    const { actor } = requireCtx(req);
    const input = parseBody(req, warehouseSchema);
    const db = getDb();

    const created = db.transaction(() => {
      const exists = db.prepare('SELECT id FROM warehouses WHERE code = ?').get(input.code);
      if (exists) throw conflict(`Magazyn o kodzie "${input.code}" już istnieje.`, 'DUPLICATE');

      const stamp = nowIso();
      const result = db
        .prepare(
          `INSERT INTO warehouses (code, name, address, postal_code, city, notes, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.code.toUpperCase(),
          input.name,
          input.address,
          input.postalCode,
          input.city,
          input.notes,
          input.isActive ? 1 : 0,
          stamp,
          stamp,
        );
      const id = Number(result.lastInsertRowid);
      writeAudit(db, {
        actor,
        action: 'CREATE',
        module: 'warehouses',
        entityType: 'warehouse',
        entityId: id,
        entityLabel: input.name,
        warehouseId: id,
        changes: [{ field: 'code', before: null, after: input.code.toUpperCase() }],
      });
      return id;
    }).immediate();

    const row = db.prepare('SELECT * FROM warehouses WHERE id = ?').get(created) as WarehouseRow;
    res.status(201).json(toDto(row));
  }),
);

warehousesRouter.put(
  '/:id',
  requirePermission('admin.warehouses'),
  asyncHandler((req, res) => {
    const { actor } = requireCtx(req);
    const id = parseIdParam(req);
    const input = parseBody(req, warehouseSchema);
    const db = getDb();

    db.transaction(() => {
      const before = db.prepare('SELECT * FROM warehouses WHERE id = ?').get(id) as WarehouseRow | undefined;
      if (!before) throw notFound('Nie znaleziono magazynu.');

      const duplicate = db.prepare('SELECT id FROM warehouses WHERE code = ? AND id <> ?').get(input.code, id);
      if (duplicate) throw conflict(`Magazyn o kodzie "${input.code}" już istnieje.`, 'DUPLICATE');

      // Magazyn z powiązanymi dokumentami nie jest usuwany fizycznie -
      // dezaktywacja zachowuje pełna historie operacji.
      db.prepare(
        `UPDATE warehouses SET code = ?, name = ?, address = ?, postal_code = ?, city = ?,
                               notes = ?, is_active = ?, updated_at = ?
          WHERE id = ?`,
      ).run(
        input.code.toUpperCase(),
        input.name,
        input.address,
        input.postalCode,
        input.city,
        input.notes,
        input.isActive ? 1 : 0,
        nowIso(),
        id,
      );

      writeAudit(db, {
        actor,
        action: 'UPDATE',
        module: 'warehouses',
        entityType: 'warehouse',
        entityId: id,
        entityLabel: input.name,
        warehouseId: id,
        changes: diffFields(
          {
            code: before.code,
            name: before.name,
            address: before.address,
            postalCode: before.postal_code,
            city: before.city,
            notes: before.notes,
            isActive: before.is_active === 1,
          },
          { ...input, code: input.code.toUpperCase() },
        ),
      });
    }).immediate();

    const row = db.prepare('SELECT * FROM warehouses WHERE id = ?').get(id) as WarehouseRow;
    res.json(toDto(row));
  }),
);

/** Podsumowanie powiazan - informuje, dlaczego magazynu nie można usunąć. */
warehousesRouter.get(
  '/:id/usage',
  requirePermission('admin.warehouses'),
  asyncHandler((req, res) => {
    const id = parseIdParam(req);
    const db = getDb();
    const documents = db
      .prepare(
        `SELECT COUNT(*) AS c FROM documents
          WHERE warehouse_id = ? OR warehouse_from_id = ? OR warehouse_to_id = ?`,
      )
      .get(id, id, id) as { c: number };
    const movements = db
      .prepare('SELECT COUNT(*) AS c FROM stock_movements WHERE warehouse_id = ?')
      .get(id) as { c: number };
    const users = db
      .prepare('SELECT COUNT(*) AS c FROM user_warehouses WHERE warehouse_id = ?')
      .get(id) as { c: number };
    res.json({ documents: documents.c, movements: movements.c, users: users.c });
  }),
);

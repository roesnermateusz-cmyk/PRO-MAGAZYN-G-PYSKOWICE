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

export const partnersRouter = Router();

const partnerSchema = z.object({
  code: z.string().min(2).max(32).regex(/^[A-Za-z0-9_-]+$/, 'Kod moze zawierac litery, cyfry, myslnik i podkreslenie.'),
  name: z.string().min(2).max(200),
  taxId: z.string().max(40).default(''),
  address: z.string().max(200).default(''),
  postalCode: z.string().max(20).default(''),
  city: z.string().max(100).default(''),
  country: z.string().max(3).default('PL'),
  phone: z.string().max(50).default(''),
  email: z.string().max(120).default(''),
  isSupplier: z.boolean().default(false),
  isCustomer: z.boolean().default(false),
  isCarrier: z.boolean().default(false),
  /** Nadlesnictwo - wlacza w formularzu PZ pola kwitu wywozowego. */
  isForestry: z.boolean().default(false),
  isActive: z.boolean().default(true),
  notes: z.string().max(1000).default(''),
});

interface PartnerRow {
  id: number;
  code: string;
  name: string;
  tax_id: string;
  address: string;
  postal_code: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  is_supplier: number;
  is_customer: number;
  is_carrier: number;
  is_forestry: number;
  is_active: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

function toDto(row: PartnerRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    taxId: row.tax_id,
    address: row.address,
    postalCode: row.postal_code,
    city: row.city,
    country: row.country,
    phone: row.phone,
    email: row.email,
    isSupplier: row.is_supplier === 1,
    isCustomer: row.is_customer === 1,
    isCarrier: row.is_carrier === 1,
    isForestry: row.is_forestry === 1,
    isActive: row.is_active === 1,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

partnersRouter.get(
  '/',
  asyncHandler((req, res) => {
    const { role, search, includeInactive } = parseQuery(
      req,
      z.object({
        role: z.enum(['supplier', 'customer', 'carrier', 'forestry']).optional(),
        search: z.string().max(120).optional(),
        includeInactive: z.coerce.boolean().default(false),
      }),
    );

    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (!includeInactive) where.push('is_active = 1');
    if (role) {
      const column = {
        supplier: 'is_supplier',
        customer: 'is_customer',
        carrier: 'is_carrier',
        forestry: 'is_forestry',
      }[role];
      where.push(`${column} = 1`);
    }
    if (search) {
      where.push('(name LIKE @search OR code LIKE @search OR tax_id LIKE @search)');
      params.search = `%${search}%`;
    }

    const rows = getDb()
      .prepare(`SELECT * FROM partners ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY name`)
      .all(params) as PartnerRow[];
    res.json({ items: rows.map(toDto) });
  }),
);

partnersRouter.post(
  '/',
  requirePermission('admin.partners'),
  asyncHandler((req, res) => {
    const { actor } = requireCtx(req);
    const input = parseBody(req, partnerSchema);
    const db = getDb();

    const id = db.transaction(() => {
      if (db.prepare('SELECT id FROM partners WHERE code = ?').get(input.code)) {
        throw conflict(`Kontrahent o kodzie "${input.code}" juz istnieje.`, 'DUPLICATE');
      }
      const stamp = nowIso();
      const result = db
        .prepare(
          `INSERT INTO partners
             (code, name, tax_id, address, postal_code, city, country, phone, email,
              is_supplier, is_customer, is_carrier, is_forestry, is_active, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.code.toUpperCase(),
          input.name,
          input.taxId,
          input.address,
          input.postalCode,
          input.city,
          input.country.toUpperCase(),
          input.phone,
          input.email,
          input.isSupplier ? 1 : 0,
          input.isCustomer ? 1 : 0,
          input.isCarrier ? 1 : 0,
          input.isForestry ? 1 : 0,
          input.isActive ? 1 : 0,
          input.notes,
          stamp,
          stamp,
        );
      const newId = Number(result.lastInsertRowid);
      writeAudit(db, {
        actor,
        action: 'CREATE',
        module: 'partners',
        entityType: 'partner',
        entityId: newId,
        entityLabel: input.name,
        changes: [{ field: 'code', before: null, after: input.code.toUpperCase() }],
      });
      return newId;
    }).immediate();

    res.status(201).json(toDto(db.prepare('SELECT * FROM partners WHERE id = ?').get(id) as PartnerRow));
  }),
);

partnersRouter.put(
  '/:id',
  requirePermission('admin.partners'),
  asyncHandler((req, res) => {
    const { actor } = requireCtx(req);
    const id = parseIdParam(req);
    const input = parseBody(req, partnerSchema);
    const db = getDb();

    db.transaction(() => {
      const before = db.prepare('SELECT * FROM partners WHERE id = ?').get(id) as PartnerRow | undefined;
      if (!before) throw notFound('Nie znaleziono kontrahenta.');
      if (db.prepare('SELECT id FROM partners WHERE code = ? AND id <> ?').get(input.code, id)) {
        throw conflict(`Kontrahent o kodzie "${input.code}" juz istnieje.`, 'DUPLICATE');
      }

      db.prepare(
        `UPDATE partners SET code = ?, name = ?, tax_id = ?, address = ?, postal_code = ?, city = ?,
                             country = ?, phone = ?, email = ?, is_supplier = ?, is_customer = ?,
                             is_carrier = ?, is_forestry = ?, is_active = ?, notes = ?, updated_at = ?
          WHERE id = ?`,
      ).run(
        input.code.toUpperCase(),
        input.name,
        input.taxId,
        input.address,
        input.postalCode,
        input.city,
        input.country.toUpperCase(),
        input.phone,
        input.email,
        input.isSupplier ? 1 : 0,
        input.isCustomer ? 1 : 0,
        input.isCarrier ? 1 : 0,
        input.isForestry ? 1 : 0,
        input.isActive ? 1 : 0,
        input.notes,
        nowIso(),
        id,
      );

      writeAudit(db, {
        actor,
        action: 'UPDATE',
        module: 'partners',
        entityType: 'partner',
        entityId: id,
        entityLabel: input.name,
        changes: diffFields(
          {
            code: before.code,
            name: before.name,
            taxId: before.tax_id,
            address: before.address,
            postalCode: before.postal_code,
            city: before.city,
            country: before.country,
            phone: before.phone,
            email: before.email,
            isSupplier: before.is_supplier === 1,
            isCustomer: before.is_customer === 1,
            isCarrier: before.is_carrier === 1,
            isForestry: before.is_forestry === 1,
            isActive: before.is_active === 1,
            notes: before.notes,
          },
          { ...input, code: input.code.toUpperCase(), country: input.country.toUpperCase() },
        ),
      });
    }).immediate();

    res.json(toDto(db.prepare('SELECT * FROM partners WHERE id = ?').get(id) as PartnerRow));
  }),
);

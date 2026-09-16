import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { asyncHandler } from '../../middleware/async.js';
import { requirePermission } from '../../middleware/auth.js';
import { parseQuery } from '../../middleware/validate.js';
import { isIsoDate } from '../../core/time.js';

export const auditRouter = Router();

const querySchema = z.object({
  module: z.string().max(40).optional(),
  action: z.string().max(40).optional(),
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(64).optional(),
  userId: z.coerce.number().int().positive().optional(),
  warehouseId: z.coerce.number().int().positive().optional(),
  dateFrom: z.string().refine(isIsoDate).optional(),
  dateTo: z.string().refine(isIsoDate).optional(),
  search: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

auditRouter.get(
  '/',
  requirePermission('audit.view'),
  asyncHandler((req, res) => {
    const q = parseQuery(req, querySchema);
    const db = getDb();

    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (q.module) {
      where.push('module = @module');
      params.module = q.module;
    }
    if (q.action) {
      where.push('action = @action');
      params.action = q.action;
    }
    if (q.entityType) {
      where.push('entity_type = @entityType');
      params.entityType = q.entityType;
    }
    if (q.entityId) {
      where.push('entity_id = @entityId');
      params.entityId = q.entityId;
    }
    if (q.userId) {
      where.push('user_id = @userId');
      params.userId = q.userId;
    }
    if (q.warehouseId) {
      where.push('warehouse_id = @warehouseId');
      params.warehouseId = q.warehouseId;
    }
    if (q.dateFrom) {
      where.push('occurred_at >= @dateFrom');
      params.dateFrom = `${q.dateFrom}T00:00:00.000Z`;
    }
    if (q.dateTo) {
      where.push('occurred_at <= @dateTo');
      params.dateTo = `${q.dateTo}T23:59:59.999Z`;
    }
    if (q.search) {
      where.push('(entity_label LIKE @search OR user_name LIKE @search OR user_login LIKE @search OR changes_json LIKE @search)');
      params.search = `%${q.search}%`;
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const total = (db.prepare(`SELECT COUNT(*) AS c FROM audit_logs ${whereSql}`).get(params) as { c: number }).c;

    const rows = db
      .prepare(
        `SELECT id, occurred_at, user_id, user_login, user_name, action, module,
                entity_type, entity_id, entity_label, warehouse_id, changes_json, ip
           FROM audit_logs ${whereSql}
          ORDER BY occurred_at DESC, id DESC
          LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit: q.pageSize, offset: (q.page - 1) * q.pageSize }) as Array<Record<string, any>>;

    res.json({
      items: rows.map((r) => ({
        id: r.id,
        occurredAt: r.occurred_at,
        userId: r.user_id,
        userLogin: r.user_login,
        userName: r.user_name,
        action: r.action,
        module: r.module,
        entityType: r.entity_type,
        entityId: r.entity_id,
        entityLabel: r.entity_label,
        warehouseId: r.warehouse_id,
        ip: r.ip,
        changes: safeParse(r.changes_json),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    });
  }),
);

/** Slowniki do filtrow historii zmian. */
auditRouter.get(
  '/facets',
  requirePermission('audit.view'),
  asyncHandler((_req, res) => {
    const db = getDb();
    res.json({
      modules: (db.prepare('SELECT DISTINCT module FROM audit_logs ORDER BY module').all() as Array<{ module: string }>).map(
        (r) => r.module,
      ),
      actions: (db.prepare('SELECT DISTINCT action FROM audit_logs ORDER BY action').all() as Array<{ action: string }>).map(
        (r) => r.action,
      ),
      users: db
        .prepare('SELECT DISTINCT user_id AS id, user_name AS name FROM audit_logs WHERE user_id IS NOT NULL ORDER BY user_name')
        .all() as Array<{ id: number; name: string }>,
    });
  }),
);

function safeParse(json: string): Array<{ field: string; before: unknown; after: unknown }> {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

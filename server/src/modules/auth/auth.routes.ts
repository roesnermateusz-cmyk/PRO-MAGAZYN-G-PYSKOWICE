import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { asyncHandler } from '../../middleware/async.js';
import { authenticate } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { parseBody } from '../../middleware/validate.js';
import { clientIp, requireCtx, userAgent } from '../../core/context.js';
import { badRequest, forbidden } from '../../core/errors.js';
import { nowIso } from '../../core/time.js';
import { writeAudit } from '../../core/audit.js';
import { ALL_PERMISSIONS } from '../../core/permissions.js';
import {
  changeOwnPassword,
  findUserById,
  login as loginService,
  logout as logoutService,
  refresh as refreshService,
  toAuthUser,
} from './auth.service.js';

export const authRouter = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, max: 30, keyPrefix: 'login' });
const refreshLimiter = rateLimit({ windowMs: 15 * 60_000, max: 120, keyPrefix: 'refresh' });

function sessionPayload(db: ReturnType<typeof getDb>, userId: number) {
  const row = findUserById(db, userId);
  if (!row) throw forbidden('Konto nie istnieje.');
  const user = toAuthUser(db, row);
  const warehouses =
    user.warehouseIds.length === 0
      ? []
      : (db
          .prepare(
            `SELECT id, code, name, city FROM warehouses
              WHERE id IN (${user.warehouseIds.map(() => '?').join(',')}) AND is_active = 1
              ORDER BY name`,
          )
          .all(...user.warehouseIds) as Array<{ id: number; code: string; name: string; city: string }>);

  return {
    user: {
      id: user.id,
      login: user.login,
      fullName: user.fullName,
      email: row.email ?? '',
      roleCode: user.roleCode,
      roleName: user.roleName,
      locale: row.locale,
      theme: row.theme,
      mustChangePassword: row.must_change_password === 1,
      defaultWarehouseId: row.default_warehouse_id,
      permissions: [...user.permissions],
      isAdmin: user.isAdmin,
    },
    warehouses,
  };
}

authRouter.post(
  '/login',
  loginLimiter,
  asyncHandler((req, res) => {
    const { login, password } = parseBody(
      req,
      z.object({ login: z.string().min(1).max(40), password: z.string().min(1).max(200) }),
    );
    const db = getDb();
    const result = loginService(db, login, password, { ip: clientIp(req), userAgent: userAgent(req) });
    res.json({ ...result.tokens, ...sessionPayload(db, result.user.id) });
  }),
);

authRouter.post(
  '/refresh',
  refreshLimiter,
  asyncHandler((req, res) => {
    const { refreshToken } = parseBody(req, z.object({ refreshToken: z.string().min(10).max(200) }));
    const db = getDb();
    const result = refreshService(db, refreshToken, { ip: clientIp(req), userAgent: userAgent(req) });
    res.json({ ...result.tokens, ...sessionPayload(db, result.user.id) });
  }),
);

authRouter.post(
  '/logout',
  authenticate,
  asyncHandler((req, res) => {
    const { actor } = requireCtx(req);
    const { refreshToken } = parseBody(
      req,
      z.object({ refreshToken: z.string().max(200).optional() }),
    );
    logoutService(getDb(), refreshToken, actor);
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler((req, res) => {
    const { user } = requireCtx(req);
    res.json({ ...sessionPayload(getDb(), user.id), permissionCatalog: ALL_PERMISSIONS });
  }),
);

authRouter.put(
  '/me/preferences',
  authenticate,
  asyncHandler((req, res) => {
    const { user } = requireCtx(req);
    const input = parseBody(
      req,
      z.object({
        locale: z.enum(['pl', 'cs', 'en']).optional(),
        theme: z.enum(['light', 'dark', 'system']).optional(),
        defaultWarehouseId: z.number().int().positive().nullable().optional(),
      }),
    );
    const db = getDb();

    if (input.defaultWarehouseId != null && !user.warehouseIds.includes(input.defaultWarehouseId)) {
      throw badRequest('Brak dostępu do wskazanego magazynu domyślnego.');
    }

    const fields: string[] = [];
    const params: unknown[] = [];
    if (input.locale) {
      fields.push('locale = ?');
      params.push(input.locale);
    }
    if (input.theme) {
      fields.push('theme = ?');
      params.push(input.theme);
    }
    if (input.defaultWarehouseId !== undefined) {
      fields.push('default_warehouse_id = ?');
      params.push(input.defaultWarehouseId);
    }
    if (fields.length > 0) {
      fields.push('updated_at = ?');
      params.push(nowIso(), user.id);
      db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    }

    res.json(sessionPayload(db, user.id));
  }),
);

authRouter.post(
  '/me/password',
  authenticate,
  asyncHandler((req, res) => {
    const { user, actor } = requireCtx(req);
    const { currentPassword, newPassword } = parseBody(
      req,
      z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(10).max(200) }),
    );
    changeOwnPassword(getDb(), user.id, currentPassword, newPassword, actor);
    res.json({ ok: true });
  }),
);

/** Rejestruje zmiane magazynu roboczego w historii zmian. */
authRouter.post(
  '/me/warehouse',
  authenticate,
  asyncHandler((req, res) => {
    const { user, actor } = requireCtx(req);
    const { warehouseId } = parseBody(req, z.object({ warehouseId: z.number().int().positive() }));
    if (!user.warehouseIds.includes(warehouseId)) {
      throw forbidden('Brak dostępu do wskazanego magazynu.', 'WAREHOUSE_FORBIDDEN');
    }
    const db = getDb();
    const warehouse = db.prepare('SELECT id, code, name FROM warehouses WHERE id = ? AND is_active = 1').get(
      warehouseId,
    ) as { id: number; code: string; name: string } | undefined;
    if (!warehouse) throw badRequest('Magazyn nie istnieje lub jest nieaktywny.');

    db.transaction(() => {
      writeAudit(db, {
        actor,
        action: 'WAREHOUSE_SWITCH',
        module: 'auth',
        entityType: 'warehouse',
        entityId: warehouse.id,
        entityLabel: warehouse.name,
        warehouseId: warehouse.id,
      });
    })();

    res.json({ warehouse });
  }),
);

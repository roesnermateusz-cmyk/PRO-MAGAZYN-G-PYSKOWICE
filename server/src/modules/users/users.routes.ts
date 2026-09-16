import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { requireCtx } from '../../core/context.js';
import { asyncHandler } from '../../middleware/async.js';
import { requirePermission } from '../../middleware/auth.js';
import { parseBody, parseIdParam } from '../../middleware/validate.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import { nowIso } from '../../core/time.js';
import { diffFields, writeAudit } from '../../core/audit.js';
import { hashPassword, validatePasswordStrength } from '../../core/password.js';
import { ALL_PERMISSIONS, PERMISSIONS, type Permission } from '../../core/permissions.js';
import { revokeAllSessions } from '../auth/auth.service.js';

export const usersRouter = Router();

const baseUserSchema = z.object({
  login: z.string().min(3).max(40).regex(/^[A-Za-z0-9._-]+$/, 'Login moze zawierac litery, cyfry, kropke, myslnik i podkreslenie.'),
  fullName: z.string().min(3).max(120),
  email: z.string().email().max(120).or(z.literal('')).default(''),
  roleId: z.number().int().positive(),
  isActive: z.boolean().default(true),
  locale: z.enum(['pl', 'cs', 'en']).default('pl'),
  warehouseIds: z.array(z.number().int().positive()).max(100).default([]),
  defaultWarehouseId: z.number().int().positive().nullable().default(null),
});

const createUserSchema = baseUserSchema.extend({
  password: z.string().min(10).max(200),
  mustChangePassword: z.boolean().default(true),
});

const updateUserSchema = baseUserSchema.extend({
  mustChangePassword: z.boolean().default(false),
});

interface UserListRow {
  id: number;
  login: string;
  full_name: string;
  email: string | null;
  role_id: number;
  role_code: string;
  role_name: string;
  is_active: number;
  must_change_password: number;
  locale: string;
  default_warehouse_id: number | null;
  last_login_at: string | null;
  created_at: string;
}

function warehousesOf(db: ReturnType<typeof getDb>, userId: number): number[] {
  return (
    db.prepare('SELECT warehouse_id FROM user_warehouses WHERE user_id = ?').all(userId) as Array<{
      warehouse_id: number;
    }>
  ).map((r) => r.warehouse_id);
}

function toDto(db: ReturnType<typeof getDb>, row: UserListRow) {
  return {
    id: row.id,
    login: row.login,
    fullName: row.full_name,
    email: row.email ?? '',
    roleId: row.role_id,
    roleCode: row.role_code,
    roleName: row.role_name,
    isActive: row.is_active === 1,
    mustChangePassword: row.must_change_password === 1,
    locale: row.locale,
    defaultWarehouseId: row.default_warehouse_id,
    warehouseIds: warehousesOf(db, row.id),
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  };
}

const USER_SELECT = `
  SELECT u.id, u.login, u.full_name, u.email, u.role_id, r.code AS role_code, r.name AS role_name,
         u.is_active, u.must_change_password, u.locale, u.default_warehouse_id, u.last_login_at, u.created_at
    FROM users u JOIN roles r ON r.id = u.role_id
`;

usersRouter.get(
  '/',
  requirePermission('admin.users'),
  asyncHandler((_req, res) => {
    const db = getDb();
    const rows = db.prepare(`${USER_SELECT} ORDER BY u.full_name`).all() as UserListRow[];
    res.json({ items: rows.map((r) => toDto(db, r)) });
  }),
);

usersRouter.get(
  '/roles',
  requirePermission('admin.users'),
  asyncHandler((_req, res) => {
    const db = getDb();
    const roles = db.prepare('SELECT id, code, name, description, is_system FROM roles ORDER BY id').all() as Array<{
      id: number;
      code: string;
      name: string;
      description: string;
      is_system: number;
    }>;
    res.json({
      items: roles.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        description: r.description,
        isSystem: r.is_system === 1,
        permissions: (
          db.prepare('SELECT permission_code FROM role_permissions WHERE role_id = ?').all(r.id) as Array<{
            permission_code: string;
          }>
        ).map((p) => p.permission_code),
      })),
      catalog: ALL_PERMISSIONS.map((code) => ({ code, description: PERMISSIONS[code] })),
    });
  }),
);

function assertWarehousesExist(db: ReturnType<typeof getDb>, ids: number[]): void {
  if (ids.length === 0) return;
  const found = db
    .prepare(`SELECT id FROM warehouses WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as Array<{ id: number }>;
  if (found.length !== new Set(ids).size) {
    throw badRequest('Lista magazynow zawiera nieistniejace pozycje.');
  }
}

usersRouter.post(
  '/',
  requirePermission('admin.users'),
  asyncHandler((req, res) => {
    const { actor } = requireCtx(req);
    const input = parseBody(req, createUserSchema);
    const db = getDb();

    const problem = validatePasswordStrength(input.password);
    if (problem) throw badRequest(problem);

    const id = db.transaction(() => {
      if (db.prepare('SELECT id FROM users WHERE login = ?').get(input.login)) {
        throw conflict(`Uzytkownik o loginie "${input.login}" juz istnieje.`, 'DUPLICATE');
      }
      if (!db.prepare('SELECT id FROM roles WHERE id = ?').get(input.roleId)) {
        throw badRequest('Wskazana rola nie istnieje.');
      }
      assertWarehousesExist(db, input.warehouseIds);
      if (input.defaultWarehouseId && !input.warehouseIds.includes(input.defaultWarehouseId)) {
        throw badRequest('Magazyn domyslny musi znajdowac sie na liscie przypisanych magazynow.');
      }

      const stamp = nowIso();
      const result = db
        .prepare(
          `INSERT INTO users (login, full_name, email, password_hash, role_id, is_active,
                              must_change_password, locale, default_warehouse_id, created_at, updated_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.login,
          input.fullName,
          input.email || null,
          hashPassword(input.password),
          input.roleId,
          input.isActive ? 1 : 0,
          input.mustChangePassword ? 1 : 0,
          input.locale,
          input.defaultWarehouseId,
          stamp,
          stamp,
          actor.id,
        );
      const newId = Number(result.lastInsertRowid);

      const grant = db.prepare(
        'INSERT INTO user_warehouses (user_id, warehouse_id, granted_at, granted_by) VALUES (?, ?, ?, ?)',
      );
      for (const whId of new Set(input.warehouseIds)) grant.run(newId, whId, stamp, actor.id);

      writeAudit(db, {
        actor,
        action: 'CREATE',
        module: 'users',
        entityType: 'user',
        entityId: newId,
        entityLabel: input.login,
        changes: [
          { field: 'login', before: null, after: input.login },
          { field: 'roleId', before: null, after: input.roleId },
          { field: 'warehouseIds', before: null, after: input.warehouseIds.join(',') },
        ],
      });
      return newId;
    }).immediate();

    res.status(201).json(toDto(db, db.prepare(`${USER_SELECT} WHERE u.id = ?`).get(id) as UserListRow));
  }),
);

usersRouter.put(
  '/:id',
  requirePermission('admin.users'),
  asyncHandler((req, res) => {
    const { actor, user } = requireCtx(req);
    const id = parseIdParam(req);
    const input = parseBody(req, updateUserSchema);
    const db = getDb();

    db.transaction(() => {
      const before = db.prepare(`${USER_SELECT} WHERE u.id = ?`).get(id) as UserListRow | undefined;
      if (!before) throw notFound('Nie znaleziono uzytkownika.');
      if (db.prepare('SELECT id FROM users WHERE login = ? AND id <> ?').get(input.login, id)) {
        throw conflict(`Uzytkownik o loginie "${input.login}" juz istnieje.`, 'DUPLICATE');
      }
      assertWarehousesExist(db, input.warehouseIds);
      if (input.defaultWarehouseId && !input.warehouseIds.includes(input.defaultWarehouseId)) {
        throw badRequest('Magazyn domyslny musi znajdowac sie na liscie przypisanych magazynow.');
      }

      // Zabezpieczenie przed odcieciem dostepu administracyjnego do systemu.
      if (before.role_code === 'ADMIN' && (!input.isActive || input.roleId !== before.role_id)) {
        const activeAdmins = db
          .prepare(
            `SELECT COUNT(*) AS c FROM users u JOIN roles r ON r.id = u.role_id
              WHERE r.code = 'ADMIN' AND u.is_active = 1 AND u.id <> ?`,
          )
          .get(id) as { c: number };
        if (activeAdmins.c === 0) {
          throw conflict('W systemie musi pozostac co najmniej jeden aktywny administrator.');
        }
      }
      if (id === user.id && !input.isActive) {
        throw badRequest('Nie mozna dezaktywowac wlasnego konta.');
      }

      const beforeWarehouses = warehousesOf(db, id);
      const stamp = nowIso();

      db.prepare(
        `UPDATE users SET login = ?, full_name = ?, email = ?, role_id = ?, is_active = ?,
                          must_change_password = ?, locale = ?, default_warehouse_id = ?, updated_at = ?
          WHERE id = ?`,
      ).run(
        input.login,
        input.fullName,
        input.email || null,
        input.roleId,
        input.isActive ? 1 : 0,
        input.mustChangePassword ? 1 : 0,
        input.locale,
        input.defaultWarehouseId,
        stamp,
        id,
      );

      db.prepare('DELETE FROM user_warehouses WHERE user_id = ?').run(id);
      const grant = db.prepare(
        'INSERT INTO user_warehouses (user_id, warehouse_id, granted_at, granted_by) VALUES (?, ?, ?, ?)',
      );
      for (const whId of new Set(input.warehouseIds)) grant.run(id, whId, stamp, actor.id);

      // Zmiana roli, statusu lub magazynow uniewaznia aktywne sesje.
      const securityRelevant =
        before.role_id !== input.roleId ||
        (before.is_active === 1) !== input.isActive ||
        beforeWarehouses.slice().sort().join(',') !== [...new Set(input.warehouseIds)].sort().join(',');
      if (securityRelevant) revokeAllSessions(db, id);

      writeAudit(db, {
        actor,
        action: securityRelevant ? 'PERMISSION_CHANGE' : 'UPDATE',
        module: 'users',
        entityType: 'user',
        entityId: id,
        entityLabel: input.login,
        changes: diffFields(
          {
            login: before.login,
            fullName: before.full_name,
            email: before.email ?? '',
            roleId: before.role_id,
            isActive: before.is_active === 1,
            locale: before.locale,
            defaultWarehouseId: before.default_warehouse_id,
            warehouseIds: beforeWarehouses.slice().sort().join(','),
          },
          { ...input, warehouseIds: [...new Set(input.warehouseIds)].sort().join(',') } as Record<string, unknown>,
        ),
      });
    }).immediate();

    res.json(toDto(db, db.prepare(`${USER_SELECT} WHERE u.id = ?`).get(id) as UserListRow));
  }),
);

usersRouter.post(
  '/:id/reset-password',
  requirePermission('admin.users'),
  asyncHandler((req, res) => {
    const { actor } = requireCtx(req);
    const id = parseIdParam(req);
    const { password, mustChangePassword } = parseBody(
      req,
      z.object({ password: z.string().min(10).max(200), mustChangePassword: z.boolean().default(true) }),
    );
    const problem = validatePasswordStrength(password);
    if (problem) throw badRequest(problem);

    const db = getDb();
    db.transaction(() => {
      const target = db.prepare('SELECT id, login FROM users WHERE id = ?').get(id) as
        | { id: number; login: string }
        | undefined;
      if (!target) throw notFound('Nie znaleziono uzytkownika.');

      db.prepare('UPDATE users SET password_hash = ?, must_change_password = ?, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?').run(
        hashPassword(password),
        mustChangePassword ? 1 : 0,
        nowIso(),
        id,
      );
      revokeAllSessions(db, id);

      writeAudit(db, {
        actor,
        action: 'PASSWORD_CHANGE',
        module: 'users',
        entityType: 'user',
        entityId: id,
        entityLabel: target.login,
        changes: [{ field: 'password', before: '***', after: '*** (zresetowane przez administratora)' }],
      });
    }).immediate();

    res.json({ ok: true });
  }),
);

const rolePermissionsSchema = z.object({
  permissions: z.array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]])).max(ALL_PERMISSIONS.length),
});

usersRouter.put(
  '/roles/:id/permissions',
  requirePermission('admin.users'),
  asyncHandler((req, res) => {
    const { actor } = requireCtx(req);
    const id = parseIdParam(req);
    const { permissions } = parseBody(req, rolePermissionsSchema);
    const db = getDb();

    db.transaction(() => {
      const role = db.prepare('SELECT id, code, name FROM roles WHERE id = ?').get(id) as
        | { id: number; code: string; name: string }
        | undefined;
      if (!role) throw notFound('Nie znaleziono roli.');
      if (role.code === 'ADMIN') {
        throw conflict('Rola Administrator ma staly zestaw uprawnien i nie podlega edycji.');
      }

      const before = (
        db.prepare('SELECT permission_code FROM role_permissions WHERE role_id = ?').all(id) as Array<{
          permission_code: string;
        }>
      )
        .map((r) => r.permission_code)
        .sort();

      db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(id);
      const insert = db.prepare('INSERT INTO role_permissions (role_id, permission_code) VALUES (?, ?)');
      for (const code of new Set(permissions)) insert.run(id, code);

      const affected = db.prepare('SELECT id FROM users WHERE role_id = ?').all(id) as Array<{ id: number }>;
      for (const u of affected) revokeAllSessions(db, u.id);

      writeAudit(db, {
        actor,
        action: 'PERMISSION_CHANGE',
        module: 'users',
        entityType: 'role',
        entityId: id,
        entityLabel: role.name,
        changes: [
          { field: 'permissions', before: before.join(','), after: [...new Set(permissions)].sort().join(',') },
        ],
      });
    }).immediate();

    res.json({ ok: true });
  }),
);

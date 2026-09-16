import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { getDb } from '../db/index.js';
import { forbidden, unauthenticated } from '../core/errors.js';
import { clientIp, userAgent, requireCtx } from '../core/context.js';
import type { Permission } from '../core/permissions.js';
import { findUserById, toAuthUser, verifyAccessToken } from '../modules/auth/auth.service.js';

/**
 * Uwierzytelnienie. Dane użytkownika (rola, uprawnienia, magazyny) są czytane
 * z bazy przy każdym zadaniu, dzięki czemu odebranie uprawnień lub dezaktywacja
 * konta działa natychmiast, bez czekania na wygasniecie tokenu.
 */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    next(unauthenticated('Brak tokenu dostępu.'));
    return;
  }

  const payload = verifyAccessToken(header.slice(7).trim());
  const db = getDb();
  const row = findUserById(db, payload.sub);
  if (!row) {
    next(unauthenticated('Konto nie istnieje.'));
    return;
  }
  if (!row.is_active) {
    next(forbidden('Konto jest nieaktywne.', 'ACCOUNT_INACTIVE'));
    return;
  }

  const user = toAuthUser(db, row);
  const requested = req.headers['x-warehouse-id'];
  let warehouseId: number | null = null;
  if (typeof requested === 'string' && requested.trim() !== '') {
    const parsed = Number.parseInt(requested, 10);
    if (Number.isNaN(parsed)) {
      next(forbidden('Nieprawidłowy identyfikator magazynu.'));
      return;
    }
    if (!user.warehouseIds.includes(parsed)) {
      next(forbidden('Brak dostępu do wskazanego magazynu.', 'WAREHOUSE_FORBIDDEN'));
      return;
    }
    warehouseId = parsed;
  }

  req.ctx = {
    user,
    warehouseId,
    actor: {
      id: user.id,
      login: user.login,
      fullName: user.fullName,
      ip: clientIp(req),
      userAgent: userAgent(req),
    },
  };
  next();
};

/** Wymaga wszystkich wskazanych uprawnień. */
export function requirePermission(...permissions: Permission[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const { user } = requireCtx(req);
    const missing = permissions.filter((p) => !user.permissions.has(p));
    if (missing.length > 0) {
      next(forbidden(`Brak uprawnień: ${missing.join(', ')}.`));
      return;
    }
    next();
  };
}

/** Wymaga co najmniej jednego ze wskazanych uprawnień. */
export function requireAnyPermission(...permissions: Permission[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const { user } = requireCtx(req);
    if (permissions.some((p) => user.permissions.has(p))) {
      next();
      return;
    }
    next(forbidden(`Brak uprawnień: wymagane jedno z ${permissions.join(', ')}.`));
  };
}

/**
 * Weryfikuje dostęp użytkownika do konkretnego magazynu.
 * Wywolywana w warstwie serwisowej przed każda operacja magazynowa.
 */
export function assertWarehouseAccess(
  warehouseIds: number[],
  warehouseId: number | null | undefined,
  label = 'magazynu',
): number {
  if (warehouseId === null || warehouseId === undefined) {
    throw forbidden(`Nie wskazano ${label}.`, 'WAREHOUSE_FORBIDDEN');
  }
  if (!warehouseIds.includes(warehouseId)) {
    throw forbidden(`Brak dostępu do ${label} (id=${warehouseId}).`, 'WAREHOUSE_FORBIDDEN');
  }
  return warehouseId;
}

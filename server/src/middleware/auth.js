/**
 * Uwierzytelnianie (JWT) i autoryzacja ról (RBAC).
 *
 * Role systemu:
 *   ADMIN       — pełna kontrola, zarządzanie użytkownikami i ustawieniami
 *   KIEROWNIK   — pełna praca operacyjna, zamykanie okresów, storno dokumentów
 *   MAGAZYNIER  — wprowadzanie i edycja własnych dokumentów w otwartym okresie
 *   KSIEGOWY    — odczyt, raporty, eksporty, korekty (bez wprowadzania)
 *   AUDYTOR     — wyłącznie odczyt (kontrola, certyfikacja KZR/SURE)
 */
import config from '../config/env.js';
import { verifyToken } from '../lib/crypto.js';
import { UnauthorizedError, ForbiddenError } from '../lib/errors.js';
import db from '../db/index.js';

export const ROLES = Object.freeze(['ADMIN', 'KIEROWNIK', 'MAGAZYNIER', 'KSIEGOWY', 'AUDYTOR']);

/** Uprawnienia elementarne przypisane do ról. */
const PERMISSIONS = Object.freeze({
  ADMIN: ['*'],
  KIEROWNIK: [
    'operations:read', 'operations:write', 'operations:cancel',
    'catalog:read', 'catalog:write',
    'reports:read', 'stock:read', 'corrections:read',
    'periods:read', 'periods:close',
    'attachments:read', 'attachments:write',
    'backup:export', 'backup:import',
    'settings:read', 'settings:write',
    'users:read',
  ],
  MAGAZYNIER: [
    'operations:read', 'operations:write',
    'catalog:read', 'catalog:write',
    'reports:read', 'stock:read', 'corrections:read',
    'periods:read',
    'attachments:read', 'attachments:write',
    'settings:read',
  ],
  KSIEGOWY: [
    'operations:read', 'reports:read', 'stock:read', 'corrections:read',
    'catalog:read', 'periods:read', 'attachments:read',
    'backup:export', 'settings:read',
  ],
  AUDYTOR: [
    'operations:read', 'reports:read', 'stock:read', 'corrections:read',
    'catalog:read', 'periods:read', 'attachments:read', 'settings:read',
  ],
});

export function permissionsFor(role) {
  return PERMISSIONS[role] || [];
}

export function hasPermission(user, permission) {
  if (!user) return false;
  const perms = permissionsFor(user.role);
  return perms.includes('*') || perms.includes(permission);
}

/** Wyciąga token typu Bearer z nagłówka Authorization. */
function bearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

/**
 * Middleware: wymaga poprawnego tokenu i aktywnego konta.
 * Ustawia `ctx.user`. Nie zwraca wartości, więc łańcuch trwa dalej.
 */
export function requireAuth(ctx) {
  const token = bearer(ctx.req);
  if (!token) throw new UnauthorizedError('Brak tokenu dostępu — zaloguj się ponownie.');
  const payload = verifyToken(token, config.auth.secret);

  const user = db.get(
    'SELECT id, email, full_name, role, is_active, must_change_password FROM users WHERE id = :id',
    { id: payload.sub },
  );
  if (!user) throw new UnauthorizedError('Konto użytkownika nie istnieje.');
  if (!user.is_active) throw new ForbiddenError('Konto jest zablokowane. Skontaktuj się z administratorem.');

  ctx.user = {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    mustChangePassword: !!user.must_change_password,
  };
  ctx.sessionId = payload.sid || null;
}

/**
 * Middleware: wymaga konkretnego uprawnienia.
 * @param {string} permission np. `operations:write`
 */
export function requirePermission(permission) {
  return (ctx) => {
    if (!ctx.user) requireAuth(ctx);
    if (!hasPermission(ctx.user, permission)) {
      throw new ForbiddenError(
        `Rola ${ctx.user.role} nie ma uprawnienia „${permission}”. Poproś administratora o zmianę uprawnień.`,
      );
    }
  };
}

/** Skrót: `guard('operations:write')` = uwierzytelnienie + kontrola uprawnienia. */
export function guard(permission) {
  return [requireAuth, requirePermission(permission)];
}

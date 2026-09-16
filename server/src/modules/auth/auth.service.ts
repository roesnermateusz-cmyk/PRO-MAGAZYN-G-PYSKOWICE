import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Db } from '../../db/index.js';
import { env } from '../../config/env.js';
import { addDays, nowIso } from '../../core/time.js';
import { hashPassword, sha256Hex, verifyPassword, validatePasswordStrength } from '../../core/password.js';
import { writeAudit, type AuditActor } from '../../core/audit.js';
import { AppError, badRequest, forbidden, unauthenticated } from '../../core/errors.js';
import type { AuthUser } from '../../core/context.js';
import type { Permission } from '../../core/permissions.js';

export interface UserRow {
  id: number;
  login: string;
  full_name: string;
  email: string | null;
  password_hash: string;
  role_id: number;
  role_code: string;
  role_name: string;
  is_active: number;
  must_change_password: number;
  locale: string;
  theme: string;
  default_warehouse_id: number | null;
  failed_logins: number;
  locked_until: string | null;
}

const USER_SELECT = `
  SELECT u.id, u.login, u.full_name, u.email, u.password_hash, u.role_id,
         r.code AS role_code, r.name AS role_name,
         u.is_active, u.must_change_password, u.locale, u.theme,
         u.default_warehouse_id, u.failed_logins, u.locked_until
    FROM users u
    JOIN roles r ON r.id = u.role_id
`;

export function findUserByLogin(db: Db, login: string): UserRow | undefined {
  return db.prepare(`${USER_SELECT} WHERE u.login = ?`).get(login) as UserRow | undefined;
}

export function findUserById(db: Db, id: number): UserRow | undefined {
  return db.prepare(`${USER_SELECT} WHERE u.id = ?`).get(id) as UserRow | undefined;
}

export function permissionsOf(db: Db, roleId: number): Set<Permission> {
  const rows = db
    .prepare('SELECT permission_code FROM role_permissions WHERE role_id = ?')
    .all(roleId) as Array<{ permission_code: Permission }>;
  return new Set(rows.map((r) => r.permission_code));
}

export function warehouseIdsOf(db: Db, userId: number, isAdmin: boolean): number[] {
  if (isAdmin) {
    return (
      db.prepare('SELECT id FROM warehouses WHERE is_active = 1 ORDER BY name').all() as Array<{ id: number }>
    ).map((r) => r.id);
  }
  return (
    db
      .prepare(
        `SELECT uw.warehouse_id AS id
           FROM user_warehouses uw
           JOIN warehouses w ON w.id = uw.warehouse_id
          WHERE uw.user_id = ? AND w.is_active = 1
          ORDER BY w.name`,
      )
      .all(userId) as Array<{ id: number }>
  ).map((r) => r.id);
}

export function toAuthUser(db: Db, row: UserRow): AuthUser {
  const isAdmin = row.role_code === 'ADMIN';
  return {
    id: row.id,
    login: row.login,
    fullName: row.full_name,
    roleId: row.role_id,
    roleCode: row.role_code,
    roleName: row.role_name,
    permissions: permissionsOf(db, row.role_id),
    warehouseIds: warehouseIdsOf(db, row.id, isAdmin),
    isAdmin,
    locale: row.locale,
    theme: row.theme,
  };
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
}

interface AccessPayload {
  sub: number;
  login: string;
  ver: number;
}

export function issueTokens(
  db: Db,
  user: UserRow,
  meta: { ip?: string; userAgent?: string },
): TokenPair {
  const accessExpiresAt = new Date(Date.now() + env.accessTokenTtlMinutes * 60_000);
  const payload: AccessPayload = { sub: user.id, login: user.login, ver: 1 };
  const accessToken = jwt.sign(payload, env.jwtSecret, {
    expiresIn: `${env.accessTokenTtlMinutes}m`,
    issuer: 'resinvest-erp',
    audience: 'resinvest-erp-client',
  });

  const tokenId = crypto.randomUUID();
  const secret = crypto.randomBytes(32).toString('base64url');
  const refreshToken = `${tokenId}.${secret}`;
  const refreshExpiresAt = addDays(new Date(), env.refreshTokenTtlDays);

  db.prepare(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, issued_at, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    tokenId,
    user.id,
    sha256Hex(secret),
    nowIso(),
    refreshExpiresAt.toISOString(),
    meta.ip ?? '',
    meta.userAgent ?? '',
  );

  return {
    accessToken,
    refreshToken,
    accessExpiresAt: accessExpiresAt.toISOString(),
    refreshExpiresAt: refreshExpiresAt.toISOString(),
  };
}

export function verifyAccessToken(token: string): AccessPayload {
  try {
    const payload = jwt.verify(token, env.jwtSecret, {
      issuer: 'resinvest-erp',
      audience: 'resinvest-erp-client',
    }) as unknown;
    if (
      typeof payload !== 'object' ||
      payload === null ||
      typeof (payload as AccessPayload).sub !== 'number' ||
      typeof (payload as AccessPayload).login !== 'string'
    ) {
      throw unauthenticated('Nieprawidłowy token dostępu.');
    }
    return payload as AccessPayload;
  } catch (err) {
    const name = (err as Error).name;
    if (name === 'TokenExpiredError') throw unauthenticated('Sesja wygasła.', 'TOKEN_EXPIRED');
    throw unauthenticated('Nieprawidłowy token dostępu.');
  }
}

export function login(
  db: Db,
  login_: string,
  password: string,
  meta: { ip: string; userAgent: string },
): { user: UserRow; tokens: TokenPair } {
  const anonymous: AuditActor = {
    id: null,
    login: login_,
    fullName: '',
    ip: meta.ip,
    userAgent: meta.userAgent,
  };
  const user = findUserByLogin(db, login_);

  if (!user) {
    // Rownowazny czas odpowiedzi - utrudnia enumeracje istniejących loginow.
    verifyPassword(password, hashPassword('dummy-password-for-timing'));
    db.transaction(() => {
      writeAudit(db, {
        actor: anonymous,
        action: 'LOGIN_FAILED',
        module: 'auth',
        entityType: 'user',
        entityId: login_,
        entityLabel: login_,
      });
    })();
    throw unauthenticated('Nieprawidłowy login lub hasło.', 'INVALID_CREDENTIALS');
  }

  const actor: AuditActor = {
    id: user.id,
    login: user.login,
    fullName: user.full_name,
    ip: meta.ip,
    userAgent: meta.userAgent,
  };

  if (user.locked_until && user.locked_until > nowIso()) {
    throw forbidden(
      `Konto jest tymczasowo zablokowane po nieudanych próbach logowania. Sprobuj po ${user.locked_until}.`,
      'ACCOUNT_LOCKED',
    );
  }

  if (!user.is_active) {
    throw forbidden('Konto jest nieaktywne. Skontaktuj się z administratorem.', 'ACCOUNT_INACTIVE');
  }

  if (!verifyPassword(password, user.password_hash)) {
    db.transaction(() => {
      const failed = user.failed_logins + 1;
      const lockedUntil =
        failed >= env.loginMaxAttempts
          ? new Date(Date.now() + env.loginLockMinutes * 60_000).toISOString()
          : null;
      db.prepare('UPDATE users SET failed_logins = ?, locked_until = ?, updated_at = ? WHERE id = ?').run(
        lockedUntil ? 0 : failed,
        lockedUntil,
        nowIso(),
        user.id,
      );
      writeAudit(db, {
        actor,
        action: 'LOGIN_FAILED',
        module: 'auth',
        entityType: 'user',
        entityId: user.id,
        entityLabel: user.login,
        changes: [{ field: 'failedLogins', before: user.failed_logins, after: lockedUntil ? 0 : failed }],
      });
    })();
    throw unauthenticated('Nieprawidłowy login lub hasło.', 'INVALID_CREDENTIALS');
  }

  const tokens = db.transaction(() => {
    db.prepare(
      'UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?',
    ).run(nowIso(), nowIso(), user.id);
    const issued = issueTokens(db, user, meta);
    writeAudit(db, {
      actor,
      action: 'LOGIN',
      module: 'auth',
      entityType: 'user',
      entityId: user.id,
      entityLabel: user.login,
    });
    return issued;
  })();

  return { user, tokens };
}

export function refresh(
  db: Db,
  refreshToken: string,
  meta: { ip: string; userAgent: string },
): { user: UserRow; tokens: TokenPair } {
  const [tokenId, secret] = refreshToken.split('.');
  if (!tokenId || !secret) throw unauthenticated('Nieprawidłowy token odświeżania.');

  const row = db.prepare('SELECT * FROM refresh_tokens WHERE id = ?').get(tokenId) as
    | {
        id: string;
        user_id: number;
        token_hash: string;
        expires_at: string;
        revoked_at: string | null;
      }
    | undefined;

  if (!row || row.revoked_at || row.expires_at <= nowIso()) {
    throw unauthenticated('Token odświeżania jest nieważny.', 'TOKEN_EXPIRED');
  }

  const providedHash = Buffer.from(sha256Hex(secret));
  const storedHash = Buffer.from(row.token_hash);
  if (providedHash.length !== storedHash.length || !crypto.timingSafeEqual(providedHash, storedHash)) {
    // Token o poprawnym identyfikatorze, lecz błędnym sekrecie - uniewazniamy
    // caly lancuch sesji jako potencjalna próbę przejecia.
    db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?').run(nowIso(), tokenId);
    throw unauthenticated('Token odświeżania jest nieważny.');
  }

  const user = findUserById(db, row.user_id);
  if (!user || !user.is_active) throw forbidden('Konto jest nieaktywne.', 'ACCOUNT_INACTIVE');

  return db.transaction(() => {
    db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?').run(nowIso(), tokenId);
    const tokens = issueTokens(db, user, meta);
    return { user, tokens };
  })();
}

export function logout(db: Db, refreshToken: string | undefined, actor: AuditActor): void {
  db.transaction(() => {
    if (refreshToken) {
      const tokenId = refreshToken.split('.')[0];
      if (tokenId) {
        db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(
          nowIso(),
          tokenId,
        );
      }
    }
    writeAudit(db, {
      actor,
      action: 'LOGOUT',
      module: 'auth',
      entityType: 'user',
      entityId: actor.id ?? 0,
      entityLabel: actor.login,
    });
  })();
}

export function revokeAllSessions(db: Db, userId: number): void {
  db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(
    nowIso(),
    userId,
  );
}

export function changeOwnPassword(
  db: Db,
  userId: number,
  currentPassword: string,
  newPassword: string,
  actor: AuditActor,
): void {
  const user = findUserById(db, userId);
  if (!user) throw new AppError(404, 'NOT_FOUND', 'Nie znaleziono użytkownika.');
  if (!verifyPassword(currentPassword, user.password_hash)) {
    throw unauthenticated('Bieżące hasło jest nieprawidłowe.', 'INVALID_CREDENTIALS');
  }
  const problem = validatePasswordStrength(newPassword);
  if (problem) throw badRequest(problem);
  if (verifyPassword(newPassword, user.password_hash)) {
    throw badRequest('Nowe hasło musi różnić się od dotychczasowego.');
  }

  db.transaction(() => {
    db.prepare(
      'UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?',
    ).run(hashPassword(newPassword), nowIso(), userId);
    revokeAllSessions(db, userId);
    writeAudit(db, {
      actor,
      action: 'PASSWORD_CHANGE',
      module: 'auth',
      entityType: 'user',
      entityId: userId,
      entityLabel: user.login,
    });
  })();
}

/** Usuwa wygasle i unieważnione tokeny - wywolywane cyklicznie przez serwer. */
export function purgeExpiredTokens(db: Db): number {
  const result = db
    .prepare("DELETE FROM refresh_tokens WHERE expires_at < ? OR revoked_at IS NOT NULL")
    .run(nowIso());
  return result.changes;
}

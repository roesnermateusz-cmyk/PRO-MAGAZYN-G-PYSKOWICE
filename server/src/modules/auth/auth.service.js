/**
 * Uwierzytelnianie: logowanie, odświeżanie sesji, wylogowanie, zmiana hasła.
 *
 * Model tokenów:
 *  • token dostępu (JWT, krótki czas życia) — nośnik tożsamości w nagłówku Authorization,
 *  • token odświeżania (losowy, długi czas życia) — przechowywany w bazie
 *    wyłącznie jako skrót SHA-256; rotowany przy każdym użyciu, więc kradzież
 *    starego tokenu jest wykrywalna i nieprzydatna.
 */
import db from '../../db/index.js';
import config from '../../config/env.js';
import { validate } from '../../lib/validate.js';
import { UnauthorizedError, ForbiddenError, ValidationError, NotFoundError } from '../../lib/errors.js';
import {
  uuid, hashPassword, verifyPassword, passwordIssues,
  signToken, newRefreshToken, sha256,
} from '../../lib/crypto.js';
import { permissionsFor } from '../../middleware/auth.js';
import { audit } from '../../middleware/audit.js';

const accessTtlSec = () => config.auth.accessTtlMin * 60;
const refreshTtlMs = () => config.auth.refreshTtlDays * 86_400_000;

/** Publiczna reprezentacja użytkownika (bez danych wrażliwych). */
export function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    phone: row.phone ?? null,
    isActive: !!row.is_active,
    mustChangePassword: !!row.must_change_password,
    lastLoginAt: row.last_login_at ?? null,
    permissions: permissionsFor(row.role),
  };
}

function issueSession(user, ctx) {
  const sessionId = uuid();
  const refresh = newRefreshToken();
  const expiresAt = new Date(Date.now() + refreshTtlMs()).toISOString();

  db.run(
    `INSERT INTO sessions(id, user_id, token_hash, expires_at, ip, user_agent)
          VALUES (:id, :userId, :hash, :expiresAt, :ip, :userAgent)`,
    {
      id: sessionId,
      userId: user.id,
      hash: sha256(refresh),
      expiresAt,
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
    },
  );

  const accessToken = signToken(
    { sub: user.id, role: user.role, sid: sessionId },
    config.auth.secret,
    accessTtlSec(),
  );

  return {
    accessToken,
    refreshToken: refresh,
    expiresIn: accessTtlSec(),
    refreshExpiresAt: expiresAt,
  };
}

/**
 * Logowanie e-mailem i hasłem.
 * Po `AUTH_MAX_FAILED` nieudanych próbach konto jest blokowane czasowo.
 */
export function login(input, ctx) {
  const d = validate(input, {
    email: { type: 'email', required: true, label: 'E-mail' },
    password: { type: 'string', required: true, min: 1, max: 200, trim: false, label: 'Hasło' },
  });

  const row = db.get('SELECT * FROM users WHERE email = :email', { email: d.email });
  const genericError = new UnauthorizedError('Nieprawidłowy e-mail lub hasło.');

  if (!row) {
    // Stały koszt obliczeniowy niezależnie od istnienia konta (ochrona przed enumeracją).
    verifyPassword(d.password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
    audit(ctx, 'LOGIN_FAILED', 'users', null, { email: d.email, reason: 'NO_USER' });
    throw genericError;
  }
  if (!row.is_active) {
    audit(ctx, 'LOGIN_FAILED', 'users', row.id, { reason: 'INACTIVE' });
    throw new ForbiddenError('Konto jest zablokowane. Skontaktuj się z administratorem.');
  }
  if (row.locked_until && row.locked_until > new Date().toISOString()) {
    throw new ForbiddenError(
      `Konto jest czasowo zablokowane po nieudanych próbach logowania. Spróbuj po ${row.locked_until.slice(11, 16)} UTC.`,
    );
  }

  if (!verifyPassword(d.password, row.password_hash)) {
    const failed = row.failed_logins + 1;
    const lock = failed >= config.auth.maxFailed
      ? new Date(Date.now() + config.auth.lockMinutes * 60_000).toISOString()
      : null;
    db.run(
      'UPDATE users SET failed_logins = :failed, locked_until = :lock WHERE id = :id',
      { failed, lock, id: row.id },
    );
    audit(ctx, 'LOGIN_FAILED', 'users', row.id, { reason: 'BAD_PASSWORD', attempt: failed });
    throw genericError;
  }

  db.run(
    "UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = datetime('now') WHERE id = :id",
    { id: row.id },
  );
  const tokens = issueSession(row, ctx);
  audit({ ...ctx, user: publicUser(row) }, 'LOGIN', 'users', row.id);
  return { ...tokens, user: publicUser(db.get('SELECT * FROM users WHERE id = :id', { id: row.id })) };
}

/** Wymiana tokenu odświeżania na nową parę tokenów (rotacja). */
export function refresh(input, ctx) {
  const token = String(input?.refreshToken || '');
  if (!token) throw new UnauthorizedError('Brak tokenu odświeżania.');

  const session = db.get(
    'SELECT * FROM sessions WHERE token_hash = :hash', { hash: sha256(token) },
  );
  if (!session) throw new UnauthorizedError('Sesja nie istnieje — zaloguj się ponownie.');
  if (session.revoked_at) throw new UnauthorizedError('Sesja została zamknięta — zaloguj się ponownie.');
  if (session.expires_at < new Date().toISOString()) {
    throw new UnauthorizedError('Sesja wygasła — zaloguj się ponownie.');
  }

  const user = db.get('SELECT * FROM users WHERE id = :id', { id: session.user_id });
  if (!user || !user.is_active) throw new ForbiddenError('Konto jest nieaktywne.');

  return db.tx(() => {
    db.run("UPDATE sessions SET revoked_at = datetime('now') WHERE id = :id", { id: session.id });
    const tokens = issueSession(user, ctx);
    return { ...tokens, user: publicUser(user) };
  });
}

/** Zamyka bieżącą sesję (lub wszystkie sesje użytkownika). */
export function logout(input, ctx) {
  const token = String(input?.refreshToken || '');
  if (input?.allDevices && ctx.user) {
    db.run(
      "UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = :id AND revoked_at IS NULL",
      { id: ctx.user.id },
    );
  } else if (token) {
    db.run(
      "UPDATE sessions SET revoked_at = datetime('now') WHERE token_hash = :hash", { hash: sha256(token) },
    );
  } else if (ctx.sessionId) {
    db.run("UPDATE sessions SET revoked_at = datetime('now') WHERE id = :id", { id: ctx.sessionId });
  }
  audit(ctx, 'LOGOUT', 'users', ctx.user?.id ?? null);
  return { ok: true };
}

/** Zmiana własnego hasła — wymaga podania hasła bieżącego. */
export function changePassword(input, ctx) {
  const d = validate(input, {
    currentPassword: { type: 'string', required: true, max: 200, trim: false, label: 'Obecne hasło' },
    newPassword: { type: 'string', required: true, max: 200, trim: false, label: 'Nowe hasło' },
  });

  const row = db.get('SELECT * FROM users WHERE id = :id', { id: ctx.user.id });
  if (!row) throw new NotFoundError('Nie znaleziono konta.');
  if (!verifyPassword(d.currentPassword, row.password_hash)) {
    throw new UnauthorizedError('Obecne hasło jest nieprawidłowe.');
  }
  const issues = passwordIssues(d.newPassword);
  if (issues.length) {
    throw new ValidationError(`Nowe hasło nie spełnia wymagań: ${issues.join(', ')}.`, [
      { field: 'newPassword', message: `Wymagania: ${issues.join(', ')}.` },
    ]);
  }
  if (verifyPassword(d.newPassword, row.password_hash)) {
    throw new ValidationError('Nowe hasło musi różnić się od obecnego.');
  }

  db.tx(() => {
    db.run(
      `UPDATE users SET password_hash = :hash, must_change_password = 0, updated_at = datetime('now')
        WHERE id = :id`,
      { hash: hashPassword(d.newPassword), id: ctx.user.id },
    );
    // Zmiana hasła zamyka pozostałe sesje.
    db.run(
      `UPDATE sessions SET revoked_at = datetime('now')
        WHERE user_id = :id AND revoked_at IS NULL AND id <> COALESCE(:sid, '')`,
      { id: ctx.user.id, sid: ctx.sessionId },
    );
  });
  audit(ctx, 'CHANGE_PASSWORD', 'users', ctx.user.id);
  return { ok: true };
}

/** Dane zalogowanego użytkownika wraz z uprawnieniami. */
export function me(ctx) {
  const row = db.get('SELECT * FROM users WHERE id = :id', { id: ctx.user.id });
  if (!row) throw new NotFoundError('Nie znaleziono konta.');
  return publicUser(row);
}

/** Usuwa wygasłe sesje — wywoływane cyklicznie przy starcie i co dobę. */
export function purgeExpiredSessions() {
  const res = db.run("DELETE FROM sessions WHERE expires_at < datetime('now', '-7 days')");
  return res.changes;
}

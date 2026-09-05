/**
 * Zarządzanie kontami użytkowników (rola ADMIN).
 *
 * Konta nie są usuwane — dezaktywujemy je, bo identyfikator użytkownika jest
 * przywołany w dokumentach, korektach i dzienniku audytu.
 */
import db from '../../db/index.js';
import { uuid, hashPassword, passwordIssues } from '../../lib/crypto.js';
import { validate } from '../../lib/validate.js';
import { ConflictError, NotFoundError, ValidationError, ForbiddenError } from '../../lib/errors.js';
import { ROLES } from '../../middleware/auth.js';
import { publicUser } from '../auth/auth.service.js';
import { audit } from '../../middleware/audit.js';

const USER_SCHEMA = {
  email: { type: 'email', required: true, label: 'E-mail' },
  fullName: { type: 'string', required: true, min: 3, max: 120, label: 'Imię i nazwisko' },
  role: { type: 'enum', values: ROLES, required: true, label: 'Rola' },
  phone: { type: 'string', max: 40, label: 'Telefon' },
  password: { type: 'string', max: 200, trim: false, label: 'Hasło' },
  isActive: { type: 'bool', default: true, label: 'Aktywny' },
  mustChangePassword: { type: 'bool', default: true, label: 'Wymuś zmianę hasła' },
};

export function listUsers({ includeInactive = true } = {}) {
  const rows = db.all(
    `SELECT * FROM users ${includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY is_active DESC, full_name`,
  );
  return rows.map(publicUser);
}

export function getUser(id) {
  const row = db.get('SELECT * FROM users WHERE id = :id', { id });
  if (!row) throw new NotFoundError('Nie znaleziono użytkownika.');
  return publicUser(row);
}

export function createUser(input, ctx) {
  const d = validate(input, USER_SCHEMA);
  if (db.get('SELECT 1 AS x FROM users WHERE email = :email', { email: d.email })) {
    throw new ConflictError(`Konto o adresie ${d.email} już istnieje.`);
  }
  const issues = passwordIssues(d.password);
  if (issues.length) {
    throw new ValidationError(`Hasło nie spełnia wymagań: ${issues.join(', ')}.`, [
      { field: 'password', message: `Wymagania: ${issues.join(', ')}.` },
    ]);
  }

  const id = uuid();
  db.run(
    `INSERT INTO users(id, email, full_name, password_hash, role, phone, is_active, must_change_password)
          VALUES (:id, :email, :fullName, :hash, :role, :phone, :isActive, :mustChange)`,
    {
      id,
      email: d.email,
      fullName: d.fullName,
      hash: hashPassword(d.password),
      role: d.role,
      phone: d.phone ?? null,
      isActive: d.isActive,
      mustChange: d.mustChangePassword,
    },
  );
  audit(ctx, 'CREATE', 'users', id, { email: d.email, role: d.role });
  return getUser(id);
}

export function updateUser(id, input, ctx) {
  const existing = db.get('SELECT * FROM users WHERE id = :id', { id });
  if (!existing) throw new NotFoundError('Nie znaleziono użytkownika.');
  const d = validate(input, USER_SCHEMA, { partial: true });

  // Zabezpieczenie przed odcięciem sobie dostępu i przed utratą ostatniego administratora.
  if (existing.role === 'ADMIN' && (d.role && d.role !== 'ADMIN' || d.isActive === false)) {
    const admins = db.value("SELECT COUNT(*) FROM users WHERE role = 'ADMIN' AND is_active = 1");
    if (admins <= 1) throw new ForbiddenError('W systemie musi pozostać co najmniej jedno aktywne konto administratora.');
  }
  if (id === ctx.user.id && d.isActive === false) {
    throw new ForbiddenError('Nie można dezaktywować własnego konta.');
  }

  const patch = {};
  if (d.email !== undefined) {
    const taken = db.get('SELECT id FROM users WHERE email = :email AND id <> :id', { email: d.email, id });
    if (taken) throw new ConflictError(`Adres ${d.email} jest już zajęty.`);
    patch.email = d.email;
  }
  if (d.fullName !== undefined) patch.full_name = d.fullName;
  if (d.role !== undefined) patch.role = d.role;
  if (d.phone !== undefined) patch.phone = d.phone;
  if (d.isActive !== undefined) patch.is_active = d.isActive;
  if (d.mustChangePassword !== undefined) patch.must_change_password = d.mustChangePassword;

  if (d.password) {
    const issues = passwordIssues(d.password);
    if (issues.length) {
      throw new ValidationError(`Hasło nie spełnia wymagań: ${issues.join(', ')}.`);
    }
    patch.password_hash = hashPassword(d.password);
    patch.must_change_password = d.mustChangePassword ?? true;
  }

  if (Object.keys(patch).length) {
    const params = { id };
    const sets = Object.entries(patch).map(([col, value], i) => {
      params[`p${i}`] = value;
      return `${col} = :p${i}`;
    });
    db.tx(() => {
      db.run(`UPDATE users SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = :id`, params);
      // Zmiana hasła lub dezaktywacja unieważnia aktywne sesje użytkownika.
      if (patch.password_hash || patch.is_active === false) {
        db.run("UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = :id AND revoked_at IS NULL", { id });
      }
    });
  }
  audit(ctx, 'UPDATE', 'users', id, { fields: Object.keys(patch) });
  return getUser(id);
}

/** Lista aktywnych sesji użytkownika (kontrola dostępu). */
export function listSessions(userId) {
  return db.all(
    `SELECT id, issued_at, expires_at, revoked_at, ip, user_agent
       FROM sessions WHERE user_id = :userId ORDER BY issued_at DESC LIMIT 50`,
    { userId },
  ).map((s) => ({
    id: s.id,
    issuedAt: s.issued_at,
    expiresAt: s.expires_at,
    revokedAt: s.revoked_at,
    ip: s.ip,
    userAgent: s.user_agent,
    active: !s.revoked_at && s.expires_at > new Date().toISOString(),
  }));
}

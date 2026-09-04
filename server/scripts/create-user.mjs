#!/usr/bin/env node
/**
 * Zakłada konto użytkownika z wiersza poleceń.
 * Przydatne przy pierwszym wdrożeniu i przy odzyskiwaniu dostępu.
 *
 *   npm run user:create -- --email jan@firma.pl --name "Jan Kowalski" --role ADMIN [--password Haslo123456]
 *
 * Gdy hasło zostanie pominięte, system wygeneruje je i wypisze jednorazowo.
 */
import { bootstrap } from '../src/bootstrap.js';
import { createUser, listUsers } from '../src/modules/users/users.service.js';
import { shortId } from '../src/lib/crypto.js';
import db, { closeDatabase } from '../src/db/index.js';
import { ROLES } from '../src/middleware/auth.js';

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

if (process.argv.includes('--list')) {
  bootstrap();
  console.table(listUsers().map((u) => ({
    'E-mail': u.email, 'Imię i nazwisko': u.fullName, Rola: u.role,
    Aktywne: u.isActive ? 'tak' : 'nie', 'Ostatnie logowanie': u.lastLoginAt ?? '—',
  })));
  closeDatabase();
  process.exit(0);
}

const email = arg('email');
const name = arg('name');
const role = arg('role', 'MAGAZYNIER').toUpperCase();
const password = arg('password') || `Res-${shortId(5)}-${new Date().getFullYear()}A1`;

if (!email || !name) {
  console.error(`
Zakładanie konta użytkownika ResInvest ERP

  npm run user:create -- --email <adres> --name "<imię i nazwisko>" [--role <rola>] [--password <hasło>]
  npm run user:create -- --list

Role: ${ROLES.join(', ')}
`);
  process.exit(1);
}
if (!ROLES.includes(role)) {
  console.error(`Nieznana rola: ${role}. Dostępne: ${ROLES.join(', ')}`);
  process.exit(1);
}

bootstrap();

const admin = db.get("SELECT id, email, full_name FROM users WHERE role = 'ADMIN' ORDER BY created_at LIMIT 1");
const ctx = {
  user: { id: admin?.id ?? 'cli', email: admin?.email ?? 'cli', fullName: 'Konsola', role: 'ADMIN' },
  ip: 'cli',
  userAgent: 'create-user.mjs',
};

try {
  const user = createUser({ email, fullName: name, role, password, mustChangePassword: true }, ctx);
  console.log('\n╭─ Konto utworzone ──────────────────────────────────────────╮');
  console.log(`│  E-mail : ${user.email}`);
  console.log(`│  Osoba  : ${user.fullName}`);
  console.log(`│  Rola   : ${user.role}`);
  console.log(`│  Hasło  : ${password}`);
  console.log('│  Hasło należy zmienić przy pierwszym logowaniu.');
  console.log('╰────────────────────────────────────────────────────────────╯\n');
} catch (err) {
  console.error(`Błąd: ${err.message}`);
  if (err.details) console.error(err.details.map((d) => ` • ${d.message}`).join('\n'));
  process.exit(1);
} finally {
  closeDatabase();
}

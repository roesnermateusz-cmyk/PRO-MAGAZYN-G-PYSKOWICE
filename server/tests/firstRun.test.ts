import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb, type Db } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { env } from '../src/config/env.js';
import { FIRST_RUN_FILE, prepareFirstRun } from '../src/core/firstRun.js';
import { validatePasswordStrength } from '../src/core/password.js';
import { login, toAuthUser } from '../src/modules/auth/auth.service.js';

const META = { ip: '127.0.0.1', userAgent: 'test' };

/**
 * Regresja: świeża instalacja musi dać się zalogować.
 *
 * Wcześniej start serwera wykonywał wyłącznie migracje, a role, uprawnienia
 * i konto administratora tworzył tylko skrypt `npm run db:seed`, niedostępny
 * w zainstalowanym programie. Po instalacji tabele były puste i logowanie
 * nie było możliwe. Pozostałe testy tego nie wykrywały, bo ich przygotowanie
 * wywołuje `seedCore` bezpośrednio - z pominięciem ścieżki startu programu.
 *
 * Te testy idą wyłącznie tą ścieżką: migracje, a potem `prepareFirstRun`.
 */

const firstRunFile = path.join(env.dataDir, FIRST_RUN_FILE);

/** Pusta baza po samych migracjach - dokładnie tak, jak po instalacji. */
function swiezaInstalacja(): Db {
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  for (const t of db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
    .all() as Array<{ name: string }>) {
    db.exec(`DROP TRIGGER IF EXISTS "${t.name}"`);
  }
  for (const t of db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>) {
    db.exec(`DROP TABLE IF EXISTS "${t.name}"`);
  }
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function licz(db: Db, tabela: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).get() as { n: number }).n;
}

beforeEach(() => {
  fs.rmSync(firstRunFile, { force: true });
  delete process.env.ADMIN_INITIAL_PASSWORD;
});

afterEach(() => {
  fs.rmSync(firstRunFile, { force: true });
  delete process.env.ADMIN_INITIAL_PASSWORD;
});

describe('pierwsze uruchomienie po instalacji', () => {
  it('po samych migracjach baza nie ma zadnego konta', () => {
    const db = swiezaInstalacja();
    expect(licz(db, 'users')).toBe(0);
    expect(licz(db, 'roles')).toBe(0);
    expect(licz(db, 'permissions')).toBe(0);
  });

  it('zaklada konto administratora, role i uprawnienia', () => {
    const db = swiezaInstalacja();
    const dane = prepareFirstRun(db);

    expect(dane).not.toBeNull();
    expect(dane?.login).toBe('admin');
    expect(licz(db, 'users')).toBe(1);
    expect(licz(db, 'roles')).toBeGreaterThan(0);
    expect(licz(db, 'permissions')).toBeGreaterThan(0);
    expect(licz(db, 'role_permissions')).toBeGreaterThan(0);
  });

  it('hasło początkowe jest losowe i spełnia polityke haseł', () => {
    const pierwsze = prepareFirstRun(swiezaInstalacja());
    const drugie = prepareFirstRun(swiezaInstalacja());

    expect(pierwsze?.password).toBeTruthy();
    expect(validatePasswordStrength(pierwsze?.password ?? '')).toBeNull();
    // Dwie instalacje nie moga dostac tego samego hasła.
    expect(pierwsze?.password).not.toBe(drugie?.password);
  });

  it('wygenerowanym hasłem można sie zalogować i wymuszana jest jego zmiana', () => {
    const db = swiezaInstalacja();
    const dane = prepareFirstRun(db);

    const wynik = login(db, 'admin', dane?.password ?? '', META);
    expect(wynik.user.login).toBe('admin');
    expect(wynik.tokens.accessToken).toBeTruthy();

    // Konto musi miec realne uprawnienia - inaczej program byłby bezużyteczny.
    const uprawniony = toAuthUser(db, wynik.user);
    expect(uprawniony.roleCode).toBe('ADMIN');
    expect(uprawniony.permissions.size).toBeGreaterThan(0);
    expect(uprawniony.permissions.has('admin.users')).toBe(true);
    expect(uprawniony.isAdmin).toBe(true);

    const row = db
      .prepare("SELECT must_change_password FROM users WHERE login = 'admin'")
      .get() as { must_change_password: number };
    expect(row.must_change_password).toBe(1);
  });

  it('odrzuca logowanie bledynym hasłem', () => {
    const db = swiezaInstalacja();
    prepareFirstRun(db);
    expect(() => login(db, 'admin', 'zle-haslo-123', META)).toThrow();
  });

  it('zapisuje dane logowania do pliku w katalogu danych', () => {
    const db = swiezaInstalacja();
    const dane = prepareFirstRun(db);

    expect(fs.existsSync(firstRunFile)).toBe(true);
    const tresc = fs.readFileSync(firstRunFile, 'utf8');
    expect(tresc).toContain('admin');
    expect(tresc).toContain(dane?.password ?? '###');
  });

  it('usuwa plik z hasłem po zmianie hasła przez administratora', () => {
    const db = swiezaInstalacja();
    prepareFirstRun(db);
    expect(fs.existsSync(firstRunFile)).toBe(true);

    db.prepare("UPDATE users SET must_change_password = 0 WHERE login = 'admin'").run();
    prepareFirstRun(db);

    expect(fs.existsSync(firstRunFile)).toBe(false);
  });

  it('kolejne uruchomienia nie zmieniaja istniejacego konta', () => {
    const db = swiezaInstalacja();
    const dane = prepareFirstRun(db);
    const hashPoPierwszym = (
      db.prepare("SELECT password_hash AS h FROM users WHERE login = 'admin'").get() as { h: string }
    ).h;

    expect(prepareFirstRun(db)).toBeNull();

    const hashPoDrugim = (
      db.prepare("SELECT password_hash AS h FROM users WHERE login = 'admin'").get() as { h: string }
    ).h;
    expect(hashPoDrugim).toBe(hashPoPierwszym);
    expect(licz(db, 'users')).toBe(1);
    // Hasło z pierwszego uruchomienia nadal dziala.
    expect(login(db, 'admin', dane?.password ?? '', META).user.login).toBe('admin');
  });

  it('respektuje hasło podane w konfiguracji i nie zapisuje go do pliku', () => {
    process.env.ADMIN_INITIAL_PASSWORD = 'InstalacjaMasowa#2026';
    const db = swiezaInstalacja();

    // Hasło pochodzi z konfiguracji, wiec nie ma potrzeby go pokazywać.
    expect(prepareFirstRun(db)).toBeNull();
    expect(fs.existsSync(firstRunFile)).toBe(false);
    expect(login(db, 'admin', 'InstalacjaMasowa#2026', META).user.login).toBe('admin');
  });
});

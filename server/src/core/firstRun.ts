import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db/index.js';
import { env } from '../config/env.js';
import { seedCore } from '../db/seed.js';
import { logger } from './logger.js';

/**
 * Przygotowanie systemu do pracy przy pierwszym uruchomieniu.
 *
 * Migracje tworzą wyłącznie puste tabele. Bez tego kroku zainstalowany program
 * nie miałby ról, uprawnień ani żadnego konta - nie dałoby się zalogować.
 *
 * Operacja jest idempotentna: przy każdym starcie uzupełnia brakujące role
 * i uprawnienia (także te dodane w nowszej wersji programu), a konto
 * administratora zakłada tylko wtedy, gdy jeszcze nie istnieje.
 */

/** Plik z danymi pierwszego logowania, tworzony tylko przy zakładaniu konta. */
export const FIRST_RUN_FILE = 'PIERWSZE-URUCHOMIENIE.txt';

export interface FirstRunCredentials {
  login: string;
  password: string;
  file: string;
}

/**
 * Hasło początkowe generowane losowo. Bez znaków łatwych do pomylenia
 * (l/I/1, O/0), bo administrator przepisuje je ręcznie przy pierwszym logowaniu.
 * Spełnia politykę haseł: min. 10 znaków, mała i wielka litera, cyfra.
 */
function generatePassword(): string {
  const male = 'abcdefghijkmnpqrstuvwxyz';
  const wielkie = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const cyfry = '23456789';
  const wszystkie = male + wielkie + cyfry;

  const losowyZnak = (zbior: string): string =>
    zbior[crypto.randomInt(0, zbior.length)] as string;

  // Po jednym znaku z każdej wymaganej grupy, reszta losowo - następnie tasowanie,
  // aby pozycje znaków wymaganych nie były przewidywalne.
  const znaki = [losowyZnak(male), losowyZnak(wielkie), losowyZnak(cyfry)];
  while (znaki.length < 14) znaki.push(losowyZnak(wszystkie));

  for (let i = znaki.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [znaki[i], znaki[j]] = [znaki[j] as string, znaki[i] as string];
  }
  return znaki.join('');
}

function adminIstnieje(db: Db): boolean {
  return db.prepare("SELECT 1 FROM users WHERE login = 'admin'").get() !== undefined;
}

function zapiszPlikZDanymi(login: string, password: string): string {
  const plik = path.join(env.dataDir, FIRST_RUN_FILE);
  const tresc = [
    'ResInvest ERP - dane pierwszego logowania',
    '='.repeat(52),
    '',
    `  Login:  ${login}`,
    `  Hasło:  ${password}`,
    '',
    'Przy pierwszym logowaniu program poprosi o ustawienie własnego hasła.',
    'Po jego zmianie ten plik zostanie usunięty automatycznie przy kolejnym',
    'uruchomieniu programu. Można go też skasować ręcznie od razu po zalogowaniu.',
    '',
    'Hasło zostało wygenerowane losowo na tym komputerze. Nie jest znane',
    'nikomu poza osobą mającą dostęp do tego pliku.',
    '',
    `Plik utworzono: ${new Date().toLocaleString('pl-PL')}`,
    '',
  ].join('\r\n');

  fs.mkdirSync(env.dataDir, { recursive: true });
  // mode 0o600 ogranicza dostęp na systemach POSIX; na Windows plik dziedziczy
  // uprawnienia katalogu danych (dostęp ma administrator stanowiska).
  fs.writeFileSync(plik, tresc, { mode: 0o600 });
  return plik;
}

/** Usuwa plik z hasłem początkowym, gdy administrator ustawił już własne hasło. */
function sprzatnijPlikPoZmianieHasla(db: Db): void {
  const plik = path.join(env.dataDir, FIRST_RUN_FILE);
  if (!fs.existsSync(plik)) return;

  const row = db
    .prepare("SELECT must_change_password FROM users WHERE login = 'admin'")
    .get() as { must_change_password: number } | undefined;

  if (row && row.must_change_password === 0) {
    fs.rmSync(plik, { force: true });
    logger.info(`Usunięto plik ${FIRST_RUN_FILE} - hasło administratora zostało zmienione.`);
  }
}

/**
 * Uzupełnia dane referencyjne i zakłada konto administratora, jeżeli go nie ma.
 * Zwraca dane logowania wyłącznie wtedy, gdy konto zostało właśnie utworzone.
 */
export function prepareFirstRun(db: Db): FirstRunCredentials | null {
  const nowaInstalacja = !adminIstnieje(db);

  // Hasło z konfiguracji pozwala przygotować instalację masową; gdy go nie ma,
  // generujemy losowe - system nigdy nie startuje ze znanym hasłem domyślnym.
  const haslo = nowaInstalacja
    ? (process.env.ADMIN_INITIAL_PASSWORD?.trim() || generatePassword())
    : '';

  seedCore(db, haslo);

  if (!nowaInstalacja) {
    sprzatnijPlikPoZmianieHasla(db);
    return null;
  }

  const zKonfiguracji = Boolean(process.env.ADMIN_INITIAL_PASSWORD?.trim());
  if (zKonfiguracji) {
    logger.info('Utworzono konto administratora z hasłem podanym w konfiguracji (ADMIN_INITIAL_PASSWORD).');
    return null;
  }

  const plik = zapiszPlikZDanymi('admin', haslo);
  logger.info('='.repeat(60));
  logger.info(' PIERWSZE URUCHOMIENIE - utworzono konto administratora');
  logger.info('   Login:  admin');
  logger.info(`   Hasło:  ${haslo}`);
  logger.info(`   Zapisano również w pliku: ${plik}`);
  logger.info(' Program poprosi o zmianę hasła przy pierwszym logowaniu.');
  logger.info('='.repeat(60));

  return { login: 'admin', password: haslo, file: plik };
}

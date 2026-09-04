/**
 * Punkt wejścia aplikacji serwerowej.
 *
 * Uruchomienie: `npm start` (lub `node --disable-warning=ExperimentalWarning server/src/index.js`).
 * Serwer udostępnia API pod `/api/v1` i serwuje aplikację kliencką z katalogu `web/`.
 */
import { mkdirSync } from 'node:fs';
import config from './config/env.js';
import logger from './lib/logger.js';
import { createApp, APP_VERSION, API_PREFIX } from './app.js';
import { bootstrap } from './bootstrap.js';
import { closeDatabase } from './db/index.js';
import { purgeExpiredSessions } from './modules/auth/auth.service.js';
import { createBackup } from './modules/backup/backup.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function ensureDirectories() {
  for (const dir of [config.attachments.dir, config.backup.dir]) {
    mkdirSync(dir, { recursive: true });
  }
}

function banner({ bootstrapPassword, migrations }) {
  const url = `http://${config.http.host === '0.0.0.0' ? 'localhost' : config.http.host}:${config.http.port}`;
  const lines = [
    '',
    '  ╭──────────────────────────────────────────────────────────────╮',
    '  │  ResInvest ERP — system magazynowy biomasy                   │',
    '  ╰──────────────────────────────────────────────────────────────╯',
    `  Wersja        : ${APP_VERSION}`,
    `  Tryb          : ${config.env}`,
    `  Adres         : ${url}`,
    `  API           : ${url}${API_PREFIX}`,
    `  Baza danych   : ${config.db.file}`,
    `  Załączniki    : ${config.attachments.dir}`,
    `  Kopie zapasowe: ${config.backup.dir}`,
  ];
  if (migrations.length) lines.push(`  Migracje      : zastosowano ${migrations.length} (${migrations.join(', ')})`);
  if (config.auth.generatedSecret) {
    lines.push(
      '',
      '  UWAGA: AUTH_SECRET nie jest ustawiony — wygenerowano klucz tymczasowy.',
      '         Po restarcie wszyscy użytkownicy zostaną wylogowani.',
      '         Ustaw AUTH_SECRET w pliku .env przed wdrożeniem produkcyjnym.',
    );
  }
  if (bootstrapPassword) {
    lines.push(
      '',
      '  ┌─ PIERWSZE URUCHOMIENIE — dane logowania administratora ─────┐',
      `  │  Login : ${config.bootstrap.email}`,
      `  │  Hasło : ${bootstrapPassword}`,
      '  │  Hasło należy zmienić przy pierwszym logowaniu.',
      '  └─────────────────────────────────────────────────────────────┘',
    );
  }
  lines.push('');
  process.stdout.write(lines.join('\n') + '\n');
}

function start() {
  ensureDirectories();
  const init = bootstrap();

  const server = createApp();

  server.listen(config.http.port, config.http.host, () => {
    banner(init);
    logger.info('Serwer uruchomiony', {
      host: config.http.host, port: config.http.port, env: config.env, version: APP_VERSION,
    });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${config.http.port} jest zajęty. Zmień PORT w pliku .env lub zatrzymaj drugą instancję.`);
    } else {
      logger.exception('Błąd serwera HTTP', err);
    }
    process.exit(1);
  });

  /* --- Zadania cykliczne --- */

  // Sprzątanie wygasłych sesji: przy starcie i raz na dobę.
  purgeExpiredSessions();
  const sessionTimer = setInterval(() => {
    const removed = purgeExpiredSessions();
    if (removed) logger.info('Usunięto wygasłe sesje', { removed });
  }, DAY_MS);
  sessionTimer.unref();

  // Dobowa kopia zapasowa bazy — pierwsza po godzinie od startu.
  const backupTimer = setInterval(() => {
    try {
      createBackup(null, 'auto');
    } catch (err) {
      logger.exception('Automatyczna kopia zapasowa nie powiodła się', err);
    }
  }, DAY_MS);
  backupTimer.unref();

  /* --- Zamykanie --- */
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Zatrzymywanie serwera', { signal });
    server.close(() => {
      closeDatabase();
      logger.info('Serwer zatrzymany');
      process.exit(0);
    });
    // Twarde zamknięcie, gdyby połączenia nie zdążyły się dokończyć.
    setTimeout(() => process.exit(0), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.exception('Nieobsłużone odrzucenie obietnicy', reason instanceof Error ? reason : new Error(String(reason)));
  });
  process.on('uncaughtException', (err) => {
    logger.exception('Nieprzechwycony wyjątek — zatrzymywanie procesu', err);
    shutdown('uncaughtException');
  });

  return server;
}

start();

import fs from 'node:fs';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { closeDb, getDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { logger } from './core/logger.js';
import { startBackupSchedule } from './core/backup.js';
import { prepareFirstRun } from './core/firstRun.js';
import { purgeExpiredTokens } from './modules/auth/auth.service.js';

function bootstrap(): void {
  fs.mkdirSync(env.dataDir, { recursive: true });
  fs.mkdirSync(env.attachmentsDir, { recursive: true });

  const db = getDb();
  const applied = runMigrations(db);
  if (applied.length === 0) logger.info('Schemat bazy danych jest aktualny.');

  // Role, uprawnienia, ustawienia i konto administratora. Bez tego kroku świeża
  // instalacja nie miałaby żadnego konta i nie dałoby się zalogować.
  const firstRun = prepareFirstRun(db);

  const app = createApp();
  const server = app.listen(env.port, env.host, () => {
    logger.info(`ResInvest ERP API nasłuchuje na http://${env.host}:${env.port} (${env.nodeEnv})`);
    logger.info(`Baza danych: ${env.databaseFile}`);

    // Powłoka desktopowa pokazuje dane pierwszego logowania w oknie programu,
    // dzięki czemu administrator nie musi szukać ich w pliku ani w dzienniku.
    if (firstRun && typeof process.send === 'function') {
      process.send({ type: 'first-run', login: firstRun.login, password: firstRun.password, file: firstRun.file });
    }
  });

  const stopBackups = startBackupSchedule(db);

  const purgeTimer = setInterval(() => {
    try {
      const removed = purgeExpiredTokens(db);
      if (removed > 0) logger.debug(`Usunięto ${removed} wygasłych tokenów sesji.`);
    } catch (err) {
      logger.error('Czyszczenie tokenów nie powiodło się', err);
    }
  }, 3_600_000);
  purgeTimer.unref?.();

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Otrzymano ${signal} - zamykanie serwera...`);
    stopBackups();
    clearInterval(purgeTimer);
    server.close(() => {
      closeDb();
      logger.info('Serwer zatrzymany.');
      process.exit(0);
    });
    // Awaryjne zamknięcie, jeśli otwarte połączenia nie zwolnia się w czasie.
    setTimeout(() => {
      closeDb();
      process.exit(1);
    }, 10_000).unref?.();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => logger.error('Nieobsłużone odrzucenie obietnicy', reason));
  process.on('uncaughtException', (err) => {
    logger.error('Nieprzechwycony wyjątek', err);
    shutdown('uncaughtException');
  });
}

bootstrap();

import fs from 'node:fs';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { closeDb, getDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { logger } from './core/logger.js';
import { startBackupSchedule } from './core/backup.js';
import { purgeExpiredTokens } from './modules/auth/auth.service.js';
import { ensureDefaultSettings } from './modules/settings/settings.service.js';

function bootstrap(): void {
  fs.mkdirSync(env.dataDir, { recursive: true });
  fs.mkdirSync(env.attachmentsDir, { recursive: true });

  const db = getDb();
  const applied = runMigrations(db);
  if (applied.length === 0) logger.info('Schemat bazy danych jest aktualny.');
  ensureDefaultSettings(db);

  const app = createApp();
  const server = app.listen(env.port, env.host, () => {
    logger.info(`ResInvest ERP API nasluchuje na http://${env.host}:${env.port} (${env.nodeEnv})`);
    logger.info(`Baza danych: ${env.databaseFile}`);
  });

  const stopBackups = startBackupSchedule(db);

  const purgeTimer = setInterval(() => {
    try {
      const removed = purgeExpiredTokens(db);
      if (removed > 0) logger.debug(`Usunieto ${removed} wygaslych tokenow sesji.`);
    } catch (err) {
      logger.error('Czyszczenie tokenow nie powiodlo sie', err);
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
    // Awaryjne zamkniecie, jesli otwarte polaczenia nie zwolnia sie w czasie.
    setTimeout(() => {
      closeDb();
      process.exit(1);
    }, 10_000).unref?.();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => logger.error('Nieobsluzone odrzucenie obietnicy', reason));
  process.on('uncaughtException', (err) => {
    logger.error('Nieprzechwycony wyjatek', err);
    shutdown('uncaughtException');
  });
}

bootstrap();

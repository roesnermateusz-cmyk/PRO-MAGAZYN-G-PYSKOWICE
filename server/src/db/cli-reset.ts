import fs from 'node:fs';
import { env } from '../config/env.js';
import { closeDb, getDb } from './index.js';
import { runMigrations } from './migrate.js';
import { seedAll } from './seed.js';
import { logger } from '../core/logger.js';

if (env.isProduction && !process.argv.includes('--force')) {
  logger.error('Reset bazy w srodowisku produkcyjnym wymaga flagi --force.');
  process.exit(1);
}

closeDb();
for (const suffix of ['', '-wal', '-shm']) {
  const file = `${env.databaseFile}${suffix}`;
  if (fs.existsSync(file)) {
    fs.rmSync(file);
    logger.info(`Usunieto ${file}`);
  }
}

const db = getDb();
runMigrations(db);
seedAll(db, {
  adminPassword: process.env.SEED_ADMIN_PASSWORD ?? 'Admin#2026',
  demoPassword: process.env.SEED_DEMO_PASSWORD ?? 'Demo#2026',
  withDemo: true,
});
logger.info('Baza danych zostala odtworzona wraz z danymi przykladowymi.');
closeDb();

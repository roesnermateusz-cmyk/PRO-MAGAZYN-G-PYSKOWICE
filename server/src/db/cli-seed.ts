import { getDb, closeDb } from './index.js';
import { runMigrations } from './migrate.js';
import { seedAll } from './seed.js';
import { logger } from '../core/logger.js';

const withDemo = !process.argv.includes('--core-only');
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'Admin#2026';
const demoPassword = process.env.SEED_DEMO_PASSWORD ?? 'Demo#2026';

const db = getDb();
runMigrations(db);
seedAll(db, { adminPassword, demoPassword, withDemo });

logger.info('--------------------------------------------------------------');
logger.info(' Konta poczatkowe:');
logger.info(`   admin / ${adminPassword}   (wymagana zmiana przy pierwszym logowaniu)`);
if (withDemo) {
  logger.info(`   manager, zabrze, braszewice, rokitki, podglad / ${demoPassword}`);
}
logger.info('--------------------------------------------------------------');

closeDb();

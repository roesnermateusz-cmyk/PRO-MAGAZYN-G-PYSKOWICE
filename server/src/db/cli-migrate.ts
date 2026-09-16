import { getDb, closeDb } from './index.js';
import { runMigrations } from './migrate.js';
import { ensureDefaultSettings } from '../modules/settings/settings.service.js';
import { logger } from '../core/logger.js';

const db = getDb();
const applied = runMigrations(db);
ensureDefaultSettings(db);
logger.info(applied.length > 0 ? `Zastosowano ${applied.length} migracji.` : 'Schemat jest aktualny.');
closeDb();

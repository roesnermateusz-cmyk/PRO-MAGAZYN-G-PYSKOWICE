import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { requireCtx } from '../../core/context.js';
import { asyncHandler } from '../../middleware/async.js';
import { requirePermission } from '../../middleware/auth.js';
import { parseBody } from '../../middleware/validate.js';
import { getAllSettings, setSetting, type SettingsKey } from './settings.service.js';
import { createBackup, listBackups } from '../../core/backup.js';
import { writeAudit } from '../../core/audit.js';

export const settingsRouter = Router();

/**
 * Ustawienia są czytane przez wszystkich zalogowanych (klient potrzebuje
 * przelicznikow i stawek do podpowiedzi), a zapisywane tylko przez administracje.
 */
settingsRouter.get(
  '/',
  asyncHandler((_req, res) => {
    res.json(getAllSettings(getDb()));
  }),
);

const updateSchema = z.object({
  key: z.enum(['company', 'conversion', 'rates', 'stockPolicy']),
  value: z.unknown(),
});

settingsRouter.put(
  '/',
  requirePermission('admin.settings'),
  asyncHandler((req, res) => {
    const { actor } = requireCtx(req);
    const { key, value } = parseBody(req, updateSchema);
    const db = getDb();
    const saved = db.transaction(() => setSetting(db, key as SettingsKey, value, actor)).immediate();
    res.json({ key, value: saved });
  }),
);

settingsRouter.get(
  '/backups',
  requirePermission('admin.backup'),
  asyncHandler((_req, res) => {
    res.json({ items: listBackups() });
  }),
);

settingsRouter.post(
  '/backups',
  requirePermission('admin.backup'),
  asyncHandler(async (req, res) => {
    const { actor } = requireCtx(req);
    const db = getDb();
    const backup = await createBackup(db, 'manual');
    db.transaction(() => {
      writeAudit(db, {
        actor,
        action: 'BACKUP',
        module: 'settings',
        entityType: 'backup',
        entityId: backup.fileName,
        entityLabel: backup.fileName,
        changes: [{ field: 'sizeBytes', before: null, after: backup.sizeBytes }],
      });
    })();
    res.status(201).json(backup);
  }),
);

/**
 * Trasy administracyjne: użytkownicy, ustawienia, okresy, kopie zapasowe,
 * dziennik audytu i załączniki.
 */
import { Router } from '../../lib/http.js';
import { guard, requireAuth, requirePermission } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { listAudit } from '../../middleware/audit.js';
import * as users from '../users/users.service.js';
import { getAllSettings, updateSettings } from '../settings/settings.service.js';
import { listPeriods, closePeriod, reopenPeriod } from '../periods/periods.service.js';
import * as backup from '../backup/backup.service.js';
import * as attachments from '../attachments/attachments.service.js';
import { cache } from '../../lib/cache.js';
import { metricsReport } from '../../lib/metrics.js';
import { databaseReport } from '../../db/health.js';

export function adminRoutes(prefix) {
  const r = new Router(prefix);

  /* --- Użytkownicy (tylko ADMIN ma `*`; KIEROWNIK ma podgląd) --- */
  r.get('/users', ...guard('users:read'), () => ({ items: users.listUsers() }));
  r.get('/users/:id', ...guard('users:read'), (ctx) => users.getUser(ctx.params.id));
  r.get('/users/:id/sessions', ...guard('users:read'),
    (ctx) => ({ items: users.listSessions(ctx.params.id) }));
  r.post('/users', requireAuth, requirePermission('users:write'), (ctx) => {
    ctx.status(201);
    return users.createUser(ctx.body, ctx);
  });
  r.patch('/users/:id', requireAuth, requirePermission('users:write'),
    (ctx) => users.updateUser(ctx.params.id, ctx.body, ctx));

  /* --- Diagnostyka wydajności ---
     Odpowiada na pytanie „dlaczego wolno działa” liczbami zamiast domysłów:
     najwolniejsze trasy, skuteczność pamięci podręcznej, rozmiar bazy
     i zgodność modelu odczytu z rejestrem ruchów. */
  r.get('/metrics', ...guard('settings:read'), () => ({
    ...metricsReport(),
    cache: cache.report(),
    database: databaseReport(),
  }));

  /* --- Ustawienia --- */
  r.get('/settings', ...guard('settings:read'), () => getAllSettings());
  r.put('/settings', ...guard('settings:write'), (ctx) => updateSettings(ctx.body, ctx.user.id));

  /* --- Okresy rozliczeniowe --- */
  r.get('/periods', ...guard('periods:read'), () => ({ items: listPeriods() }));
  r.post('/periods/:month/close', ...guard('periods:close'),
    (ctx) => closePeriod(ctx.params.month, ctx.body, ctx));
  r.post('/periods/:month/reopen', ...guard('periods:close'),
    (ctx) => reopenPeriod(ctx.params.month, ctx.body, ctx));

  /* --- Kopie zapasowe i wymiana danych --- */
  r.get('/backup/list', ...guard('backup:export'), () => ({ items: backup.listBackups() }));
  r.post('/backup/create', ...guard('backup:export'),
    rateLimit({ name: 'backup', max: 10, windowMs: 60 * 60_000 }),
    (ctx) => backup.createBackup(ctx, ctx.body?.label || 'reczna'));

  r.get('/backup/export.json', ...guard('backup:export'), (ctx) => ctx.sendFile({
    filename: `resinvest-kopia-${new Date().toISOString().slice(0, 10)}.json`,
    mime: 'application/json; charset=utf-8',
    body: JSON.stringify(backup.exportJson(ctx, { includeAudit: ctx.query.includeAudit === 'true' }), null, 2),
  }));

  r.post('/backup/import', ...guard('backup:import'), (ctx) => {
    // Kopia bezpieczeństwa przed importem — zawsze, bez wyjątku.
    backup.createBackup(ctx, 'przed-importem');
    return backup.importJson(ctx.body?.payload ?? ctx.body, { mode: ctx.body?.mode || 'merge' }, ctx);
  });

  /* --- Dziennik audytu --- */
  r.get('/audit', requireAuth, requirePermission('users:read'), (ctx) => listAudit(ctx.query));

  /* --- Załączniki (dostęp po identyfikatorze) --- */
  r.get('/attachments/:id', ...guard('attachments:read'),
    (ctx) => attachments.getAttachmentMeta(ctx.params.id));

  r.get('/attachments/:id/content', ...guard('attachments:read'), (ctx) => {
    const { meta, buffer } = attachments.readAttachment(ctx.params.id);
    ctx.sendFile({
      filename: meta.filename,
      mime: meta.mimeType,
      body: buffer,
      disposition: ctx.query.download === 'true' ? 'attachment' : 'inline',
      headers: {
        'Cache-Control': 'private, max-age=86400',
        // Skany są danymi użytkownika — nigdy nie interpretujemy ich jako HTML.
        'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; object-src 'none'",
      },
    });
  });

  r.delete('/attachments/:id', ...guard('attachments:write'),
    (ctx) => attachments.deleteAttachment(ctx.params.id, ctx));

  return r;
}

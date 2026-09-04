/**
 * Złożenie aplikacji: router API + serwowanie front-endu.
 *
 * Wersjonowanie: wszystkie trasy żyją pod `/api/v1`. Zmiany łamiące zgodność
 * trafią do `/api/v2`, a `/api/v1` pozostanie wspierane przez okres przejściowy —
 * dzięki temu integracje (księgowość, elektrownia) nie przestaną działać z dnia na dzień.
 */
import config from './config/env.js';
import { Router, createServer } from './lib/http.js';
import db from './db/index.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { operationRoutes } from './modules/operations/operations.routes.js';
import { catalogRoutes } from './modules/catalog/catalog.routes.js';
import { reportRoutes } from './modules/reports/reports.routes.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { ROLES, permissionsFor } from './middleware/auth.js';
import { OPERATION_TYPES, TYPE_LABELS, SERIES_BY_TYPE } from './domain/documents.js';
import { UNITS } from './domain/units.js';

export const API_PREFIX = '/api/v1';
export const APP_VERSION = '1.0.0';

/** Buduje router z kompletem tras API. */
export function buildRouter() {
  const router = new Router();

  /* --- Trasy publiczne (bez uwierzytelnienia) --- */

  /** Kontrola stanu — używana przez instalator, monitoring i skrypt startowy. */
  router.get(`${API_PREFIX}/health`, () => {
    const ok = db.value('SELECT 1') === 1;
    return {
      status: ok ? 'ok' : 'degraded',
      version: APP_VERSION,
      time: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
    };
  });

  /** Metadane potrzebne aplikacji klienckiej jeszcze przed zalogowaniem. */
  router.get(`${API_PREFIX}/meta`, () => ({
    version: APP_VERSION,
    company: config.company,
    roles: ROLES.map((role) => ({ role, permissions: permissionsFor(role) })),
    operationTypes: OPERATION_TYPES.map((type) => ({
      type, label: TYPE_LABELS[type], series: SERIES_BY_TYPE[type],
    })),
    units: UNITS,
    certificates: ['KZR', 'SURE', 'BRAK'],
    attachmentLimitMb: Math.round(config.attachments.maxBytes / 1024 / 1024),
  }));

  /* --- Trasy modułowe --- */
  router.merge(authRoutes(API_PREFIX));
  router.merge(operationRoutes(API_PREFIX));
  router.merge(catalogRoutes(API_PREFIX));
  router.merge(reportRoutes(API_PREFIX));
  router.merge(adminRoutes(API_PREFIX));

  return router;
}

/** Tworzy instancję serwera HTTP gotową do nasłuchu. */
export function createApp() {
  return createServer({
    router: buildRouter(),
    staticDir: config.webDir,
    apiPrefix: '/api',
    corsOrigins: config.http.corsOrigins,
    bodyLimitBytes: config.http.bodyLimitBytes,
    isProduction: config.isProduction,
  });
}

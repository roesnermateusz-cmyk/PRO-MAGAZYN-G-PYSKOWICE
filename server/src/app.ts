import fs from 'node:fs';
import path from 'node:path';
import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { env } from './config/env.js';
import { APP_VERSION } from './core/version.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { rateLimit } from './middleware/rateLimit.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { warehousesRouter } from './modules/warehouses/warehouses.routes.js';
import { productsRouter } from './modules/products/products.routes.js';
import { partnersRouter } from './modules/partners/partners.routes.js';
import { documentsRouter } from './modules/documents/documents.routes.js';
import { stockRouter } from './modules/stock/stock.routes.js';
import { reportsRouter } from './modules/reports/reports.routes.js';
import { auditRouter } from './modules/audit/audit.routes.js';
import { settingsRouter } from './modules/settings/settings.routes.js';
import { attachmentsRouter } from './modules/attachments/attachments.routes.js';

export function createApp(): Express {
  const app = express();

  if (env.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // Aplikacja kliencką serwowana jest jako statyczny build z tego samego
      // origin; polityka CSP dopuszcza wyłącznie zasoby własne.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", ...env.corsOrigins],
          objectSrc: ["'none'"],
          frameAncestors: ["'self'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Zapytania bez naglowka Origin (np. narzedzia serwerowe, aplikacja
        // desktopowa) są dopuszczane; przeglądarkowe tylko z listy dozwolonych.
        if (!origin || env.corsOrigins.includes(origin)) callback(null, true);
        else callback(new Error(`Origin ${origin} nie jest dozwolony przez polityke CORS.`));
      },
      credentials: false,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Warehouse-Id'],
      exposedHeaders: ['Content-Disposition'],
    }),
  );

  app.use(compression());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  const api = Router();
  api.use(rateLimit({ windowMs: 60_000, max: 600, keyPrefix: 'api' }));

  api.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: APP_VERSION, time: new Date().toISOString() });
  });

  api.use('/auth', authRouter);

  // Wszystkie ponizsze trasy wymagaja uwierzytelnienia.
  api.use(authenticate);
  api.use('/users', usersRouter);
  api.use('/warehouses', warehousesRouter);
  api.use('/products', productsRouter);
  api.use('/partners', partnersRouter);
  api.use('/documents', documentsRouter);
  api.use('/stock', stockRouter);
  api.use('/reports', reportsRouter);
  api.use('/audit', auditRouter);
  api.use('/settings', settingsRouter);
  api.use('/', attachmentsRouter);

  app.use('/api', api);

  if (env.serveClient && fs.existsSync(env.clientDist)) {
    app.use(express.static(env.clientDist, { index: false, maxAge: '1h' }));
    // Aplikacja jednostronicowa - wszystkie ścieżki poza /api zwracaja index.html.
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(env.clientDist, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

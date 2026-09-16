import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { env } from '../config/env.js';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Nie znaleziono zasobu: ${req.method} ${req.path}` },
  });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Dane wejściowe nie przeszly walidacji.',
        details: err.flatten(),
      },
    });
    return;
  }

  const anyErr = err as { code?: string; message?: string; status?: number };

  if (anyErr?.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: `Plik przekracza limit ${env.maxUploadMb} MB.` },
    });
    return;
  }

  if (typeof anyErr?.code === 'string' && anyErr.code.startsWith('SQLITE_CONSTRAINT')) {
    res.status(409).json({
      error: {
        code: 'CONFLICT',
        message: 'Operacja narusza ograniczenia spójności danych.',
        details: env.isProduction ? null : anyErr.message,
      },
    });
    return;
  }

  logger.error('Nieobsłużony błąd żądania', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Wystapil nieoczekiwany błąd serwera.',
      details: env.isProduction ? null : String(anyErr?.message ?? err),
    },
  });
};

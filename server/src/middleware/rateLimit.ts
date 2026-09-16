import type { RequestHandler } from 'express';
import { AppError } from '../core/errors.js';
import { clientIp } from '../core/context.js';
import { env } from '../config/env.js';

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyPrefix?: string;
  /**
   * Limity sa domyslnie wylaczone w srodowisku testowym, poniewaz zestaw
   * testow wykonuje wiele logowan z jednego adresu. Testy samego limitera
   * tworza go z flaga enforceInTests.
   */
  enforceInTests?: boolean;
}

/**
 * Prosty licznik zadan w oknie czasowym, trzymany w pamieci procesu.
 * Chroni endpointy logowania przed atakiem slownikowym.
 */
export function rateLimit(options: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, Bucket>();
  const { windowMs, max, keyPrefix = '', enforceInTests = false } = options;

  if (env.isTest && !enforceInTests) {
    return (_req, _res, next) => next();
  }

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, windowMs);
  sweep.unref?.();

  return (req, res, next) => {
    const key = `${keyPrefix}:${clientIp(req)}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      next(
        new AppError(
          429,
          'RATE_LIMITED',
          `Przekroczono limit zadan. Sprobuj ponownie za ${retryAfter} s.`,
        ),
      );
      return;
    }
    next();
  };
}

import type { Request } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { badRequest } from '../core/errors.js';

export function parseBody<T extends ZodTypeAny>(req: Request, schema: T): z.infer<T> {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    throw badRequest('Dane wejsciowe nie przeszly walidacji.', result.error.flatten());
  }
  return result.data;
}

export function parseQuery<T extends ZodTypeAny>(req: Request, schema: T): z.infer<T> {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    throw badRequest('Nieprawidlowe parametry zapytania.', result.error.flatten());
  }
  return result.data;
}

export function parseIdParam(req: Request, name = 'id'): number {
  const raw = req.params[name];
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw badRequest(`Parametr "${name}" musi byc dodatnia liczba calkowita.`);
  }
  return parsed;
}

import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Opakowuje asynchroniczny handler tak, aby odrzucone obietnice trafialy
 * do centralnego middleware bledow zamiast konczyc proces.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

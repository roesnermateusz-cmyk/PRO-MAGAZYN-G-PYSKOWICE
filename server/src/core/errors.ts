/**
 * Kody błędów są stabilnym kontraktem API - klient tlumaczy je na komunikaty
 * w jezyku użytkownika, dlatego nie zmieniamy ich bez wersjonowania API.
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_INACTIVE'
  | 'TOKEN_EXPIRED'
  | 'FORBIDDEN'
  | 'WAREHOUSE_FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DUPLICATE'
  | 'VERSION_CONFLICT'
  | 'INSUFFICIENT_STOCK'
  | 'INVALID_STATE'
  | 'IN_USE'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details ?? null;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'VALIDATION_ERROR', message, details);

export const unauthenticated = (message = 'Wymagane uwierzytelnienie.', code: ErrorCode = 'UNAUTHENTICATED') =>
  new AppError(401, code, message);

export const forbidden = (message = 'Brak uprawnień do wykonania operacji.', code: ErrorCode = 'FORBIDDEN') =>
  new AppError(403, code, message);

export const notFound = (message = 'Nie znaleziono zasobu.') =>
  new AppError(404, 'NOT_FOUND', message);

export const conflict = (message: string, code: ErrorCode = 'CONFLICT', details?: unknown) =>
  new AppError(409, code, message, details);

export const insufficientStock = (message: string, details?: unknown) =>
  new AppError(409, 'INSUFFICIENT_STOCK', message, details);

export const invalidState = (message: string) =>
  new AppError(409, 'INVALID_STATE', message);

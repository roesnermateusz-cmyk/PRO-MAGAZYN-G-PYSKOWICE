/**
 * Ujednolicona hierarchia błędów aplikacji.
 *
 * Każdy błąd, który ma trafić do klienta jako kontrolowana odpowiedź HTTP,
 * dziedziczy po `AppError`. Wszystko inne jest traktowane jako błąd 500
 * i zapisywane w dzienniku bez ujawniania szczegółów użytkownikowi.
 */
export class AppError extends Error {
  /**
   * @param {number} status kod HTTP
   * @param {string} code maszynowy kod błędu (np. `VALIDATION_ERROR`)
   * @param {string} message komunikat dla użytkownika (po polsku)
   * @param {object} [details] dodatkowe informacje (np. lista pól)
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  toJSON() {
    const body = { error: { code: this.code, message: this.message } };
    if (this.details !== undefined) body.error.details = this.details;
    return body;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Dane wejściowe są nieprawidłowe.', details) {
    super(422, 'VALIDATION_ERROR', message, details);
    this.name = 'ValidationError';
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Nieprawidłowe żądanie.', details) {
    super(400, 'BAD_REQUEST', message, details);
    this.name = 'BadRequestError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Wymagane zalogowanie.') {
    super(401, 'UNAUTHORIZED', message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Brak uprawnień do wykonania tej operacji.') {
    super(403, 'FORBIDDEN', message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Nie znaleziono zasobu.') {
    super(404, 'NOT_FOUND', message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Operacja koliduje z aktualnym stanem danych.', details) {
    super(409, 'CONFLICT', message, details);
    this.name = 'ConflictError';
  }
}

/** Okres rozliczeniowy zamknięty — zapis do niego jest zabroniony. */
export class PeriodClosedError extends AppError {
  constructor(month) {
    super(409, 'PERIOD_CLOSED', `Okres ${month} jest zamknięty — zapis wymaga otwarcia okresu przez kierownika.`);
    this.name = 'PeriodClosedError';
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = 'Przesłane dane są zbyt duże.') {
    super(413, 'PAYLOAD_TOO_LARGE', message);
    this.name = 'PayloadTooLargeError';
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Zbyt wiele żądań — spróbuj ponownie za chwilę.', retryAfterSec = 60) {
    super(429, 'TOO_MANY_REQUESTS', message, { retryAfterSec });
    this.name = 'TooManyRequestsError';
  }
}

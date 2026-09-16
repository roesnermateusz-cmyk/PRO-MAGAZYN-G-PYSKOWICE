import type { ApiErrorBody } from './types';

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';
const REFRESH_STORAGE_KEY = 'resinvest.refreshToken';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details ?? null;
  }
}

/**
 * Token dostępu trzymany jest wyłącznie w pamięci karty - nie trafia do
 * localStorage, więc nie da się go odczytać skryptem po zamknięciu sesji.
 * Trwaly jest tylko token odświeżania, który podlega rotacji przy każdym użyciu.
 */
let accessToken: string | null = null;
let warehouseId: number | null = null;
let onUnauthenticated: (() => void) | null = null;
let refreshPromise: Promise<boolean> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setRefreshToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(REFRESH_STORAGE_KEY, token);
    else localStorage.removeItem(REFRESH_STORAGE_KEY);
  } catch {
    // Tryb prywatny przeglądarki - sesja będzie działać tylko do przeładowania.
  }
}

export function setActiveWarehouse(id: number | null): void {
  warehouseId = id;
}

export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  onUnauthenticated = handler;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  /** Pomija automatyczna próbę odświeżenia sesji (używane przez /auth/refresh). */
  skipRefresh?: boolean;
  signal?: AbortSignal;
  formData?: FormData;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${BASE_URL}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function parseError(response: Response): Promise<ApiError> {
  let code = 'INTERNAL_ERROR';
  let message = `Błąd ${response.status}`;
  let details: unknown = null;
  try {
    const body = (await response.json()) as ApiErrorBody;
    if (body?.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
      details = body.error.details ?? null;
    }
  } catch {
    // Odpowiedz bez treści JSON - zostawiamy komunikat domyślny.
  }
  return new ApiError(response.status, code, message, details);
}

/** Odswieza sesje; równolegle żądania wspoldziela jedna próbę odświeżenia. */
async function refreshSession(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  const token = getRefreshToken();
  if (!token) return false;

  refreshPromise = (async () => {
    try {
      const response = await fetch(buildUrl('/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: token }),
      });
      if (!response.ok) {
        setRefreshToken(null);
        setAccessToken(null);
        return false;
      }
      const data = (await response.json()) as { accessToken: string; refreshToken: string };
      setAccessToken(data.accessToken);
      setRefreshToken(data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, skipRefresh, signal, formData } = options;

  const execute = async (): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (warehouseId !== null) headers['X-Warehouse-Id'] = String(warehouseId);
    if (!formData && body !== undefined) headers['Content-Type'] = 'application/json';

    return fetch(buildUrl(path, query), {
      method,
      headers,
      body: formData ?? (body === undefined ? undefined : JSON.stringify(body)),
      signal,
    });
  };

  let response: Response;
  try {
    response = await execute();
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', 'Brak połączenia z serwerem.');
  }

  if (response.status === 401 && !skipRefresh) {
    const refreshed = await refreshSession();
    if (refreshed) {
      try {
        response = await execute();
      } catch {
        throw new ApiError(0, 'NETWORK', 'Brak połączenia z serwerem.');
      }
    } else {
      onUnauthenticated?.();
      throw await parseError(response);
    }
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) return (await response.json()) as T;
  return (await response.text()) as unknown as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal) =>
    request<T>(path, { method: 'GET', query, signal }),
  post: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    request<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData) => request<T>(path, { method: 'POST', formData }),

  /** Pobiera plik (eksport CSV, załącznik) z zachowaniem naglowkow autoryzacji. */
  async download(path: string, query?: RequestOptions['query'], fallbackName = 'plik'): Promise<void> {
    const headers: Record<string, string> = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (warehouseId !== null) headers['X-Warehouse-Id'] = String(warehouseId);

    let response = await fetch(buildUrl(path, query), { headers });
    if (response.status === 401 && (await refreshSession())) {
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      response = await fetch(buildUrl(path, query), { headers });
    }
    if (!response.ok) throw await parseError(response);

    const disposition = response.headers.get('content-disposition') ?? '';
    const match = /filename="?([^"]+)"?/.exec(disposition);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = match?.[1] ?? fallbackName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  },

  /** Zwraca adres obiektowy załącznika (podgląd w nowej karcie). */
  async attachmentUrl(attachmentId: string): Promise<string> {
    const headers: Record<string, string> = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    let response = await fetch(buildUrl(`/attachments/${attachmentId}`), { headers });
    if (response.status === 401 && (await refreshSession())) {
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      response = await fetch(buildUrl(`/attachments/${attachmentId}`), { headers });
    }
    if (!response.ok) throw await parseError(response);
    return URL.createObjectURL(await response.blob());
  },
};

export { refreshSession };

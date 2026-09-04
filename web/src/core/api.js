/**
 * Klient API.
 *
 * Obsługuje: nagłówek Bearer, automatyczne odświeżanie wygasłego tokenu
 * (jedno wspólne odświeżenie dla równoległych żądań) oraz spójne błędy.
 * Token odświeżania trzymamy w `localStorage`, token dostępu tylko w pamięci —
 * krótki czas życia zmniejsza skutki ewentualnego wycieku.
 */

const BASE = '/api/v1';
const REFRESH_KEY = 'resinvest.refresh';

let accessToken = null;
let refreshPromise = null;
const listeners = new Set();

/** Błąd API z zachowaniem kodu i szczegółów walidacji. */
export class ApiError extends Error {
  constructor(status, body) {
    const error = body?.error ?? {};
    super(error.message || `Błąd komunikacji z serwerem (HTTP ${status}).`);
    this.name = 'ApiError';
    this.status = status;
    this.code = error.code || 'HTTP_ERROR';
    this.details = error.details || [];
  }

  /** Czy błąd dotyczy pól formularza. */
  get isValidation() {
    return this.code === 'VALIDATION_ERROR' && Array.isArray(this.details);
  }
}

export const getRefreshToken = () => localStorage.getItem(REFRESH_KEY);

export function setTokens({ accessToken: access, refreshToken } = {}) {
  accessToken = access ?? null;
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
}

export function clearTokens() {
  accessToken = null;
  localStorage.removeItem(REFRESH_KEY);
}

/** Rejestruje reakcję na utratę sesji (przekierowanie na ekran logowania). */
export function onUnauthorized(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyUnauthorized() {
  clearTokens();
  listeners.forEach((fn) => fn());
}

/** Odświeża token dostępu; równoległe wywołania współdzielą jedno żądanie. */
async function refreshAccess() {
  const token = getRefreshToken();
  if (!token) throw new ApiError(401, { error: { code: 'UNAUTHORIZED', message: 'Brak aktywnej sesji.' } });

  if (!refreshPromise) {
    refreshPromise = fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: token }),
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new ApiError(res.status, body);
        setTokens(body);
        return body;
      })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

/**
 * Wykonuje żądanie do API.
 *
 * @param {string} path ścieżka względem `/api/v1`
 * @param {{method?:string, body?:any, query?:object, raw?:boolean, retry?:boolean}} [options]
 */
export async function request(path, options = {}) {
  const { method = 'GET', body, query, raw = false, retry = true } = options;

  let url = BASE + path;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') params.set(k, v);
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // Wygasły token dostępu — odśwież i ponów raz.
  if (res.status === 401 && retry && getRefreshToken()) {
    try {
      await refreshAccess();
      return await request(path, { ...options, retry: false });
    } catch {
      notifyUnauthorized();
      throw new ApiError(401, { error: { code: 'UNAUTHORIZED', message: 'Sesja wygasła — zaloguj się ponownie.' } });
    }
  }

  if (raw) {
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
    return res;
  }

  if (res.status === 204) return null;

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) notifyUnauthorized();
    throw new ApiError(res.status, payload);
  }
  return payload;
}

export const api = {
  get: (path, query) => request(path, { query }),
  post: (path, body) => request(path, { method: 'POST', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  delete: (path) => request(path, { method: 'DELETE' }),

  /**
   * Pobiera plik z API i zapisuje go na dysku użytkownika.
   * Nazwę bierze z nagłówka `Content-Disposition`, a gdy go brak — z argumentu.
   */
  async download(path, query, fallbackName = 'plik') {
    const res = await request(path, { query, raw: true });
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = /filename="?([^"]+)"?/.exec(disposition);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = match ? decodeURIComponent(match[1]) : fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },

  /** Zwraca zawartość załącznika jako obiekt URL (podgląd w lightboxie). */
  async attachmentUrl(id) {
    const res = await request(`/attachments/${encodeURIComponent(id)}/content`, { raw: true });
    return URL.createObjectURL(await res.blob());
  },
};

export default api;

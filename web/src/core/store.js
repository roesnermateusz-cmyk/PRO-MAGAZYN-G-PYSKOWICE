/**
 * Stan sesji aplikacji klienckiej.
 *
 * Trzyma zalogowanego użytkownika, metadane systemu i pamięć podręczną
 * kartotek (produkty, kontrahenci, magazyny) — te ostatnie zmieniają się
 * rzadko, a formularz operacji potrzebuje ich przy każdym otwarciu.
 */
import api, { setTokens, clearTokens, getRefreshToken } from './api.js';

export const store = {
  user: null,
  meta: null,
  catalog: null,
  settings: null,
};

const subscribers = new Set();

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function emit() {
  subscribers.forEach((fn) => fn(store));
}

/** Czy zalogowany użytkownik ma dane uprawnienie. */
export function can(permission) {
  const perms = store.user?.permissions ?? [];
  return perms.includes('*') || perms.includes(permission);
}

/** Metadane publiczne (dostępne również przed zalogowaniem). */
export async function loadMeta() {
  if (!store.meta) store.meta = await api.get('/meta');
  return store.meta;
}

/** Odtworzenie sesji po odświeżeniu strony (na podstawie tokenu odświeżania). */
export async function restoreSession() {
  if (!getRefreshToken()) return null;
  try {
    const res = await api.post('/auth/refresh', { refreshToken: getRefreshToken() });
    setTokens(res);
    store.user = res.user;
    emit();
    return store.user;
  } catch {
    clearTokens();
    return null;
  }
}

export async function login(email, password) {
  const res = await api.post('/auth/login', { email, password });
  setTokens(res);
  store.user = res.user;
  store.catalog = null;
  emit();
  return store.user;
}

export async function logout() {
  try {
    await api.post('/auth/logout', { refreshToken: getRefreshToken() });
  } catch {
    // Wylogowanie lokalne musi się udać nawet przy braku łączności.
  }
  clearTokens();
  store.user = null;
  store.catalog = null;
  store.settings = null;
  emit();
}

/** Kartoteki do formularzy; `force` wymusza ponowne pobranie po edycji słownika. */
export async function loadCatalog(force = false) {
  if (force || !store.catalog) store.catalog = await api.get('/catalog');
  return store.catalog;
}

export function invalidateCatalog() {
  store.catalog = null;
}

export async function loadSettings(force = false) {
  if (force || !store.settings) store.settings = await api.get('/settings');
  return store.settings;
}

/** Aktualizuje dane zalogowanego użytkownika (np. po zmianie hasła). */
export async function refreshUser() {
  store.user = await api.get('/auth/me');
  emit();
  return store.user;
}

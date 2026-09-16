import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  api,
  ApiError,
  getRefreshToken,
  setAccessToken,
  setActiveWarehouse,
  setRefreshToken,
  setUnauthenticatedHandler,
} from '../api/client';
import type { AppSettings, LoginResponse, SessionResponse, SessionUser, WarehouseBrief } from '../api/types';
import { useI18n } from '../i18n';
import { useTheme } from './ThemeContext';

const WAREHOUSE_STORAGE_KEY = 'resinvest.warehouseId';

interface AuthValue {
  status: 'loading' | 'anonymous' | 'authenticated';
  user: SessionUser | null;
  warehouses: WarehouseBrief[];
  warehouseId: number | null;
  warehouse: WarehouseBrief | null;
  settings: AppSettings | null;
  login: (login: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  selectWarehouse: (id: number | null) => Promise<void>;
  refreshSettings: () => Promise<void>;
  reloadSession: () => Promise<void>;
  can: (permission: string) => boolean;
  canAny: (...permissions: string[]) => boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

function readStoredWarehouse(): number | null {
  try {
    const raw = localStorage.getItem(WAREHOUSE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function storeWarehouse(id: number | null): void {
  try {
    if (id === null) localStorage.removeItem(WAREHOUSE_STORAGE_KEY);
    else localStorage.setItem(WAREHOUSE_STORAGE_KEY, String(id));
  } catch {
    // Brak dostępu do localStorage - wybor magazynu nie przetrwa przeładowania.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { setLocale } = useI18n();
  const { setPreference } = useTheme();

  const [status, setStatus] = useState<AuthValue['status']>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseBrief[]>([]);
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setRefreshToken(null);
    setActiveWarehouse(null);
    storeWarehouse(null);
    setUser(null);
    setWarehouses([]);
    setWarehouseId(null);
    setSettings(null);
    setStatus('anonymous');
  }, []);

  useEffect(() => {
    setUnauthenticatedHandler(clearSession);
    return () => setUnauthenticatedHandler(null);
  }, [clearSession]);

  const applySession = useCallback(
    (session: SessionResponse) => {
      setUser(session.user);
      setWarehouses(session.warehouses);
      setLocale(session.user.locale);
      setPreference(session.user.theme);

      // Wybor magazynu: zapamietany -> domyślny użytkownika -> jedyny dostępny.
      const allowed = new Set(session.warehouses.map((w) => w.id));
      const stored = readStoredWarehouse();
      const candidate =
        stored && allowed.has(stored)
          ? stored
          : session.user.defaultWarehouseId && allowed.has(session.user.defaultWarehouseId)
            ? session.user.defaultWarehouseId
            : session.warehouses.length === 1
              ? (session.warehouses[0] as WarehouseBrief).id
              : null;

      setWarehouseId(candidate);
      setActiveWarehouse(candidate);
      storeWarehouse(candidate);
      setStatus('authenticated');
    },
    [setLocale, setPreference],
  );

  const loadSettings = useCallback(async () => {
    try {
      setSettings(await api.get<AppSettings>('/settings'));
    } catch {
      // Ustawienia są opcjonalne dla działania interfejsu - uzyjemy domyślnych.
      setSettings(null);
    }
  }, []);

  const reloadSession = useCallback(async () => {
    const session = await api.get<SessionResponse>('/auth/me');
    applySession(session);
  }, [applySession]);

  // Odtworzenie sesji po przeładowaniu strony na podstawie tokenu odświeżania.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!getRefreshToken()) {
        setStatus('anonymous');
        return;
      }
      try {
        const data = await api.post<LoginResponse>(
          '/auth/refresh',
          { refreshToken: getRefreshToken() },
          { skipRefresh: true },
        );
        if (cancelled) return;
        setAccessToken(data.accessToken);
        setRefreshToken(data.refreshToken);
        applySession(data);
        await loadSettings();
      } catch {
        if (!cancelled) clearSession();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applySession, clearSession, loadSettings]);

  const login = useCallback(
    async (loginName: string, password: string) => {
      const data = await api.post<LoginResponse>('/auth/login', { login: loginName, password }, { skipRefresh: true });
      setAccessToken(data.accessToken);
      setRefreshToken(data.refreshToken);
      applySession(data);
      await loadSettings();
    },
    [applySession, loadSettings],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', { refreshToken: getRefreshToken() ?? undefined });
    } catch (err) {
      // Wylogowanie lokalne musi się powiesc nawet przy braku sieci.
      if (!(err instanceof ApiError)) throw err;
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const selectWarehouse = useCallback(
    async (id: number | null) => {
      setWarehouseId(id);
      setActiveWarehouse(id);
      storeWarehouse(id);
      if (id !== null) {
        // Zmiana magazynu roboczego jest odnotowywana w historii zmian.
        try {
          await api.post('/auth/me/warehouse', { warehouseId: id });
        } catch {
          // Brak wpisu audytowego nie może blokować pracy użytkownika.
        }
      }
    },
    [],
  );

  const can = useCallback(
    (permission: string) => Boolean(user?.permissions.includes(permission)),
    [user],
  );

  const value = useMemo<AuthValue>(
    () => ({
      status,
      user,
      warehouses,
      warehouseId,
      warehouse: warehouses.find((w) => w.id === warehouseId) ?? null,
      settings,
      login,
      logout,
      selectWarehouse,
      refreshSettings: loadSettings,
      reloadSession,
      can,
      canAny: (...permissions: string[]) => permissions.some((p) => can(p)),
    }),
    [status, user, warehouses, warehouseId, settings, login, logout, selectWarehouse, loadSettings, reloadSession, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth musi być użyte wewnątrz AuthProvider.');
  return ctx;
}

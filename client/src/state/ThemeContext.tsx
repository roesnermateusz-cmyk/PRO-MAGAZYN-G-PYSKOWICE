import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'resinvest.theme';

interface ThemeValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (value: ThemePreference) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

function readStored(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    // Brak dostępu do pamięci - uzywamy ustawienia systemowego.
  }
  return 'system';
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStored);
  const [systemValue, setSystemValue] = useState<ResolvedTheme>(systemTheme);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return undefined;
    const listener = (event: MediaQueryListEvent) => setSystemValue(event.matches ? 'dark' : 'light');
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);

  const resolved: ResolvedTheme = preference === 'system' ? systemValue : preference;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved);
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', resolved === 'dark' ? '#0e1520' : '#ffffff');
  }, [resolved]);

  const setPreference = useCallback((value: ThemePreference) => {
    setPreferenceState(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Ignorujemy brak dostępu do localStorage.
    }
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({
      preference,
      resolved,
      setPreference,
      toggle: () => setPreference(resolved === 'dark' ? 'light' : 'dark'),
    }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme musi być użyte wewnątrz ThemeProvider.');
  return ctx;
}

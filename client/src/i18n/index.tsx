import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { pl, type Dictionary, type TranslationKey } from './pl';
import { cs } from './cs';
import { en } from './en';

export type Locale = 'pl' | 'cs' | 'en';

export const LOCALES: Array<{ code: Locale; label: string; intl: string }> = [
  { code: 'pl', label: 'Polski', intl: 'pl-PL' },
  { code: 'cs', label: 'Cestina', intl: 'cs-CZ' },
  { code: 'en', label: 'English', intl: 'en-GB' },
];

const DICTIONARIES: Record<Locale, Dictionary> = { pl, cs, en };
const STORAGE_KEY = 'resinvest.locale';

export type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
  intlLocale: string;
}

const I18nContext = createContext<I18nValue | null>(null);

function readStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'pl' || stored === 'cs' || stored === 'en') return stored;
  } catch {
    // Brak dostępu do pamięci przeglądarki nie może blokować aplikacji.
  }
  return 'pl';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readStoredLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignorujemy brak dostępu do localStorage (tryb prywatny).
    }
  }, []);

  const t = useCallback<Translate>(
    (key, params) => {
      const dictionary = DICTIONARIES[locale];
      // Brak tlumaczenia cofa się do polskiego, a w ostateczności zwraca klucz.
      let text: string = dictionary[key] ?? pl[key] ?? key;
      if (params) {
        for (const [name, value] of Object.entries(params)) {
          text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
        }
      }
      return text;
    },
    [locale],
  );

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      t,
      intlLocale: LOCALES.find((l) => l.code === locale)?.intl ?? 'pl-PL',
    }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n musi być użyte wewnątrz I18nProvider.');
  return ctx;
}

/** Skrót na potrzeby komponentów, które potrzebują wyłącznie funkcji t(). */
export function useT(): Translate {
  return useI18n().t;
}

export type { TranslationKey };

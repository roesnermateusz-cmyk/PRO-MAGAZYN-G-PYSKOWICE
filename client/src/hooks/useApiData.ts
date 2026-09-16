import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { useI18n, type TranslationKey } from '../i18n';

export interface ApiDataState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Tlumaczy błąd API na komunikat w jezyku użytkownika. */
export function useApiErrorMessage(): (error: unknown) => string {
  const { t } = useI18n();
  return useCallback(
    (error: unknown) => {
      if (error instanceof ApiError) {
        const key = `error.${error.code}` as TranslationKey;
        const translated = t(key);
        // Gdy kod nie ma tlumaczenia, pokazujemy komunikat serwera.
        return translated === key ? error.message : `${translated}${error.message ? ` (${error.message})` : ''}`;
      }
      if (error instanceof Error) return error.message;
      return String(error);
    },
    [t],
  );
}

/**
 * Pobiera dane z API z obsługa anulowania. Zmiana `deps` uruchamia ponowne
 * pobranie, a wynik poprzedniego żądania jest odrzucany (brak wyścigu).
 */
export function useApiData<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
  options: { enabled?: boolean } = {},
): ApiDataState<T> {
  const enabled = options.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const toMessage = useApiErrorMessage();
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);

    loaderRef
      .current(controller.signal)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((err) => {
        if (!active || (err as Error).name === 'AbortError') return;
        setError(toMessage(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, enabled]);

  return { data, loading, error, reload: () => setNonce((n) => n + 1) };
}

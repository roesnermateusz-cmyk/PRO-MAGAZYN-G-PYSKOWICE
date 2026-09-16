import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n';

export type ToastKind = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
}

interface ToastValue {
  toasts: Toast[];
  push: (kind: ToastKind, title: string, message?: string) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

const AUTO_DISMISS_MS: Record<ToastKind, number> = {
  success: 4000,
  info: 5000,
  warning: 8000,
  // Błędy pozostają do ręcznego zamknięcia - użytkownik musi je odczytać.
  error: 0,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, title: string, message?: string) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev.slice(-4), { id, kind, title, message }]);
      const timeout = AUTO_DISMISS_MS[kind];
      if (timeout > 0) window.setTimeout(() => dismiss(id), timeout);
    },
    [dismiss],
  );

  const value = useMemo<ToastValue>(
    () => ({
      toasts,
      push,
      dismiss,
      success: (title, message) => push('success', title, message),
      error: (title, message) => push('error', title, message),
    }),
    [toasts, push, dismiss],
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast musi być użyte wewnątrz ToastProvider.');
  return ctx;
}

export function ToastViewport() {
  const { toasts, dismiss } = useToast();
  const { t } = useI18n();
  if (toasts.length === 0) return null;

  return (
    <div className="toasts" role="region" aria-live="polite" aria-label={t('dashboard.alertsSection')}>
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="toast-title">{toast.title}</div>
            {toast.message ? <div className="text-sm muted">{toast.message}</div> : null}
          </div>
          <button type="button" className="btn ghost sm" onClick={() => dismiss(toast.id)} aria-label={t('action.close')}>
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}

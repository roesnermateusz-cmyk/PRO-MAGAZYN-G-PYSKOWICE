import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/**
 * Ostatnia linia obrony przed białym ekranem: nieprzechwycony błąd renderowania
 * pokazuje czytelny komunikat zamiast pustej strony.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Błąd renderowania interfejsu', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="auth-screen">
        <div className="auth-card" style={{ maxWidth: 560 }}>
          <h1 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-2)' }}>
            Wystąpił nieoczekiwany błąd aplikacji
          </h1>
          <p className="muted text-sm">
            Odśwież stronę. Jeśli problem się powtarza, przekaż administratorowi poniższy komunikat.
          </p>
          <pre
            className="mono text-xs"
            style={{
              whiteSpace: 'pre-wrap',
              background: 'var(--bg-sunken)',
              padding: 'var(--space-3)',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              maxHeight: 220,
              overflow: 'auto',
            }}
          >
            {error.message}
          </pre>
          <button type="button" className="btn primary block" onClick={() => window.location.reload()}>
            Odśwież stronę
          </button>
        </div>
      </div>
    );
  }
}

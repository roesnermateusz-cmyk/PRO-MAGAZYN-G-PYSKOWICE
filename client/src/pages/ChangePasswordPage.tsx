import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { useAuth } from '../state/AuthContext';
import { useI18n } from '../i18n';
import { useApiErrorMessage } from '../hooks/useApiData';
import { Alert, Button, TextInput } from '../components/ui';

/**
 * Wymuszona zmiana hasła. Po zapisie serwer unieważnia wszystkie sesje,
 * dlatego użytkownik loguje się ponownie nowym haslem.
 */
export function ChangePasswordPage() {
  const { t } = useI18n();
  const { logout } = useAuth();
  const toMessage = useApiErrorMessage();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    if (next !== repeat) {
      setError(t('auth.passwordMismatch'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/auth/me/password', { currentPassword: current, newPassword: next });
      setDone(true);
      window.setTimeout(() => {
        void logout();
      }, 1800);
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-logo" aria-hidden="true">
            RI
          </div>
          <h1 style={{ fontSize: 'var(--text-lg)' }}>{t('action.changePassword')}</h1>
        </div>

        {done ? (
          <Alert tone="success">{t('auth.passwordChanged')}</Alert>
        ) : (
          <>
            <Alert tone="warning">{t('auth.mustChangePassword')}</Alert>
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <form onSubmit={handleSubmit} noValidate>
              <TextInput
                label={t('auth.currentPassword')}
                type="password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
                autoComplete="current-password"
                required
              />
              <TextInput
                label={t('auth.newPassword')}
                type="password"
                value={next}
                onChange={(event) => setNext(event.target.value)}
                autoComplete="new-password"
                hint={t('auth.passwordRules')}
                required
              />
              <TextInput
                label={t('auth.repeatPassword')}
                type="password"
                value={repeat}
                onChange={(event) => setRepeat(event.target.value)}
                autoComplete="new-password"
                error={repeat !== '' && repeat !== next ? t('auth.passwordMismatch') : undefined}
                required
              />
              <Button
                type="submit"
                variant="primary"
                block
                loading={submitting}
                disabled={current === '' || next.length < 10 || next !== repeat}
                style={{ marginTop: 'var(--space-3)' }}
              >
                {t('action.save')}
              </Button>
            </form>
            <div className="auth-footer">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void logout();
                }}
              >
                {t('action.logout')}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

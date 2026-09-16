import { useState, type FormEvent } from 'react';
import { useAuth } from '../state/AuthContext';
import { useI18n, LOCALES } from '../i18n';
import { useTheme } from '../state/ThemeContext';
import { useApiErrorMessage } from '../hooks/useApiData';
import { Alert, Button, TextInput } from '../components/ui';

export function LoginPage() {
  const { t, locale, setLocale } = useI18n();
  const { resolved, setPreference } = useTheme();
  const { login } = useAuth();
  const toMessage = useApiErrorMessage();

  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await login(loginName.trim(), password);
    } catch (err) {
      setError(toMessage(err));
      setPassword('');
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
          <h1 style={{ fontSize: 'var(--text-lg)' }}>{t('app.name')}</h1>
          <p className="muted text-sm" style={{ margin: 0 }}>
            {t('app.company')} &middot; {t('app.tagline')}
          </p>
        </div>

        <h2 className="card-title" style={{ marginBottom: 'var(--space-1)' }}>
          {t('auth.title')}
        </h2>
        <p className="muted text-sm">{t('auth.subtitle')}</p>

        {error ? <Alert tone="danger">{error}</Alert> : null}

        <form onSubmit={handleSubmit} noValidate>
          <TextInput
            label={t('auth.login')}
            value={loginName}
            onChange={(event) => setLoginName(event.target.value)}
            autoComplete="username"
            autoFocus
            required
            maxLength={40}
          />
          <TextInput
            label={t('auth.password')}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
            maxLength={200}
          />
          <Button
            type="submit"
            variant="primary"
            block
            loading={submitting}
            disabled={loginName.trim() === '' || password === ''}
            style={{ marginTop: 'var(--space-3)' }}
          >
            {submitting ? t('auth.signingIn') : t('auth.signIn')}
          </Button>
        </form>

        <div className="auth-footer">
          <div className="btn-group" style={{ justifyContent: 'center', marginBottom: 'var(--space-2)' }}>
            {LOCALES.map((item) => (
              <Button
                key={item.code}
                size="sm"
                variant={locale === item.code ? 'primary' : 'ghost'}
                onClick={() => setLocale(item.code)}
              >
                {item.code.toUpperCase()}
              </Button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPreference(resolved === 'dark' ? 'light' : 'dark')}
              aria-label={t('settings.theme')}
            >
              {resolved === 'dark' ? '☾' : '☀'}
            </Button>
          </div>
          ResInvest ERP v{__APP_VERSION__}
        </div>
      </div>
    </div>
  );
}

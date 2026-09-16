import { useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';
import { useTheme, type ThemePreference } from '../state/ThemeContext';
import { LOCALES, useI18n, type Locale } from '../i18n';
import { useApiErrorMessage } from '../hooks/useApiData';
import { Alert, Button, Card, DescriptionList, RadioChips, TextInput } from '../components/ui';

export function ProfilePage() {
  const { t, locale, setLocale } = useI18n();
  const { user, warehouses, reloadSession } = useAuth();
  const { preference, setPreference } = useTheme();
  const toast = useToast();
  const toMessage = useApiErrorMessage();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function savePreferences(patch: { locale?: Locale; theme?: ThemePreference }) {
    try {
      await api.put('/auth/me/preferences', patch);
      if (patch.locale) setLocale(patch.locale);
      if (patch.theme) setPreference(patch.theme);
      await reloadSession();
      toast.success(t('msg.saved'));
    } catch (err) {
      toast.error(t('action.save'), toMessage(err));
    }
  }

  async function changePassword() {
    if (next !== repeat) {
      setError(t('auth.passwordMismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/me/password', { currentPassword: current, newPassword: next });
      toast.success(t('auth.passwordChanged'));
      setCurrent('');
      setNext('');
      setRepeat('');
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('auth.profile')}</h1>
          <p className="page-subtitle">{user?.fullName}</p>
        </div>
      </div>

      <Card title={t('auth.profile')}>
        <DescriptionList
          items={[
            { label: t('auth.login'), value: <span className="mono">{user?.login}</span> },
            { label: t('users.fullName'), value: user?.fullName ?? '-' },
            { label: t('users.email'), value: user?.email || '-' },
            { label: t('auth.role'), value: user?.roleName ?? '-' },
            {
              label: t('users.warehouses'),
              value: warehouses.map((w) => w.name).join(', ') || t('common.none'),
            },
            {
              label: t('users.permissions'),
              value: <span className="text-xs mono">{user?.permissions.join(', ')}</span>,
            },
          ]}
        />
      </Card>

      <Card title={t('settings.appearance')}>
        <div className="form-grid">
          <div className="field">
            <RadioChips<Locale>
              label={t('settings.language')}
              value={locale}
              options={LOCALES.map((item) => ({ value: item.code, label: item.label }))}
              onChange={(value) => void savePreferences({ locale: value })}
            />
          </div>
          <div className="field">
            <RadioChips<ThemePreference>
              label={t('settings.theme')}
              value={preference}
              options={[
                { value: 'light', label: t('settings.theme.light') },
                { value: 'dark', label: t('settings.theme.dark') },
                { value: 'system', label: t('settings.theme.system') },
              ]}
              onChange={(value) => void savePreferences({ theme: value })}
            />
          </div>
        </div>
      </Card>

      <Card
        title={t('action.changePassword')}
        actions={
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            disabled={current === '' || next.length < 10 || next !== repeat}
            onClick={changePassword}
          >
            {t('action.save')}
          </Button>
        }
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="form-grid">
          <TextInput
            label={t('auth.currentPassword')}
            type="password"
            value={current}
            autoComplete="current-password"
            onChange={(event) => setCurrent(event.target.value)}
          />
          <TextInput
            label={t('auth.newPassword')}
            type="password"
            value={next}
            autoComplete="new-password"
            hint={t('auth.passwordRules')}
            onChange={(event) => setNext(event.target.value)}
          />
          <TextInput
            label={t('auth.repeatPassword')}
            type="password"
            value={repeat}
            autoComplete="new-password"
            error={repeat !== '' && repeat !== next ? t('auth.passwordMismatch') : undefined}
            onChange={(event) => setRepeat(event.target.value)}
          />
        </div>
      </Card>
    </>
  );
}

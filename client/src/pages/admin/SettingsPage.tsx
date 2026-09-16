import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { AppSettings, BackupInfo, ChippingMode } from '../../api/types';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { useI18n } from '../../i18n';
import { useApiData, useApiErrorMessage } from '../../hooks/useApiData';
import { formatBytes, formatDateTime, parseDecimal } from '../../lib/format';
import { Alert, Badge, Button, Card, Checkbox, LoadingState, RadioChips, TextInput } from '../../components/ui';
import { DataTable, type Column } from '../../components/ui/DataTable';

export function SettingsPage() {
  const { t, intlLocale } = useI18n();
  const { settings, refreshSettings, can } = useAuth();
  const toast = useToast();
  const toMessage = useApiErrorMessage();

  const [draft, setDraft] = useState<AppSettings | null>(settings);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const backups = useApiData<{ items: BackupInfo[] }>(
    (signal) => api.get('/settings/backups', undefined, signal),
    [],
    { enabled: can('admin.backup') },
  );

  if (!draft) return <LoadingState />;

  async function save(key: keyof AppSettings, value: unknown) {
    setBusy(key);
    try {
      await api.put('/settings', { key, value });
      await refreshSettings();
      toast.success(t('msg.saved'));
    } catch (err) {
      toast.error(t('action.save'), toMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function createBackup() {
    setBusy('backup');
    try {
      await api.post<BackupInfo>('/settings/backups');
      toast.success(t('msg.backupCreated'));
      backups.reload();
    } catch (err) {
      toast.error(t('action.createBackup'), toMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const backupColumns: Array<Column<BackupInfo>> = [
    { key: 'file', header: t('settings.backupFile'), render: (row) => <span className="mono">{row.fileName}</span> },
    {
      key: 'kind',
      header: t('doc.status'),
      render: (row) => <Badge tone={row.kind === 'manual' ? 'info' : 'neutral'}>{row.kind}</Badge>,
    },
    {
      key: 'size',
      header: t('settings.backupSize'),
      align: 'right',
      render: (row) => formatBytes(row.sizeBytes, intlLocale),
    },
    {
      key: 'created',
      header: t('settings.backupCreated'),
      render: (row) => formatDateTime(row.createdAt, intlLocale),
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('settings.title')}</h1>
          <p className="page-subtitle">
            {t('settings.company')} · {t('settings.conversion')} · {t('settings.rates')} ·{' '}
            {t('settings.stockPolicy')}
          </p>
        </div>
      </div>

      <Card
        title={t('settings.company')}
        actions={
          <Button
            variant="primary"
            size="sm"
            loading={busy === 'company'}
            onClick={() => void save('company', draft.company)}
          >
            {t('action.save')}
          </Button>
        }
      >
        <div className="form-grid">
          <TextInput
            label={t('settings.companyName')}
            required
            value={draft.company.name}
            span={2}
            onChange={(event) => setDraft({ ...draft, company: { ...draft.company, name: event.target.value } })}
          />
          <TextInput
            label={t('settings.taxId')}
            value={draft.company.taxId}
            onChange={(event) => setDraft({ ...draft, company: { ...draft.company, taxId: event.target.value } })}
          />
          <TextInput
            label={t('warehouses.address')}
            value={draft.company.address}
            onChange={(event) => setDraft({ ...draft, company: { ...draft.company, address: event.target.value } })}
          />
          <TextInput
            label={t('warehouses.postalCode')}
            value={draft.company.postalCode}
            onChange={(event) =>
              setDraft({ ...draft, company: { ...draft.company, postalCode: event.target.value } })
            }
          />
          <TextInput
            label={t('warehouses.city')}
            value={draft.company.city}
            onChange={(event) => setDraft({ ...draft, company: { ...draft.company, city: event.target.value } })}
          />
          <TextInput
            label={t('partners.phone')}
            value={draft.company.phone}
            onChange={(event) => setDraft({ ...draft, company: { ...draft.company, phone: event.target.value } })}
          />
          <TextInput
            label={t('users.email')}
            type="email"
            value={draft.company.email}
            onChange={(event) => setDraft({ ...draft, company: { ...draft.company, email: event.target.value } })}
          />
          <TextInput
            label={t('settings.bankAccount')}
            value={draft.company.bankAccount}
            span={2}
            onChange={(event) =>
              setDraft({ ...draft, company: { ...draft.company, bankAccount: event.target.value } })
            }
          />
        </div>
      </Card>

      <Card
        title={t('settings.conversion')}
        actions={
          <Button
            variant="primary"
            size="sm"
            loading={busy === 'conversion'}
            onClick={() => void save('conversion', draft.conversion)}
          >
            {t('action.save')}
          </Button>
        }
      >
        <Alert tone="info">{t('settings.conversionHint')}</Alert>
        <div className="form-grid">
          <TextInput
            label={t('settings.m3PerMp')}
            value={String(draft.conversion.m3PerMp)}
            inputMode="decimal"
            onChange={(event) =>
              setDraft({
                ...draft,
                conversion: { ...draft.conversion, m3PerMp: parseDecimal(event.target.value) ?? 0 },
              })
            }
          />
          <TextInput
            label={t('settings.tPerMp')}
            value={String(draft.conversion.tPerMp)}
            inputMode="decimal"
            onChange={(event) =>
              setDraft({
                ...draft,
                conversion: { ...draft.conversion, tPerMp: parseDecimal(event.target.value) ?? 0 },
              })
            }
          />
        </div>
      </Card>

      <Card
        title={t('settings.rates')}
        actions={
          <Button
            variant="primary"
            size="sm"
            loading={busy === 'rates'}
            onClick={() => void save('rates', draft.rates)}
          >
            {t('action.save')}
          </Button>
        }
      >
        <div className="form-grid">
          <TextInput
            label={t('settings.transportRate')}
            value={String(draft.rates.transportPlnPerKm)}
            inputMode="decimal"
            onChange={(event) =>
              setDraft({
                ...draft,
                rates: { ...draft.rates, transportPlnPerKm: parseDecimal(event.target.value) ?? 0 },
              })
            }
          />
          <TextInput
            label={t('settings.chippingRate')}
            value={String(draft.rates.chippingPlnPerUnit)}
            inputMode="decimal"
            onChange={(event) =>
              setDraft({
                ...draft,
                rates: { ...draft.rates, chippingPlnPerUnit: parseDecimal(event.target.value) ?? 0 },
              })
            }
          />
          <div className="field">
            <RadioChips<ChippingMode>
              label={t('settings.chippingMode')}
              value={draft.rates.chippingDefaultMode}
              options={[
                { value: 'OWN', label: t('production.mode.OWN') },
                { value: 'EXTERNAL', label: t('production.mode.EXTERNAL') },
              ]}
              onChange={(value) => setDraft({ ...draft, rates: { ...draft.rates, chippingDefaultMode: value } })}
            />
          </div>
        </div>
      </Card>

      <Card
        title={t('settings.stockPolicy')}
        actions={
          <Button
            variant="primary"
            size="sm"
            loading={busy === 'stockPolicy'}
            onClick={() => void save('stockPolicy', draft.stockPolicy)}
          >
            {t('action.save')}
          </Button>
        }
      >
        <div className="form-grid">
          <div className="field">
            <Checkbox
              label={t('settings.allowNegative')}
              checked={draft.stockPolicy.allowNegative}
              onChange={(checked) =>
                setDraft({ ...draft, stockPolicy: { ...draft.stockPolicy, allowNegative: checked } })
              }
            />
            <span className="field-hint">{t('settings.allowNegativeHint')}</span>
          </div>
          <TextInput
            label={t('settings.lowStockThreshold')}
            value={String(draft.stockPolicy.lowStockThreshold)}
            inputMode="decimal"
            onChange={(event) =>
              setDraft({
                ...draft,
                stockPolicy: { ...draft.stockPolicy, lowStockThreshold: parseDecimal(event.target.value) ?? 0 },
              })
            }
          />
        </div>
      </Card>

      {can('admin.backup') ? (
        <Card
          title={t('settings.backups')}
          actions={
            <Button variant="primary" size="sm" loading={busy === 'backup'} onClick={createBackup}>
              {t('action.createBackup')}
            </Button>
          }
          tight
        >
          <DataTable
            columns={backupColumns}
            rows={backups.data?.items ?? []}
            rowKey={(row) => row.fileName}
            loading={backups.loading && !backups.data}
            error={backups.error}
            onRetry={backups.reload}
          />
        </Card>
      ) : null}
    </>
  );
}

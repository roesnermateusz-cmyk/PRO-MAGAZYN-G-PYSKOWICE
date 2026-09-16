import { useMemo, useState } from 'react';
import { api } from '../../api/client';
import type { Partner } from '../../api/types';
import { useToast } from '../../state/ToastContext';
import { useI18n } from '../../i18n';
import { useApiData, useApiErrorMessage } from '../../hooks/useApiData';
import { Alert, Badge, Button, Card, Checkbox, TextArea, TextInput } from '../../components/ui';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Modal } from '../../components/ui/Modal';

interface FormState {
  id: number | null;
  code: string;
  name: string;
  taxId: string;
  address: string;
  postalCode: string;
  city: string;
  phone: string;
  email: string;
  isSupplier: boolean;
  isCustomer: boolean;
  isCarrier: boolean;
  isForestry: boolean;
  isActive: boolean;
  notes: string;
}

const EMPTY: FormState = {
  id: null,
  code: '',
  name: '',
  taxId: '',
  address: '',
  postalCode: '',
  city: '',
  phone: '',
  email: '',
  isSupplier: true,
  isCustomer: false,
  isCarrier: false,
  isForestry: false,
  isActive: true,
  notes: '',
};

export function PartnersPage() {
  const { t } = useI18n();
  const toast = useToast();
  const toMessage = useApiErrorMessage();

  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const { data, loading, error, reload } = useApiData<{ items: Partner[] }>(
    (signal) => api.get('/partners', { includeInactive: true }, signal),
    [],
  );

  const rows = useMemo(() => {
    const items = data?.items ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(needle) ||
        item.code.toLowerCase().includes(needle) ||
        item.taxId.includes(needle),
    );
  }, [data, search]);

  async function save() {
    if (!form) return;
    if (form.code.trim().length < 2 || form.name.trim().length < 2) {
      setFormError(t('msg.requiredField'));
      return;
    }
    if (!form.isSupplier && !form.isCustomer && !form.isCarrier) {
      setFormError(t('partners.roles'));
      return;
    }
    setBusy(true);
    setFormError(null);
    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      taxId: form.taxId,
      address: form.address,
      postalCode: form.postalCode,
      city: form.city,
      country: 'PL',
      phone: form.phone,
      email: form.email,
      isSupplier: form.isSupplier,
      isCustomer: form.isCustomer,
      isCarrier: form.isCarrier,
      isForestry: form.isForestry,
      isActive: form.isActive,
      notes: form.notes,
    };
    try {
      if (form.id === null) await api.post('/partners', payload);
      else await api.put(`/partners/${form.id}`, payload);
      toast.success(form.id === null ? t('msg.created') : t('msg.saved'));
      setForm(null);
      reload();
    } catch (err) {
      setFormError(toMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: Array<Column<Partner>> = [
    { key: 'code', header: t('partners.code'), render: (row) => <span className="mono strong">{row.code}</span> },
    {
      key: 'name',
      header: t('partners.name'),
      render: (row) => (
        <>
          <div className="strong">{row.name}</div>
          <div className="text-xs muted">{[row.postalCode, row.city].filter(Boolean).join(' ')}</div>
        </>
      ),
    },
    { key: 'taxId', header: t('partners.taxId'), secondary: true, render: (row) => row.taxId || '-' },
    {
      key: 'roles',
      header: t('partners.roles'),
      render: (row) => (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {row.isSupplier ? <Badge tone="info">{t('partners.isSupplier')}</Badge> : null}
          {row.isCustomer ? <Badge tone="success">{t('partners.isCustomer')}</Badge> : null}
          {row.isCarrier ? <Badge tone="warning">{t('partners.isCarrier')}</Badge> : null}
          {row.isForestry ? <Badge tone="neutral">{t('partners.isForestry')}</Badge> : null}
        </div>
      ),
    },
    {
      key: 'status',
      header: t('doc.status'),
      render: (row) =>
        row.isActive ? (
          <Badge tone="success" mark="●">
            {t('users.active')}
          </Badge>
        ) : (
          <Badge tone="neutral" mark="○">
            {t('users.inactive')}
          </Badge>
        ),
    },
    {
      key: 'actions',
      header: '',
      isActions: true,
      render: (row) => (
        <Button
          size="sm"
          onClick={() =>
            setForm({
              id: row.id,
              code: row.code,
              name: row.name,
              taxId: row.taxId,
              address: row.address,
              postalCode: row.postalCode,
              city: row.city,
              phone: row.phone,
              email: row.email,
              isSupplier: row.isSupplier,
              isCustomer: row.isCustomer,
              isCarrier: row.isCarrier,
              isForestry: row.isForestry,
              isActive: row.isActive,
              notes: row.notes,
            })
          }
        >
          {t('action.edit')}
        </Button>
      ),
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('partners.title')}</h1>
          <p className="page-subtitle">{data ? `${data.items.length} ${t('common.rows')}` : ''}</p>
        </div>
        <div className="page-actions">
          <Button onClick={reload}>{t('action.refresh')}</Button>
          <Button variant="primary" onClick={() => setForm({ ...EMPTY })}>
            + {t('action.create')}
          </Button>
        </div>
      </div>

      <Card tight>
        <div className="toolbar no-print">
          <TextInput
            label={t('action.search')}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={loading && !data}
          error={error}
          onRetry={reload}
        />
      </Card>

      <Modal
        open={form !== null}
        title={form?.id === null ? t('action.create') : t('action.edit')}
        onClose={() => setForm(null)}
        busy={busy}
        wide
        footer={
          <>
            <Button onClick={() => setForm(null)} disabled={busy}>
              {t('action.cancel')}
            </Button>
            <Button variant="primary" loading={busy} onClick={save}>
              {t('action.save')}
            </Button>
          </>
        }
      >
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        {form ? (
          <div className="form-grid">
            <TextInput
              label={t('partners.code')}
              required
              value={form.code}
              maxLength={32}
              onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
            />
            <TextInput
              label={t('partners.name')}
              required
              value={form.name}
              maxLength={200}
              span={2}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
            <TextInput
              label={t('partners.taxId')}
              value={form.taxId}
              maxLength={40}
              onChange={(event) => setForm({ ...form, taxId: event.target.value })}
            />
            <TextInput
              label={t('warehouses.address')}
              value={form.address}
              maxLength={200}
              onChange={(event) => setForm({ ...form, address: event.target.value })}
            />
            <TextInput
              label={t('warehouses.postalCode')}
              value={form.postalCode}
              maxLength={20}
              onChange={(event) => setForm({ ...form, postalCode: event.target.value })}
            />
            <TextInput
              label={t('warehouses.city')}
              value={form.city}
              maxLength={100}
              onChange={(event) => setForm({ ...form, city: event.target.value })}
            />
            <TextInput
              label={t('partners.phone')}
              value={form.phone}
              maxLength={50}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
            />
            <TextInput
              label={t('users.email')}
              type="email"
              value={form.email}
              maxLength={120}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
            <div className="field span-full">
              <span className="field-label">{t('partners.roles')}</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
                <Checkbox
                  label={t('partners.isSupplier')}
                  checked={form.isSupplier}
                  onChange={(checked) => setForm({ ...form, isSupplier: checked })}
                />
                <Checkbox
                  label={t('partners.isCustomer')}
                  checked={form.isCustomer}
                  onChange={(checked) => setForm({ ...form, isCustomer: checked })}
                />
                <Checkbox
                  label={t('partners.isCarrier')}
                  checked={form.isCarrier}
                  onChange={(checked) => setForm({ ...form, isCarrier: checked })}
                />
                <Checkbox
                  label={t('partners.isForestry')}
                  checked={form.isForestry}
                  onChange={(checked) => setForm({ ...form, isForestry: checked })}
                />
                <Checkbox
                  label={t('users.active')}
                  checked={form.isActive}
                  onChange={(checked) => setForm({ ...form, isActive: checked })}
                />
              </div>
            </div>
            <TextArea
              label={t('doc.notes')}
              value={form.notes}
              maxLength={1000}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </div>
        ) : null}
      </Modal>
    </>
  );
}

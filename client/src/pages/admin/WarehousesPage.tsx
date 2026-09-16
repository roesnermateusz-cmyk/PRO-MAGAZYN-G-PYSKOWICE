import { useState } from 'react';
import { api } from '../../api/client';
import type { Warehouse } from '../../api/types';
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
  address: string;
  postalCode: string;
  city: string;
  notes: string;
  isActive: boolean;
}

const EMPTY: FormState = {
  id: null,
  code: '',
  name: '',
  address: '',
  postalCode: '',
  city: '',
  notes: '',
  isActive: true,
};

export function WarehousesPage() {
  const { t } = useI18n();
  const toast = useToast();
  const toMessage = useApiErrorMessage();

  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { data, loading, error, reload } = useApiData<{ items: Warehouse[] }>(
    (signal) => api.get('/warehouses', { all: true }, signal),
    [],
  );

  async function save() {
    if (!form) return;
    if (form.code.trim().length < 2 || form.name.trim().length < 2) {
      setFormError(t('msg.requiredField'));
      return;
    }
    setBusy(true);
    setFormError(null);
    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      address: form.address,
      postalCode: form.postalCode,
      city: form.city,
      notes: form.notes,
      isActive: form.isActive,
    };
    try {
      if (form.id === null) await api.post('/warehouses', payload);
      else await api.put(`/warehouses/${form.id}`, payload);
      toast.success(form.id === null ? t('msg.created') : t('msg.saved'));
      setForm(null);
      reload();
    } catch (err) {
      const message = toMessage(err);
      setFormError(message);
    } finally {
      setBusy(false);
    }
  }

  const columns: Array<Column<Warehouse>> = [
    { key: 'code', header: t('warehouses.code'), render: (row) => <span className="mono strong">{row.code}</span> },
    { key: 'name', header: t('warehouses.name'), render: (row) => row.name },
    {
      key: 'address',
      header: t('warehouses.address'),
      secondary: true,
      render: (row) => [row.address, `${row.postalCode} ${row.city}`.trim()].filter(Boolean).join(', ') || '-',
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
              address: row.address,
              postalCode: row.postalCode,
              city: row.city,
              notes: row.notes,
              isActive: row.isActive,
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
          <h1 className="page-title">{t('warehouses.title')}</h1>
          <p className="page-subtitle">{t('warehouses.deactivateHint')}</p>
        </div>
        <div className="page-actions">
          <Button onClick={reload}>{t('action.refresh')}</Button>
          <Button variant="primary" onClick={() => setForm({ ...EMPTY })}>
            + {t('action.create')}
          </Button>
        </div>
      </div>

      <Card tight>
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
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
              label={t('warehouses.code')}
              required
              value={form.code}
              maxLength={16}
              onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
            />
            <TextInput
              label={t('warehouses.name')}
              required
              value={form.name}
              maxLength={120}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
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
            <div className="field">
              <Checkbox
                label={t('users.active')}
                checked={form.isActive}
                onChange={(checked) => setForm({ ...form, isActive: checked })}
              />
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

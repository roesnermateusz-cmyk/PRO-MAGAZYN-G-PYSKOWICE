import { useState } from 'react';
import { api } from '../../api/client';
import type { BaseUnit, Product, ProductKind } from '../../api/types';
import { useToast } from '../../state/ToastContext';
import { useI18n, type TranslationKey } from '../../i18n';
import { useApiData, useApiErrorMessage } from '../../hooks/useApiData';
import { parseDecimal, UNIT_LABEL } from '../../lib/format';
import { Alert, Badge, Button, Card, Checkbox, SelectInput, TextArea, TextInput } from '../../components/ui';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Modal } from '../../components/ui/Modal';

interface FormState {
  id: number | null;
  code: string;
  name: string;
  kind: ProductKind;
  baseUnit: BaseUnit;
  m3PerMp: string;
  tPerMp: string;
  isActive: boolean;
  notes: string;
}

const EMPTY: FormState = {
  id: null,
  code: '',
  name: '',
  kind: 'RAW',
  baseUnit: 'M3',
  m3PerMp: '',
  tPerMp: '',
  isActive: true,
  notes: '',
};

const KINDS: ProductKind[] = ['RAW', 'FINISHED', 'GOODS', 'SERVICE'];
const UNITS: BaseUnit[] = ['M3', 'MP', 'T', 'SZT'];

export function ProductsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const toMessage = useApiErrorMessage();

  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { data, loading, error, reload } = useApiData<{ items: Product[] }>(
    (signal) => api.get('/products', { includeInactive: true }, signal),
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
      kind: form.kind,
      baseUnit: form.baseUnit,
      m3PerMp: parseDecimal(form.m3PerMp),
      tPerMp: parseDecimal(form.tPerMp),
      isActive: form.isActive,
      notes: form.notes,
    };
    try {
      if (form.id === null) await api.post('/products', payload);
      else await api.put(`/products/${form.id}`, payload);
      toast.success(form.id === null ? t('msg.created') : t('msg.saved'));
      setForm(null);
      reload();
    } catch (err) {
      setFormError(toMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: Array<Column<Product>> = [
    { key: 'code', header: t('products.code'), render: (row) => <span className="mono strong">{row.code}</span> },
    { key: 'name', header: t('products.name'), render: (row) => row.name },
    { key: 'kind', header: t('products.kind'), render: (row) => t(`products.kind.${row.kind}` as TranslationKey) },
    { key: 'unit', header: t('products.baseUnit'), render: (row) => UNIT_LABEL[row.baseUnit] },
    {
      key: 'conversions',
      header: t('products.conversions'),
      secondary: true,
      render: (row) =>
        row.m3PerMp === null && row.tPerMp === null
          ? t('common.none')
          : `${row.m3PerMp ?? '-'} m3/MP · ${row.tPerMp ?? '-'} t/MP`,
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
              kind: row.kind,
              baseUnit: row.baseUnit,
              m3PerMp: row.m3PerMp === null ? '' : String(row.m3PerMp),
              tPerMp: row.tPerMp === null ? '' : String(row.tPerMp),
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
          <h1 className="page-title">{t('products.title')}</h1>
          <p className="page-subtitle">{t('products.useGlobal')}</p>
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
              label={t('products.code')}
              required
              value={form.code}
              maxLength={32}
              onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
            />
            <TextInput
              label={t('products.name')}
              required
              value={form.name}
              maxLength={160}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
            <SelectInput
              label={t('products.kind')}
              value={form.kind}
              options={KINDS.map((kind) => ({ value: kind, label: t(`products.kind.${kind}` as TranslationKey) }))}
              onChange={(event) => setForm({ ...form, kind: event.target.value as ProductKind })}
            />
            <SelectInput
              label={t('products.baseUnit')}
              value={form.baseUnit}
              hint={form.id !== null ? t('products.unitLocked') : undefined}
              options={UNITS.map((unit) => ({ value: unit, label: UNIT_LABEL[unit] }))}
              onChange={(event) => setForm({ ...form, baseUnit: event.target.value as BaseUnit })}
            />
            <TextInput
              label={t('products.m3PerMp')}
              value={form.m3PerMp}
              inputMode="decimal"
              placeholder="0,25"
              hint={t('products.useGlobal')}
              onChange={(event) => setForm({ ...form, m3PerMp: event.target.value })}
            />
            <TextInput
              label={t('products.tPerMp')}
              value={form.tPerMp}
              inputMode="decimal"
              placeholder="0,33"
              onChange={(event) => setForm({ ...form, tPerMp: event.target.value })}
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

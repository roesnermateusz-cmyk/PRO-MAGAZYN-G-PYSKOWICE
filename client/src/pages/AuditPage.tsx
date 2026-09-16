import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { AuditChange, AuditEntry, Paged } from '../api/types';
import { useI18n, type TranslationKey } from '../i18n';
import { useApiData } from '../hooks/useApiData';
import { formatDateTime } from '../lib/format';
import { Badge, Button, Card, Pagination, SelectInput, TextInput } from '../components/ui';
import { DataTable, type Column } from '../components/ui/DataTable';

interface Facets {
  modules: string[];
  actions: string[];
  users: Array<{ id: number; name: string }>;
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? '1' : '0';
  return String(value);
}

function ChangeList({ changes, emptyLabel }: { changes: AuditChange[]; emptyLabel: string }) {
  if (changes.length === 0) return <span className="muted text-xs">{emptyLabel}</span>;
  return (
    <ul style={{ margin: 0, paddingLeft: 16 }}>
      {changes.map((change, index) => (
        <li key={`${change.field}-${index}`} className="text-xs">
          <span className="strong">{change.field}</span>: <span className="mono">{renderValue(change.before)}</span>
          {' → '}
          <span className="mono strong">{renderValue(change.after)}</span>
        </li>
      ))}
    </ul>
  );
}

export function AuditPage() {
  const { t, intlLocale } = useI18n();

  const [module, setModule] = useState('');
  const [action, setAction] = useState('');
  const [userId, setUserId] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [module, action, userId, dateFrom, dateTo]);

  const facets = useApiData<Facets>((signal) => api.get('/audit/facets', undefined, signal), []);

  const { data, loading, error, reload } = useApiData<Paged<AuditEntry>>(
    (signal) =>
      api.get<Paged<AuditEntry>>(
        '/audit',
        {
          module: module || undefined,
          action: action || undefined,
          userId: userId || undefined,
          search: debounced || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          page,
          pageSize,
        },
        signal,
      ),
    [module, action, userId, debounced, dateFrom, dateTo, page, pageSize],
  );

  const columns: Array<Column<AuditEntry>> = [
    {
      key: 'when',
      header: t('audit.when'),
      render: (row) => <span className="nowrap">{formatDateTime(row.occurredAt, intlLocale)}</span>,
    },
    {
      key: 'who',
      header: t('audit.who'),
      render: (row) => (
        <>
          <div>{row.userName || row.userLogin || '—'}</div>
          <div className="text-xs muted mono">{row.userLogin}</div>
        </>
      ),
    },
    {
      key: 'action',
      header: t('audit.action'),
      render: (row) => {
        const key = `audit.action.${row.action}` as TranslationKey;
        const label = t(key);
        const tone =
          row.action === 'DELETE' || row.action === 'CANCEL' || row.action === 'LOGIN_FAILED'
            ? 'danger'
            : row.action === 'POST' || row.action === 'CREATE'
              ? 'success'
              : row.action === 'PERMISSION_CHANGE' || row.action === 'CORRECT'
                ? 'warning'
                : 'neutral';
        return (
          <Badge tone={tone} mark="•">
            {label === key ? row.action : label}
          </Badge>
        );
      },
    },
    { key: 'module', header: t('audit.module'), secondary: true, render: (row) => row.module },
    {
      key: 'entity',
      header: t('audit.entity'),
      render: (row) => (
        <>
          <div className="mono">{row.entityLabel || row.entityId}</div>
          <div className="text-xs muted">{row.entityType}</div>
        </>
      ),
    },
    {
      key: 'changes',
      header: t('audit.changes'),
      render: (row) => <ChangeList changes={row.changes} emptyLabel={t('audit.noChanges')} />,
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('audit.title')}</h1>
          <p className="page-subtitle">{t('audit.subtitle')}</p>
        </div>
        <div className="page-actions">
          <Button onClick={reload}>{t('action.refresh')}</Button>
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
          <SelectInput
            label={t('audit.module')}
            value={module}
            placeholder={t('common.all')}
            options={(facets.data?.modules ?? []).map((m) => ({ value: m, label: m }))}
            onChange={(event) => setModule(event.target.value)}
          />
          <SelectInput
            label={t('audit.action')}
            value={action}
            placeholder={t('common.all')}
            options={(facets.data?.actions ?? []).map((a) => ({
              value: a,
              label: t(`audit.action.${a}` as TranslationKey) === `audit.action.${a}` ? a : t(`audit.action.${a}` as TranslationKey),
            }))}
            onChange={(event) => setAction(event.target.value)}
          />
          <SelectInput
            label={t('audit.who')}
            value={userId}
            placeholder={t('common.all')}
            options={(facets.data?.users ?? []).map((u) => ({ value: String(u.id), label: u.name }))}
            onChange={(event) => setUserId(event.target.value)}
          />
          <TextInput
            label={t('reports.dateFrom')}
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
          />
          <TextInput
            label={t('reports.dateTo')}
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
          />
          <div className="toolbar-spacer" />
          <Button
            onClick={() => {
              setModule('');
              setAction('');
              setUserId('');
              setSearch('');
              setDateFrom('');
              setDateTo('');
            }}
          >
            {t('action.clearFilters')}
          </Button>
        </div>

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(row) => row.id}
          loading={loading && !data}
          error={error}
          onRetry={reload}
        />

        {data && data.total > 0 ? (
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        ) : null}
      </Card>
    </>
  );
}

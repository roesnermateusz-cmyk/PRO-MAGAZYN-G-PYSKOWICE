import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { DocStatus, DocType, DocumentListItem, Paged } from '../api/types';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';
import { useI18n, type TranslationKey } from '../i18n';
import { useApiData, useApiErrorMessage } from '../hooks/useApiData';
import { formatDate, formatMoney, formatQty } from '../lib/format';
import { Button, Card, Pagination, SelectInput, StatusBadge, TextInput } from '../components/ui';
import { DataTable, type Column } from '../components/ui/DataTable';

const DOC_TYPES: DocType[] = ['PZ', 'WZ', 'MM', 'PROD', 'TR', 'SD'];

function isDocType(value: string | undefined): value is DocType {
  return value !== undefined && (DOC_TYPES as string[]).includes(value);
}

export function DocumentListPage() {
  const { docType: docTypeParam } = useParams();
  const docType = isDocType(docTypeParam) ? docTypeParam : undefined;

  const { t, intlLocale } = useI18n();
  const { warehouseId, can } = useAuth();
  const toast = useToast();
  const toMessage = useApiErrorMessage();
  const navigate = useNavigate();

  const [status, setStatus] = useState<DocStatus | ''>('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Opoznienie wyszukiwania ogranicza liczbę zapytan podczas pisania.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [docType, status, dateFrom, dateTo, warehouseId]);

  const { data, loading, error, reload } = useApiData<Paged<DocumentListItem>>(
    (signal) =>
      api.get<Paged<DocumentListItem>>(
        '/documents',
        {
          docType,
          status: status || undefined,
          warehouseId,
          search: debouncedSearch || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          page,
          pageSize,
        },
        signal,
      ),
    [docType, status, warehouseId, debouncedSearch, dateFrom, dateTo, page, pageSize],
  );

  const canCreate = docType ? can(`${permissionPrefix(docType)}.manage`) : false;

  const columns = useMemo<Array<Column<DocumentListItem>>>(() => {
    const base: Array<Column<DocumentListItem>> = [
      {
        key: 'number',
        header: t('doc.number'),
        render: (row) => <span className="mono strong">{row.docNumber}</span>,
      },
    ];

    if (!docType) {
      base.push({
        key: 'type',
        header: t('doc.status'),
        render: (row) => t(`doc.${row.docType}.short` as TranslationKey),
      });
    }

    base.push(
      { key: 'date', header: t('doc.date'), render: (row) => formatDate(row.docDate, intlLocale) },
      {
        key: 'warehouse',
        header: t('doc.warehouse'),
        secondary: true,
        render: (row) =>
          row.warehouseFromName && row.warehouseToName
            ? `${row.warehouseFromName} → ${row.warehouseToName}`
            : (row.warehouseName ?? row.warehouseFromName ?? row.warehouseToName ?? '-'),
      },
      { key: 'partner', header: t('doc.partner'), secondary: true, render: (row) => row.partnerName ?? '-' },
      {
        key: 'qty',
        header: t('line.quantity'),
        align: 'right',
        render: (row) => formatQty(row.qtyBase, intlLocale),
      },
      {
        key: 'value',
        header: t('doc.totalValue'),
        align: 'right',
        render: (row) => formatMoney(row.totalValue, intlLocale),
      },
      { key: 'status', header: t('doc.status'), render: (row) => <StatusBadge status={row.status} /> },
      {
        key: 'scans',
        header: t('doc.attachments'),
        align: 'center',
        secondary: true,
        render: (row) => (row.attachmentCount > 0 ? `📎 ${row.attachmentCount}` : '-'),
      },
      {
        key: 'actions',
        header: '',
        isActions: true,
        render: (row) => (
          <Button
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              navigate(`/documents/${row.id}`);
            }}
          >
            {t('action.details')}
          </Button>
        ),
      },
    );

    return base;
  }, [docType, t, intlLocale, navigate]);

  async function handleExport() {
    try {
      await api.download('/reports/export', {
        kind: 'documents',
        mode: 'range',
        dateFrom: dateFrom || '2000-01-01',
        dateTo: dateTo || '2099-12-31',
        warehouseId,
      });
      toast.success(t('msg.exported'));
    } catch (err) {
      toast.error(t('action.export'), toMessage(err));
    }
  }

  const title = docType ? t(`doc.${docType}` as TranslationKey) : t('nav.documents');

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle">
            {data ? `${data.total} ${t('common.rows')}` : t('state.loading')}
          </p>
        </div>
        <div className="page-actions">
          {can('reports.export') ? <Button onClick={handleExport}>{t('action.export')}</Button> : null}
          <Button onClick={reload}>{t('action.refresh')}</Button>
          {canCreate && docType ? (
            <Button variant="primary" onClick={() => navigate(`/operations/${docType}/new`)}>
              + {t('action.create')}
            </Button>
          ) : null}
        </div>
      </div>

      <Card tight>
        <div className="toolbar no-print">
          <TextInput
            label={t('action.search')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('doc.number')}
            type="search"
          />
          <SelectInput
            label={t('doc.status')}
            value={status}
            placeholder={t('common.all')}
            options={(['DRAFT', 'POSTED', 'CANCELLED'] as DocStatus[]).map((value) => ({
              value,
              label: t(`status.${value}` as TranslationKey),
            }))}
            onChange={(event) => setStatus(event.target.value as DocStatus | '')}
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
              setSearch('');
              setStatus('');
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
          onRowClick={(row) => navigate(`/documents/${row.id}`)}
          emptyTitle={debouncedSearch ? t('state.noResults') : t('state.empty')}
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

export function permissionPrefix(docType: DocType): string {
  return { PZ: 'pz', WZ: 'wz', MM: 'mm', PROD: 'prod', TR: 'tr', SD: 'sd' }[docType];
}

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Paged, Product, StockMovement } from '../api/types';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';
import { useI18n, type TranslationKey } from '../i18n';
import { useApiData, useApiErrorMessage } from '../hooks/useApiData';
import { formatDate, formatQty, UNIT_LABEL } from '../lib/format';
import { Badge, Button, Card, Pagination, SelectInput, TextInput } from '../components/ui';
import { DataTable, type Column } from '../components/ui/DataTable';

export function MovementsPage() {
  const { t, intlLocale } = useI18n();
  const { warehouseId, can } = useAuth();
  const toast = useToast();
  const toMessage = useApiErrorMessage();
  const navigate = useNavigate();

  const [productId, setProductId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    setPage(1);
  }, [productId, dateFrom, dateTo, warehouseId]);

  const products = useApiData<{ items: Product[] }>((signal) => api.get('/products', undefined, signal), []);

  const { data, loading, error, reload } = useApiData<Paged<StockMovement>>(
    (signal) =>
      api.get<Paged<StockMovement>>(
        '/stock/movements',
        {
          warehouseId,
          productId: productId || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          page,
          pageSize,
        },
        signal,
      ),
    [warehouseId, productId, dateFrom, dateTo, page, pageSize],
  );

  const columns: Array<Column<StockMovement>> = [
    { key: 'date', header: t('doc.date'), render: (row) => formatDate(row.docDate, intlLocale) },
    {
      key: 'document',
      header: t('movements.document'),
      render: (row) => (
        <>
          <span className="mono strong">{row.docNumber}</span>
          <div className="text-xs muted">{t(`doc.${row.docType}` as TranslationKey)}</div>
        </>
      ),
    },
    { key: 'warehouse', header: t('doc.warehouse'), secondary: true, render: (row) => row.warehouseName },
    {
      key: 'product',
      header: t('stock.product'),
      render: (row) => (
        <>
          <div>{row.productName}</div>
          <div className="text-xs muted mono">{row.productCode}</div>
        </>
      ),
    },
    {
      key: 'direction',
      header: t('movements.direction'),
      render: (row) => (
        <Badge tone={row.direction === 'IN' ? 'success' : 'warning'} mark={row.direction === 'IN' ? '+' : '−'}>
          {t(`movements.${row.direction}` as TranslationKey)}
        </Badge>
      ),
    },
    {
      key: 'qty',
      header: t('line.quantity'),
      align: 'right',
      render: (row) => (
        <span className="strong">
          {row.direction === 'IN' ? '+' : '−'}
          {formatQty(row.qtyBase, intlLocale)} {UNIT_LABEL[row.baseUnit]}
        </span>
      ),
    },
    {
      key: 'reason',
      header: t('doc.status'),
      secondary: true,
      render: (row) => t(`movements.reason.${row.reason}` as TranslationKey),
    },
    { key: 'user', header: t('movements.user'), secondary: true, render: (row) => row.userName },
  ];

  async function handleExport() {
    try {
      await api.download('/reports/export', {
        kind: 'movements',
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

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('movements.title')}</h1>
          <p className="page-subtitle">{data ? `${data.total} ${t('common.rows')}` : t('state.loading')}</p>
        </div>
        <div className="page-actions">
          {can('reports.export') ? <Button onClick={handleExport}>{t('action.export')}</Button> : null}
          <Button onClick={reload}>{t('action.refresh')}</Button>
        </div>
      </div>

      <Card tight>
        <div className="toolbar no-print">
          <SelectInput
            label={t('stock.product')}
            value={productId}
            placeholder={t('common.all')}
            options={(products.data?.items ?? []).map((p) => ({ value: String(p.id), label: p.name }))}
            onChange={(event) => setProductId(event.target.value)}
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
              setProductId('');
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
          onRowClick={(row) => navigate(`/documents/${row.documentId}`)}
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

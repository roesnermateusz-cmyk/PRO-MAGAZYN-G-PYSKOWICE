import { useMemo, useState } from 'react';
import { api } from '../api/client';
import type { StockItem } from '../api/types';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';
import { useI18n } from '../i18n';
import { useApiData, useApiErrorMessage } from '../hooks/useApiData';
import { formatDateTime, formatQty, UNIT_LABEL } from '../lib/format';
import { Badge, Button, Card, Checkbox, MetricCard, TextInput } from '../components/ui';
import { DataTable, type Column } from '../components/ui/DataTable';

interface StockResponse {
  items: StockItem[];
  totals: { qtyM3: number; qtyMp: number; qtyT: number };
}

export function StockPage() {
  const { t, intlLocale } = useI18n();
  const { warehouseId, warehouse, can } = useAuth();
  const toast = useToast();
  const toMessage = useApiErrorMessage();

  const [includeZero, setIncludeZero] = useState(false);
  const [search, setSearch] = useState('');

  const { data, loading, error, reload } = useApiData<StockResponse>(
    (signal) => api.get<StockResponse>('/stock', { warehouseId, includeZero }, signal),
    [warehouseId, includeZero],
  );

  const rows = useMemo(() => {
    const items = data?.items ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (item) =>
        item.productName.toLowerCase().includes(needle) || item.productCode.toLowerCase().includes(needle),
    );
  }, [data, search]);

  const columns: Array<Column<StockItem>> = [
    { key: 'warehouse', header: t('doc.warehouse'), render: (row) => row.warehouseName },
    {
      key: 'product',
      header: t('stock.product'),
      render: (row) => (
        <>
          <div className="strong">{row.productName}</div>
          <div className="text-xs muted mono">{row.productCode}</div>
        </>
      ),
    },
    {
      key: 'qty',
      header: t('stock.quantity'),
      align: 'right',
      render: (row) => (
        <span className="strong">
          {formatQty(row.qtyBase, intlLocale)} {UNIT_LABEL[row.baseUnit]}
        </span>
      ),
    },
    { key: 'm3', header: 'm3', align: 'right', render: (row) => formatQty(row.qtyM3, intlLocale) },
    { key: 'mp', header: 'MP', align: 'right', render: (row) => formatQty(row.qtyMp, intlLocale) },
    { key: 't', header: 't', align: 'right', render: (row) => formatQty(row.qtyT, intlLocale) },
    {
      key: 'flags',
      header: t('doc.status'),
      render: (row) =>
        row.isNegative ? (
          <Badge tone="danger" mark="✕">
            {t('stock.negative')}
          </Badge>
        ) : row.isLow ? (
          <Badge tone="warning" mark="!">
            {t('stock.low')}
          </Badge>
        ) : (
          <Badge tone="success" mark="●">
            OK
          </Badge>
        ),
    },
    {
      key: 'updated',
      header: t('stock.lastUpdate'),
      secondary: true,
      render: (row) => formatDateTime(row.updatedAt, intlLocale),
    },
  ];

  async function handleExport() {
    try {
      await api.download('/reports/export', { kind: 'stock', mode: 'year', warehouseId });
      toast.success(t('msg.exported'));
    } catch (err) {
      toast.error(t('action.export'), toMessage(err));
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('stock.title')}</h1>
          <p className="page-subtitle">{warehouse ? warehouse.name : t('warehouse.all')}</p>
        </div>
        <div className="page-actions">
          {can('reports.export') ? <Button onClick={handleExport}>{t('action.export')}</Button> : null}
          <Button onClick={reload}>{t('action.refresh')}</Button>
        </div>
      </div>

      <div className="metrics">
        <MetricCard label="m3" value={formatQty(data?.totals.qtyM3 ?? 0, intlLocale)} unit="m3" />
        <MetricCard label="MP" value={formatQty(data?.totals.qtyMp ?? 0, intlLocale)} unit="MP" tone="info" />
        <MetricCard label="t" value={formatQty(data?.totals.qtyT ?? 0, intlLocale)} unit="t" tone="info" />
      </div>

      <Card tight>
        <div className="toolbar no-print">
          <TextInput
            label={t('action.search')}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="field">
            <Checkbox label={t('stock.includeZero')} checked={includeZero} onChange={setIncludeZero} />
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => `${row.warehouseId}-${row.productId}`}
          loading={loading && !data}
          error={error}
          onRetry={reload}
          emptyTitle={t('stock.empty')}
        />
      </Card>
    </>
  );
}

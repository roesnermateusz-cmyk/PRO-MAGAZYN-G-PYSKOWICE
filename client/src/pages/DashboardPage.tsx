import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { DashboardData, DocType } from '../api/types';
import { useAuth } from '../state/AuthContext';
import { useI18n, type TranslationKey } from '../i18n';
import { useApiData } from '../hooks/useApiData';
import { currentMonthIso, formatDate, formatMoney, formatQty, UNIT_LABEL } from '../lib/format';
import { Alert, Button, Card, EmptyState, ErrorState, LoadingState, MetricCard, StatusBadge } from '../components/ui';
import { DataTable, type Column } from '../components/ui/DataTable';

export function DashboardPage() {
  const { t, intlLocale } = useI18n();
  const { warehouse, warehouseId } = useAuth();
  const navigate = useNavigate();
  const [month, setMonth] = useState(currentMonthIso());

  const { data, loading, error, reload } = useApiData<DashboardData>(
    (signal) => api.get<DashboardData>('/stock/dashboard', { warehouseId, month }, signal),
    [warehouseId, month],
  );

  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <EmptyState />;

  const raw = data.stock.filter((item) => item.kind === 'RAW');
  const finished = data.stock.filter((item) => item.kind !== 'RAW');

  const operationColumns: Array<Column<DashboardData['operations'][number]>> = [
    {
      key: 'type',
      header: t('doc.status'),
      render: (row) => <span className="strong">{t(`doc.${row.docType}` as TranslationKey)}</span>,
    },
    { key: 'count', header: t('dashboard.documentsCount'), align: 'right', render: (row) => row.count },
    { key: 'qty', header: t('line.quantity'), align: 'right', render: (row) => formatQty(row.qty, intlLocale) },
    {
      key: 'value',
      header: t('doc.totalValue'),
      align: 'right',
      render: (row) => formatMoney(row.value, intlLocale),
    },
  ];

  const recentColumns: Array<Column<DashboardData['recentDocuments'][number]>> = [
    {
      key: 'number',
      header: t('doc.number'),
      render: (row) => <span className="mono strong">{row.docNumber}</span>,
    },
    { key: 'date', header: t('doc.date'), render: (row) => formatDate(row.docDate, intlLocale) },
    { key: 'partner', header: t('doc.partner'), render: (row) => row.partnerName ?? '-', secondary: true },
    { key: 'status', header: t('doc.status'), render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'value',
      header: t('doc.totalValue'),
      align: 'right',
      render: (row) => formatMoney(row.totalValue, intlLocale),
    },
    { key: 'user', header: t('doc.createdBy'), render: (row) => row.createdBy, secondary: true },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('dashboard.title')}</h1>
          <p className="page-subtitle">
            {warehouse ? warehouse.name : t('warehouse.all')} &middot; {t('dashboard.subtitle')}
          </p>
        </div>
        <div className="page-actions">
          <label className="sr-only" htmlFor="dashboard-month">
            {t('dashboard.period')}
          </label>
          <input
            id="dashboard-month"
            className="input"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            style={{ width: 'auto' }}
          />
          <Button onClick={reload}>{t('action.refresh')}</Button>
        </div>
      </div>

      {data.alerts.length > 0
        ? data.alerts.map((alert) => (
            <Alert
              key={alert.code}
              tone={alert.level === 'error' ? 'danger' : alert.level === 'warning' ? 'warning' : 'info'}
              title={t(`alert.${alert.code}` as TranslationKey)}
            >
              {alert.count !== undefined ? `${t('common.rows')}: ${alert.count}` : alert.message}
            </Alert>
          ))
        : null}

      <div className="metrics">
        {raw.map((item) => (
          <MetricCard
            key={item.productId}
            label={item.productName}
            value={formatQty(item.qtyBase, intlLocale)}
            unit={UNIT_LABEL[item.baseUnit]}
            hint={`${formatQty(item.qtyMp, intlLocale)} MP · ${formatQty(item.qtyT, intlLocale)} t`}
          />
        ))}
        {finished.map((item) => (
          <MetricCard
            key={item.productId}
            label={item.productName}
            value={formatQty(item.qtyBase, intlLocale)}
            unit={UNIT_LABEL[item.baseUnit]}
            hint={`${formatQty(item.qtyM3, intlLocale)} m3 · ${formatQty(item.qtyT, intlLocale)} t`}
            tone="info"
          />
        ))}
        {data.stock.length === 0 ? (
          <MetricCard label={t('dashboard.stockSection')} value="0" hint={t('stock.empty')} />
        ) : null}
      </div>

      <Card title={`${t('dashboard.operationsSection')} · ${data.period.month}`} tight>
        <DataTable
          columns={operationColumns}
          rows={data.operations}
          rowKey={(row) => row.docType}
          emptyTitle={t('state.empty')}
        />
      </Card>

      <Card title={t('dashboard.recentSection')} tight>
        <DataTable
          columns={recentColumns}
          rows={data.recentDocuments}
          rowKey={(row) => row.id}
          onRowClick={(row) => navigate(`/documents/${row.id}`)}
          emptyTitle={t('state.empty')}
        />
      </Card>
    </>
  );
}

export type { DocType };

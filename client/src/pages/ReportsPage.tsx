import { useState } from 'react';
import { api } from '../api/client';
import type { PartnerReport, ProductionReport, ReportSummary, TransportReport } from '../api/types';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';
import { useI18n, type TranslationKey } from '../i18n';
import { useApiData, useApiErrorMessage } from '../hooks/useApiData';
import { currentMonthIso, formatMoney, formatQty, todayIso, UNIT_LABEL } from '../lib/format';
import { Button, Card, MetricCard, SelectInput, Tabs, TextInput } from '../components/ui';
import { DataTable, type Column } from '../components/ui/DataTable';

type TabId = 'summary' | 'production' | 'transport' | 'partners';
type Mode = 'month' | 'year' | 'range';

export function ReportsPage() {
  const { t, intlLocale } = useI18n();
  const { warehouseId, can } = useAuth();
  const toast = useToast();
  const toMessage = useApiErrorMessage();

  const [tab, setTab] = useState<TabId>('summary');
  const [mode, setMode] = useState<Mode>('month');
  const [month, setMonth] = useState(currentMonthIso());
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [dateFrom, setDateFrom] = useState(todayIso().slice(0, 8) + '01');
  const [dateTo, setDateTo] = useState(todayIso());

  const query = {
    mode,
    month: mode === 'month' ? month : undefined,
    year: mode === 'year' ? year : undefined,
    dateFrom: mode === 'range' ? dateFrom : undefined,
    dateTo: mode === 'range' ? dateTo : undefined,
    warehouseId,
  };
  const queryKey = JSON.stringify(query);

  const summary = useApiData<ReportSummary>(
    (signal) => api.get<ReportSummary>('/reports/summary', query, signal),
    [queryKey],
    { enabled: tab === 'summary' },
  );
  const production = useApiData<ProductionReport>(
    (signal) => api.get<ProductionReport>('/reports/production', query, signal),
    [queryKey],
    { enabled: tab === 'production' },
  );
  const transport = useApiData<TransportReport>(
    (signal) => api.get<TransportReport>('/reports/transport', query, signal),
    [queryKey],
    { enabled: tab === 'transport' },
  );
  const partners = useApiData<PartnerReport>(
    (signal) => api.get<PartnerReport>('/reports/partners', query, signal),
    [queryKey],
    { enabled: tab === 'partners' },
  );

  async function handleExport() {
    try {
      await api.download('/reports/export', { ...query, kind: 'documents' });
      toast.success(t('msg.exported'));
    } catch (err) {
      toast.error(t('action.export'), toMessage(err));
    }
  }

  const byTypeColumns: Array<Column<ReportSummary['byType'][number]>> = [
    { key: 'type', header: t('doc.status'), render: (row) => t(`doc.${row.docType}` as TranslationKey) },
    { key: 'docs', header: t('reports.documents'), align: 'right', render: (row) => row.documents },
    {
      key: 'value',
      header: t('doc.totalValue'),
      align: 'right',
      render: (row) => formatMoney(row.value, intlLocale),
    },
    { key: 'cost', header: t('doc.totalCost'), align: 'right', render: (row) => formatMoney(row.cost, intlLocale) },
  ];

  const byProductColumns: Array<Column<ReportSummary['byProduct'][number]>> = [
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
    { key: 'type', header: t('doc.status'), render: (row) => t(`doc.${row.docType}.short` as TranslationKey) },
    {
      key: 'qty',
      header: t('line.quantity'),
      align: 'right',
      render: (row) => `${formatQty(row.qtyBase, intlLocale)} ${UNIT_LABEL[row.baseUnit]}`,
    },
    { key: 'm3', header: 'm3', align: 'right', render: (row) => formatQty(row.qtyM3, intlLocale) },
    { key: 'mp', header: 'MP', align: 'right', render: (row) => formatQty(row.qtyMp, intlLocale) },
    { key: 't', header: 't', align: 'right', render: (row) => formatQty(row.qtyT, intlLocale) },
    {
      key: 'value',
      header: t('doc.totalValue'),
      align: 'right',
      render: (row) => formatMoney(row.value, intlLocale),
    },
  ];

  const byMonthColumns: Array<Column<ReportSummary['byMonth'][number]>> = [
    { key: 'month', header: t('reports.mode.month'), render: (row) => row.month },
    { key: 'type', header: t('doc.status'), render: (row) => t(`doc.${row.docType}.short` as TranslationKey) },
    { key: 'docs', header: t('reports.documents'), align: 'right', render: (row) => row.documents },
    {
      key: 'value',
      header: t('doc.totalValue'),
      align: 'right',
      render: (row) => formatMoney(row.value, intlLocale),
    },
  ];

  const productionColumns: Array<Column<ProductionReport['items'][number]>> = [
    { key: 'number', header: t('doc.number'), render: (row) => <span className="mono">{row.docNumber}</span> },
    { key: 'date', header: t('doc.date'), render: (row) => row.docDate },
    { key: 'warehouse', header: t('doc.warehouse'), secondary: true, render: (row) => row.warehouseName ?? '-' },
    {
      key: 'mode',
      header: t('production.mode'),
      render: (row) =>
        row.chippingMode === 'EXTERNAL'
          ? `${t('production.mode.EXTERNAL')}: ${row.chippingCompany}`
          : t('production.mode.OWN'),
    },
    { key: 'input', header: t('production.input'), align: 'right', render: (row) => formatQty(row.inputQty, intlLocale) },
    {
      key: 'output',
      header: t('production.output'),
      align: 'right',
      render: (row) => formatQty(row.outputQty, intlLocale),
    },
    { key: 'yield', header: t('production.yield'), align: 'right', render: (row) => formatQty(row.yield, intlLocale) },
    {
      key: 'cost',
      header: t('production.cost'),
      align: 'right',
      render: (row) => formatMoney(row.chippingCost, intlLocale),
    },
  ];

  const transportColumns: Array<Column<TransportReport['items'][number]>> = [
    { key: 'number', header: t('doc.number'), render: (row) => <span className="mono">{row.docNumber}</span> },
    { key: 'date', header: t('doc.date'), render: (row) => row.docDate },
    { key: 'carrier', header: t('doc.carrier'), render: (row) => row.carrierName ?? row.vehiclePlate },
    {
      key: 'route',
      header: t('transport.loadPlace'),
      secondary: true,
      render: (row) => `${row.loadPlace || '-'} → ${row.unloadPlace || '-'}`,
    },
    { key: 'km', header: 'km', align: 'right', render: (row) => formatQty(row.distanceKm, intlLocale) },
    { key: 'cost', header: t('transport.cost'), align: 'right', render: (row) => formatMoney(row.cost, intlLocale) },
    {
      key: 'perKm',
      header: t('transport.costPerKm'),
      align: 'right',
      render: (row) => (row.costPerKm !== null ? formatMoney(row.costPerKm, intlLocale) : '-'),
    },
    {
      key: 'perT',
      header: t('transport.costPerT'),
      align: 'right',
      render: (row) => (row.costPerT !== null ? formatMoney(row.costPerT, intlLocale) : '-'),
    },
    {
      key: 'perMp',
      header: t('transport.costPerMp'),
      align: 'right',
      render: (row) => (row.costPerMp !== null ? formatMoney(row.costPerMp, intlLocale) : '-'),
    },
  ];

  const partnerColumns: Array<Column<PartnerReport['items'][number]>> = [
    {
      key: 'partner',
      header: t('doc.partner'),
      render: (row) => (
        <>
          <div className="strong">{row.partnerName}</div>
          <div className="text-xs muted mono">{row.partnerCode}</div>
        </>
      ),
    },
    { key: 'docs', header: t('reports.documents'), align: 'right', render: (row) => row.documents },
    {
      key: 'purchase',
      header: t('reports.purchaseValue'),
      align: 'right',
      render: (row) => formatMoney(row.purchaseValue, intlLocale),
    },
    {
      key: 'sale',
      header: t('reports.saleValue'),
      align: 'right',
      render: (row) => formatMoney(row.saleValue, intlLocale),
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('reports.title')}</h1>
          <p className="page-subtitle">{t('reports.subtitle')}</p>
        </div>
        <div className="page-actions">
          {can('reports.export') ? <Button onClick={handleExport}>{t('action.export')}</Button> : null}
          <Button onClick={() => window.print()}>{t('action.print')}</Button>
        </div>
      </div>

      <Card tight>
        <div className="toolbar no-print">
          <SelectInput
            label={t('reports.mode')}
            value={mode}
            options={[
              { value: 'month', label: t('reports.mode.month') },
              { value: 'year', label: t('reports.mode.year') },
              { value: 'range', label: t('reports.mode.range') },
            ]}
            onChange={(event) => setMode(event.target.value as Mode)}
          />
          {mode === 'month' ? (
            <TextInput
              label={t('reports.mode.month')}
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          ) : null}
          {mode === 'year' ? (
            <TextInput
              label={t('reports.mode.year')}
              type="number"
              min={2000}
              max={2100}
              value={year}
              onChange={(event) => setYear(event.target.value)}
            />
          ) : null}
          {mode === 'range' ? (
            <>
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
            </>
          ) : null}
        </div>
      </Card>

      <div style={{ marginTop: 'var(--space-4)' }}>
        <Tabs<TabId>
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'summary', label: t('reports.tab.summary') },
            { id: 'production', label: t('reports.tab.production') },
            { id: 'transport', label: t('reports.tab.transport') },
            { id: 'partners', label: t('reports.tab.partners') },
          ]}
        />
      </div>

      {tab === 'summary' ? (
        <>
          <Card title={`${t('reports.byType')} · ${summary.data?.period.label ?? ''}`} tight>
            <DataTable
              columns={byTypeColumns}
              rows={summary.data?.byType ?? []}
              rowKey={(row) => row.docType}
              loading={summary.loading}
              error={summary.error}
              onRetry={summary.reload}
            />
          </Card>
          <Card title={t('reports.byProduct')} tight>
            <DataTable
              columns={byProductColumns}
              rows={summary.data?.byProduct ?? []}
              rowKey={(row, index) => `${row.productId}-${row.docType}-${index}`}
              loading={summary.loading}
              error={summary.error}
            />
          </Card>
          <Card title={t('reports.byMonth')} tight>
            <DataTable
              columns={byMonthColumns}
              rows={summary.data?.byMonth ?? []}
              rowKey={(row, index) => `${row.month}-${row.docType}-${index}`}
              loading={summary.loading}
              error={summary.error}
            />
          </Card>
        </>
      ) : null}

      {tab === 'production' ? (
        <>
          <div className="metrics">
            <MetricCard
              label={t('reports.documents')}
              value={String(production.data?.totals.documents ?? 0)}
            />
            <MetricCard
              label={t('production.input')}
              value={formatQty(production.data?.totals.inputQty ?? 0, intlLocale)}
              unit="m3"
            />
            <MetricCard
              label={t('production.output')}
              value={formatQty(production.data?.totals.outputQty ?? 0, intlLocale)}
              unit="MP"
              tone="info"
            />
            <MetricCard
              label={t('production.cost')}
              value={formatMoney(production.data?.totals.chippingCost ?? 0, intlLocale)}
              tone="warning"
            />
          </div>
          <Card title={t('reports.tab.production')} tight>
            <DataTable
              columns={productionColumns}
              rows={production.data?.items ?? []}
              rowKey={(row) => row.id}
              loading={production.loading}
              error={production.error}
              onRetry={production.reload}
            />
          </Card>
        </>
      ) : null}

      {tab === 'transport' ? (
        <>
          <div className="metrics">
            <MetricCard label={t('reports.documents')} value={String(transport.data?.totals.documents ?? 0)} />
            <MetricCard
              label={t('transport.distance')}
              value={formatQty(transport.data?.totals.distanceKm ?? 0, intlLocale)}
              unit="km"
            />
            <MetricCard
              label={t('transport.cost')}
              value={formatMoney(transport.data?.totals.cost ?? 0, intlLocale)}
              tone="warning"
            />
          </div>
          <Card title={t('reports.tab.transport')} tight>
            <DataTable
              columns={transportColumns}
              rows={transport.data?.items ?? []}
              rowKey={(row) => row.id}
              loading={transport.loading}
              error={transport.error}
              onRetry={transport.reload}
            />
          </Card>
        </>
      ) : null}

      {tab === 'partners' ? (
        <Card title={t('reports.tab.partners')} tight>
          <DataTable
            columns={partnerColumns}
            rows={partners.data?.items ?? []}
            rowKey={(row) => row.partnerId}
            loading={partners.loading}
            error={partners.error}
            onRetry={partners.reload}
          />
        </Card>
      ) : null}
    </>
  );
}

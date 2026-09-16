import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Attachment, DocumentDetail } from '../api/types';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';
import { useI18n, type TranslationKey } from '../i18n';
import { useApiData, useApiErrorMessage } from '../hooks/useApiData';
import { formatBytes, formatDate, formatDateTime, formatMoney, formatQty, UNIT_LABEL } from '../lib/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  DescriptionList,
  ErrorState,
  LoadingState,
  StatusBadge,
  TextArea,
} from '../components/ui';
import { ConfirmDialog, Modal } from '../components/ui/Modal';
import { DocumentPrint } from '../components/DocumentPrint';

const PERMISSION_PREFIX = { PZ: 'pz', WZ: 'wz', MM: 'mm', PROD: 'prod', TR: 'tr', SD: 'sd' } as const;

export function DocumentDetailPage() {
  const { id } = useParams();
  const documentId = Number(id);
  const { t, intlLocale } = useI18n();
  const { can, settings } = useAuth();
  const toast = useToast();
  const toMessage = useApiErrorMessage();
  const navigate = useNavigate();

  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<null | 'post' | 'cancel' | 'correct' | 'delete' | 'print'>(null);
  const [reason, setReason] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const { data, loading, error, reload } = useApiData<DocumentDetail>(
    (signal) => api.get<DocumentDetail>(`/documents/${documentId}`, undefined, signal),
    [documentId],
  );

  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const prefix = PERMISSION_PREFIX[data.docType];
  const canManage = can(`${prefix}.manage`);
  const canPost = can(`${prefix}.post`);
  const canCancel = can(`${prefix}.cancel`);
  const canAttach = can('attachments.manage');

  async function runAction(action: () => Promise<unknown>, successKey: TranslationKey) {
    setBusy(true);
    try {
      await action();
      toast.success(t(successKey));
      setDialog(null);
      setReason('');
      reload();
    } catch (err) {
      toast.error(t('state.error'), toMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(file: File) {
    const form = new FormData();
    form.append('file', file);
    setBusy(true);
    try {
      await api.upload<Attachment[]>(`/documents/${documentId}/attachments`, form);
      toast.success(t('msg.attachmentAdded'), file.name);
      reload();
    } catch (err) {
      toast.error(t('action.upload'), toMessage(err));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function openAttachment(attachment: Attachment) {
    try {
      const url = await api.attachmentUrl(attachment.id);
      window.open(url, '_blank', 'noopener');
      // Adres obiektowy zwalniamy po otwarciu karty, aby nie trzymac pamięci.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.error(t('action.download'), toMessage(err));
    }
  }

  const headerItems = [
    { label: t('doc.number'), value: <span className="mono strong">{data.docNumber}</span> },
    { label: t('doc.date'), value: formatDate(data.docDate, intlLocale) },
    { label: t('doc.status'), value: <StatusBadge status={data.status} /> },
    { label: t('doc.warehouse'), value: data.warehouseName ?? data.warehouseFromName ?? '-' },
    ...(data.warehouseToName ? [{ label: t('doc.warehouseTo'), value: data.warehouseToName }] : []),
    ...(data.supplierName ? [{ label: t('doc.supplier'), value: data.supplierName }] : []),
    ...(data.customerName ? [{ label: t('doc.customer'), value: data.customerName }] : []),
    ...(data.carrierName ? [{ label: t('doc.carrier'), value: data.carrierName }] : []),
    ...(data.vehiclePlate ? [{ label: t('transport.vehiclePlate'), value: data.vehiclePlate }] : []),
    ...(data.externalNumber ? [{ label: t('doc.externalNumber'), value: data.externalNumber }] : []),
    { label: t('doc.totalValue'), value: formatMoney(data.totalValue, intlLocale) },
    { label: t('doc.totalCost'), value: formatMoney(data.totalCost, intlLocale) },
    { label: t('doc.createdBy'), value: `${data.createdBy} · ${formatDateTime(data.createdAt, intlLocale)}` },
    ...(data.postedBy
      ? [{ label: t('doc.postedBy'), value: `${data.postedBy} · ${formatDateTime(data.postedAt, intlLocale)}` }]
      : []),
    ...(data.cancelledBy
      ? [
          {
            label: t('doc.cancelledBy'),
            value: `${data.cancelledBy} · ${formatDateTime(data.cancelledAt, intlLocale)}`,
          },
        ]
      : []),
  ];

  const forestItems =
    data.forestTicketNo || data.forestDistrict || data.forestSubdistrict
      ? [
          { label: t('forest.ticketNo'), value: data.forestTicketNo || '-' },
          { label: t('forest.district'), value: data.forestDistrict || '-' },
          { label: t('forest.subdistrict'), value: data.forestSubdistrict || '-' },
        ]
      : [];

  const productionItems =
    data.docType === 'PROD'
      ? [
          {
            label: t('production.mode'),
            value:
              data.chippingMode === 'EXTERNAL'
                ? `${t('production.mode.EXTERNAL')} — ${data.chippingCompany}`
                : t('production.mode.OWN'),
          },
          { label: t('production.rate'), value: formatMoney(data.chippingRate, intlLocale) },
          { label: t('production.cost'), value: formatMoney(data.chippingCost, intlLocale) },
          { label: t('production.place'), value: data.productionPlace || '-' },
          {
            label: t('production.yield'),
            value:
              data.totals.inputQtyBase > 0
                ? formatQty(data.totals.outputQtyBase / data.totals.inputQtyBase, intlLocale)
                : '-',
          },
        ]
      : [];

  const transportItems =
    data.docType === 'TR'
      ? [
          { label: t('transport.loadPlace'), value: data.loadPlace || '-' },
          { label: t('transport.unloadPlace'), value: data.unloadPlace || '-' },
          { label: t('transport.distance'), value: `${formatQty(data.distanceKm, intlLocale)} km` },
          { label: t('transport.rate'), value: formatMoney(data.transportRate, intlLocale) },
          { label: t('transport.cost'), value: formatMoney(data.transportCost, intlLocale) },
          {
            label: t('transport.costPerKm'),
            value: data.derived.costPerKm !== null ? formatMoney(data.derived.costPerKm, intlLocale) : '-',
          },
          {
            label: t('transport.costPerT'),
            value: data.derived.costPerT !== null ? formatMoney(data.derived.costPerT, intlLocale) : '-',
          },
          {
            label: t('transport.costPerMp'),
            value: data.derived.costPerMp !== null ? formatMoney(data.derived.costPerMp, intlLocale) : '-',
          },
          {
            label: t('transport.costPerM3'),
            value: data.derived.costPerM3 !== null ? formatMoney(data.derived.costPerM3, intlLocale) : '-',
          },
        ]
      : [];

  return (
    <>
      <div className="page-header no-print">
        <div>
          <h1 className="page-title">
            {t(`doc.${data.docType}` as TranslationKey)} <span className="mono">{data.docNumber}</span>
          </h1>
          <p className="page-subtitle">
            <StatusBadge status={data.status} />{' '}
            {data.correctionOfNumber ? (
              <>
                {' · '}
                {t('doc.correctionOf')}: <span className="mono">{data.correctionOfNumber}</span>
              </>
            ) : null}
            {data.correctedByNumber ? (
              <>
                {' · '}
                {t('doc.correctedBy')}: <span className="mono">{data.correctedByNumber}</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="page-actions">
          <Button onClick={() => navigate(-1)}>{t('action.back')}</Button>
          <Button onClick={() => setDialog('print')}>{t('action.print')}</Button>
          {data.status === 'DRAFT' && canManage ? (
            <Button onClick={() => navigate(`/documents/${data.id}/edit`)}>{t('action.edit')}</Button>
          ) : null}
          {data.status === 'DRAFT' && canPost ? (
            <Button variant="primary" onClick={() => setDialog('post')}>
              {t('action.post')}
            </Button>
          ) : null}
          {data.status === 'POSTED' && canCancel ? (
            <>
              <Button onClick={() => setDialog('correct')}>{t('action.correct')}</Button>
              <Button variant="danger" onClick={() => setDialog('cancel')}>
                {t('action.cancelDocument')}
              </Button>
            </>
          ) : null}
          {data.status === 'DRAFT' && canManage ? (
            <Button variant="danger" onClick={() => setDialog('delete')}>
              {t('action.delete')}
            </Button>
          ) : null}
        </div>
      </div>

      {data.status === 'CANCELLED' ? (
        <Alert tone="danger" title={t('status.CANCELLED')}>
          {data.cancelReason}
        </Alert>
      ) : null}
      {data.status === 'DRAFT' ? <Alert tone="warning">{t('msg.confirmPost')}</Alert> : null}

      <Card title={t('doc.summary')}>
        <DescriptionList items={headerItems} />
      </Card>

      {forestItems.length > 0 ? (
        <Card title={t('forest.section')}>
          <DescriptionList items={forestItems} />
        </Card>
      ) : null}

      {productionItems.length > 0 ? (
        <Card title={t('production.section')}>
          <DescriptionList items={productionItems} />
        </Card>
      ) : null}

      {transportItems.length > 0 ? (
        <Card title={t('transport.section')}>
          <DescriptionList items={transportItems} />
        </Card>
      ) : null}

      <Card title={t('doc.lines')} tight>
        <div className="table-wrap">
          <table className="table cards">
            <thead>
              <tr>
                <th>{t('line.no')}</th>
                {data.docType === 'PROD' ? <th>{t('line.role')}</th> : null}
                <th>{t('line.product')}</th>
                <th style={{ textAlign: 'right' }}>{t('line.quantity')}</th>
                <th style={{ textAlign: 'right' }}>m3</th>
                <th style={{ textAlign: 'right' }}>MP</th>
                <th style={{ textAlign: 'right' }}>t</th>
                <th style={{ textAlign: 'right' }}>{t('line.unitPrice')}</th>
                <th style={{ textAlign: 'right' }}>{t('line.value')}</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((line) => (
                <tr key={line.id}>
                  <td data-label={t('line.no')}>{line.lineNo}</td>
                  {data.docType === 'PROD' ? (
                    <td data-label={t('line.role')}>
                      <Badge tone={line.role === 'INPUT' ? 'warning' : 'success'} mark={line.role === 'INPUT' ? '−' : '+'}>
                        {line.role === 'INPUT' ? t('production.input') : t('production.output')}
                      </Badge>
                    </td>
                  ) : null}
                  <td data-label={t('line.product')}>
                    <div className="strong">{line.productName}</div>
                    <div className="text-xs muted mono">{line.productCode}</div>
                    {line.notes ? <div className="text-xs muted">{line.notes}</div> : null}
                  </td>
                  <td data-label={t('line.quantity')} className="num">
                    {formatQty(line.qtyBase, intlLocale)} {UNIT_LABEL[line.baseUnit]}
                  </td>
                  <td data-label="m3" className="num">
                    {formatQty(line.qtyM3, intlLocale)}
                    {line.qtyM3Manual ? <span className="text-xs"> ({t('line.manual')})</span> : null}
                  </td>
                  <td data-label="MP" className="num">
                    {formatQty(line.qtyMp, intlLocale)}
                    {line.qtyMpManual ? <span className="text-xs"> ({t('line.manual')})</span> : null}
                  </td>
                  <td data-label="t" className="num">
                    {formatQty(line.qtyT, intlLocale)}
                    {line.qtyTManual ? <span className="text-xs"> ({t('line.manual')})</span> : null}
                  </td>
                  <td data-label={t('line.unitPrice')} className="num">
                    {formatMoney(line.unitPrice, intlLocale)}
                  </td>
                  <td data-label={t('line.value')} className="num">
                    {formatMoney(line.value, intlLocale)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={data.docType === 'PROD' ? 3 : 2}>{t('reports.total')}</td>
                <td className="num">-</td>
                <td className="num">{formatQty(data.totals.qtyM3, intlLocale)}</td>
                <td className="num">{formatQty(data.totals.qtyMp, intlLocale)}</td>
                <td className="num">{formatQty(data.totals.qtyT, intlLocale)}</td>
                <td />
                <td className="num">{formatMoney(data.totalValue, intlLocale)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <Card
        title={t('doc.attachments')}
        actions={
          canAttach && data.status !== 'CANCELLED' ? (
            <>
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                style={{ display: 'none' }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleUpload(file);
                }}
              />
              <Button size="sm" loading={busy} onClick={() => fileInput.current?.click()}>
                {t('action.upload')}
              </Button>
            </>
          ) : null
        }
      >
        {data.attachments.length === 0 ? (
          <p className="muted text-sm" style={{ margin: 0 }}>
            {t('doc.noAttachments')} {canAttach ? t('doc.attachmentsHint') : ''}
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-2)' }}>
            {data.attachments.map((attachment) => (
              <li
                key={attachment.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  padding: 'var(--space-2) var(--space-3)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                }}
              >
                <span aria-hidden="true">{attachment.mimeType === 'application/pdf' ? '📄' : '🖼'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="strong" style={{ wordBreak: 'break-word' }}>
                    {attachment.originalName}
                  </div>
                  <div className="text-xs muted">
                    {formatBytes(attachment.sizeBytes, intlLocale)} · {attachment.uploadedBy} ·{' '}
                    {formatDateTime(attachment.uploadedAt, intlLocale)}
                  </div>
                </div>
                <Button size="sm" onClick={() => void openAttachment(attachment)}>
                  {t('action.download')}
                </Button>
                {canAttach && data.status === 'DRAFT' ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void runAction(() => api.delete(`/attachments/${attachment.id}`), 'msg.attachmentRemoved')
                    }
                  >
                    &times;
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {data.notes ? (
        <Card title={t('doc.notes')}>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{data.notes}</p>
        </Card>
      ) : null}

      <ConfirmDialog
        open={dialog === 'post'}
        title={t('action.post')}
        message={t('msg.confirmPost')}
        confirmLabel={t('action.post')}
        busy={busy}
        onCancel={() => setDialog(null)}
        onConfirm={() =>
          void runAction(() => api.post(`/documents/${data.id}/post`, { version: data.version }), 'msg.posted')
        }
      />

      <ConfirmDialog
        open={dialog === 'cancel'}
        title={t('action.cancelDocument')}
        confirmLabel={t('action.cancelDocument')}
        danger
        busy={busy}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (reason.trim().length < 3) {
            toast.error(t('msg.cancelReasonRequired'));
            return;
          }
          void runAction(
            () => api.post(`/documents/${data.id}/cancel`, { reason: reason.trim(), version: data.version }),
            'msg.cancelled',
          );
        }}
      >
        <TextArea
          label={t('doc.cancelReason')}
          required
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'correct'}
        title={t('action.correct')}
        confirmLabel={t('action.correct')}
        busy={busy}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (reason.trim().length < 3) {
            toast.error(t('msg.correctReasonRequired'));
            return;
          }
          setBusy(true);
          api
            .post<DocumentDetail>(`/documents/${data.id}/correct`, {
              reason: reason.trim(),
              version: data.version,
            })
            .then((created) => {
              toast.success(t('msg.corrected'), created.docNumber);
              setDialog(null);
              setReason('');
              navigate(`/documents/${created.id}/edit`);
            })
            .catch((err) => toast.error(t('action.correct'), toMessage(err)))
            .finally(() => setBusy(false));
        }}
      >
        <TextArea
          label={t('doc.cancelReason')}
          required
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'delete'}
        title={t('action.delete')}
        message={t('msg.confirmDelete')}
        danger
        busy={busy}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          setBusy(true);
          api
            .delete(`/documents/${data.id}`)
            .then(() => {
              toast.success(t('msg.deleted'));
              navigate(`/operations/${data.docType}`);
            })
            .catch((err) => toast.error(t('action.delete'), toMessage(err)))
            .finally(() => setBusy(false));
        }}
      />

      <Modal
        open={dialog === 'print'}
        title={`${t('action.print')} · ${data.docNumber}`}
        onClose={() => setDialog(null)}
        wide
        footer={
          <>
            <Button onClick={() => setDialog(null)}>{t('action.close')}</Button>
            <Button variant="primary" onClick={() => window.print()}>
              {t('action.print')}
            </Button>
          </>
        }
      >
        <div style={{ overflowX: 'auto' }}>
          <DocumentPrint document={data} settings={settings} />
        </div>
      </Modal>

      {/* Warstwa wydruku - widoczna wyłącznie podczas drukowania strony. */}
      <div className="print-only">
        <DocumentPrint document={data} settings={settings} />
      </div>
    </>
  );
}

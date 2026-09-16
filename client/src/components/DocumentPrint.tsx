import type { AppSettings, DocumentDetail } from '../api/types';
import { useI18n, type TranslationKey } from '../i18n';
import { formatDate, formatDateTime, formatMoney, formatQty, UNIT_LABEL } from '../lib/format';

/**
 * Wydruk dokumentu magazynowego w formacie A4.
 * Uklad odpowiada dokumentom obrotu towarowego stosowanym w obrocie biomasa:
 * naglowek z danymi wystawcy, strony transakcji, tabela pozycji i podpisy.
 */
export function DocumentPrint({
  document: doc,
  settings,
}: {
  document: DocumentDetail;
  settings: AppSettings | null;
}) {
  const { t, intlLocale } = useI18n();
  const company = settings?.company;

  const isProduction = doc.docType === 'PROD';
  const showPrices = ['PZ', 'WZ', 'SD'].includes(doc.docType);
  const lines = doc.lines;

  const sellerBlock =
    doc.docType === 'PZ'
      ? { label: t('doc.supplier'), name: doc.supplierName, extra: doc.forestDistrict }
      : { label: t('print.seller'), name: company?.name ?? t('app.company'), extra: company?.taxId ?? '' };

  const buyerBlock =
    doc.docType === 'PZ'
      ? { label: t('print.buyer'), name: company?.name ?? t('app.company'), extra: company?.taxId ?? '' }
      : doc.docType === 'MM'
        ? { label: t('print.to'), name: doc.warehouseToName ?? '', extra: '' }
        : { label: t('print.buyer'), name: doc.customerName ?? doc.carrierName ?? '', extra: '' };

  return (
    <div className="doc-sheet">
      {doc.status === 'CANCELLED' ? <div className="doc-watermark">{t('print.cancelledStamp')}</div> : null}
      {doc.status === 'DRAFT' ? <div className="doc-watermark">{t('print.draftStamp')}</div> : null}

      <header className="doc-head">
        <div>
          <div className="doc-company-name">{company?.name ?? t('app.company')}</div>
          <div>
            {company?.address}
            {company?.address && (company?.postalCode || company?.city) ? ', ' : ''}
            {company?.postalCode} {company?.city}
          </div>
          {company?.taxId ? <div>NIP: {company.taxId}</div> : null}
          {company?.phone ? <div>tel. {company.phone}</div> : null}
          {company?.email ? <div>{company.email}</div> : null}
        </div>
        <div>
          <div className="doc-title">{t(`doc.${doc.docType}.short` as TranslationKey)}</div>
          <div className="doc-number">{doc.docNumber}</div>
          <div className="doc-meta">
            {t('doc.date')}: {formatDate(doc.docDate, intlLocale)}
            <br />
            {t('print.originalCopy')}
          </div>
        </div>
      </header>

      <section className="doc-parties">
        <div className="doc-party">
          <div className="doc-party-label">{sellerBlock.label}</div>
          <div className="doc-party-name">{sellerBlock.name ?? '-'}</div>
          {sellerBlock.extra ? <div>{sellerBlock.extra}</div> : null}
          {doc.docType === 'MM' ? <div>{doc.warehouseFromName}</div> : null}
        </div>
        <div className="doc-party">
          <div className="doc-party-label">{buyerBlock.label}</div>
          <div className="doc-party-name">{buyerBlock.name || '-'}</div>
          {buyerBlock.extra ? <div>{buyerBlock.extra}</div> : null}
        </div>
      </section>

      <section className="doc-info">
        <div>
          <div className="doc-info-label">{t('doc.warehouse')}</div>
          <div>{doc.warehouseName ?? doc.warehouseFromName ?? '-'}</div>
        </div>
        {doc.warehouseToName ? (
          <div>
            <div className="doc-info-label">{t('doc.warehouseTo')}</div>
            <div>{doc.warehouseToName}</div>
          </div>
        ) : null}
        {doc.vehiclePlate ? (
          <div>
            <div className="doc-info-label">{t('transport.vehiclePlate')}</div>
            <div>{doc.vehiclePlate}</div>
          </div>
        ) : null}
        {doc.driverName ? (
          <div>
            <div className="doc-info-label">{t('transport.driver')}</div>
            <div>{doc.driverName}</div>
          </div>
        ) : null}
        {doc.externalNumber ? (
          <div>
            <div className="doc-info-label">{t('doc.externalNumber')}</div>
            <div>{doc.externalNumber}</div>
          </div>
        ) : null}
        {doc.forestTicketNo ? (
          <div>
            <div className="doc-info-label">{t('forest.ticketNo')}</div>
            <div>{doc.forestTicketNo}</div>
          </div>
        ) : null}
        {doc.forestSubdistrict ? (
          <div>
            <div className="doc-info-label">{t('forest.subdistrict')}</div>
            <div>{doc.forestSubdistrict}</div>
          </div>
        ) : null}
        {isProduction ? (
          <>
            <div>
              <div className="doc-info-label">{t('production.mode')}</div>
              <div>
                {doc.chippingMode === 'EXTERNAL'
                  ? `${t('production.mode.EXTERNAL')} — ${doc.chippingCompany}`
                  : t('production.mode.OWN')}
              </div>
            </div>
            <div>
              <div className="doc-info-label">{t('production.cost')}</div>
              <div>{formatMoney(doc.chippingCost, intlLocale)}</div>
            </div>
          </>
        ) : null}
        {doc.docType === 'TR' ? (
          <>
            <div>
              <div className="doc-info-label">{t('transport.distance')}</div>
              <div>{formatQty(doc.distanceKm, intlLocale)} km</div>
            </div>
            <div>
              <div className="doc-info-label">{t('transport.cost')}</div>
              <div>{formatMoney(doc.transportCost, intlLocale)}</div>
            </div>
            <div>
              <div className="doc-info-label">{t('transport.costPerKm')}</div>
              <div>{doc.derived.costPerKm !== null ? formatMoney(doc.derived.costPerKm, intlLocale) : '-'}</div>
            </div>
          </>
        ) : null}
      </section>

      <table className="doc-table">
        <thead>
          <tr>
            <th style={{ width: '6%' }}>{t('line.no')}</th>
            {isProduction ? <th style={{ width: '14%' }}>{t('line.role')}</th> : null}
            <th>{t('line.product')}</th>
            <th className="num" style={{ width: '12%' }}>
              {t('line.quantity')}
            </th>
            <th className="num" style={{ width: '10%' }}>
              m3
            </th>
            <th className="num" style={{ width: '10%' }}>
              MP
            </th>
            <th className="num" style={{ width: '10%' }}>
              t
            </th>
            {showPrices ? (
              <>
                <th className="num" style={{ width: '12%' }}>
                  {t('line.unitPrice')}
                </th>
                <th className="num" style={{ width: '13%' }}>
                  {t('line.value')}
                </th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id}>
              <td>{line.lineNo}</td>
              {isProduction ? (
                <td>{line.role === 'INPUT' ? t('production.input') : t('production.output')}</td>
              ) : null}
              <td>
                {line.productName}
                <br />
                <span style={{ fontSize: '8pt' }}>{line.productCode}</span>
                {line.notes ? <div style={{ fontSize: '8pt' }}>{line.notes}</div> : null}
              </td>
              <td className="num">
                {formatQty(line.qtyBase, intlLocale)} {UNIT_LABEL[line.baseUnit]}
              </td>
              <td className="num">
                {formatQty(line.qtyM3, intlLocale)}
                {line.qtyM3Manual ? '*' : ''}
              </td>
              <td className="num">
                {formatQty(line.qtyMp, intlLocale)}
                {line.qtyMpManual ? '*' : ''}
              </td>
              <td className="num">
                {formatQty(line.qtyT, intlLocale)}
                {line.qtyTManual ? '*' : ''}
              </td>
              {showPrices ? (
                <>
                  <td className="num">{formatMoney(line.unitPrice, intlLocale)}</td>
                  <td className="num">{formatMoney(line.value, intlLocale)}</td>
                </>
              ) : null}
            </tr>
          ))}
        </tbody>
        {showPrices ? (
          <tfoot>
            <tr>
              <td colSpan={isProduction ? 7 : 6}>{t('reports.total')}</td>
              <td className="num" colSpan={2}>
                {formatMoney(doc.totalValue, intlLocale)}
              </td>
            </tr>
          </tfoot>
        ) : null}
      </table>

      {lines.some((l) => l.qtyM3Manual || l.qtyMpManual || l.qtyTManual) ? (
        <p style={{ fontSize: '8pt' }}>
          * {t('line.manual')} — {t('print.manualNote')}.
        </p>
      ) : null}

      <div className="doc-notes">
        <div className="doc-notes-label">{t('doc.notes')}</div>
        <div>{doc.notes || ' '}</div>
        {doc.status === 'CANCELLED' && doc.cancelReason ? (
          <div style={{ marginTop: '2mm' }}>
            <strong>{t('doc.cancelReason')}:</strong> {doc.cancelReason}
          </div>
        ) : null}
      </div>

      <div className="doc-signatures">
        <div className="doc-sign">
          <div className="doc-sign-line">
            {t('print.issuedBy')}
            <br />
            {doc.postedBy ?? doc.createdBy}
          </div>
        </div>
        <div className="doc-sign">
          <div className="doc-sign-line">{t('print.receivedBy')}</div>
        </div>
      </div>

      <div className="doc-footer">
        <span>
          {t('app.name')} &middot; {doc.docNumber}
        </span>
        <span>
          {t('print.generated')}: {formatDateTime(new Date().toISOString(), intlLocale)}
        </span>
      </div>
    </div>
  );
}

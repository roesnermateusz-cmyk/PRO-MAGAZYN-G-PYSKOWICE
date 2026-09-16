import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type {
  ChippingMode,
  DocType,
  DocumentDetail,
  DocumentPayload,
  LinePayload,
  LineRole,
  Partner,
  Product,
  Warehouse,
} from '../api/types';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';
import { useI18n, type TranslationKey } from '../i18n';
import { useApiData, useApiErrorMessage } from '../hooks/useApiData';
import { formatQty, newRequestId, parseDecimal, todayIso, UNIT_LABEL } from '../lib/format';
import { deriveQuantities, ratesForProduct, type ConversionRates } from '../lib/units';
import {
  Alert,
  Button,
  Card,
  FormSection,
  LoadingState,
  RadioChips,
  SelectInput,
  TextArea,
  TextInput,
} from '../components/ui';

const DOC_TYPES: DocType[] = ['PZ', 'WZ', 'MM', 'PROD', 'TR', 'SD'];

interface LineState {
  key: string;
  productId: string;
  role: LineRole;
  qtyBase: string;
  qtyM3: string;
  qtyMp: string;
  qtyT: string;
  unitPrice: string;
  costUnitPrice: string;
  notes: string;
}

function emptyLine(role: LineRole = 'STD'): LineState {
  return {
    key: newRequestId(),
    productId: '',
    role,
    qtyBase: '',
    qtyM3: '',
    qtyMp: '',
    qtyT: '',
    unitPrice: '',
    costUnitPrice: '',
    notes: '',
  };
}

interface HeaderState {
  docDate: string;
  warehouseId: string;
  warehouseFromId: string;
  warehouseToId: string;
  supplierId: string;
  customerId: string;
  carrierId: string;
  forestTicketNo: string;
  forestDistrict: string;
  forestSubdistrict: string;
  chippingMode: ChippingMode;
  chippingCompany: string;
  chippingRate: string;
  productionPlace: string;
  vehiclePlate: string;
  driverName: string;
  loadPlace: string;
  unloadPlace: string;
  distanceKm: string;
  transportRate: string;
  transportCost: string;
  externalNumber: string;
  notes: string;
}

function emptyHeader(defaults: { warehouseId: number | null; chippingMode: ChippingMode }): HeaderState {
  return {
    docDate: todayIso(),
    warehouseId: defaults.warehouseId ? String(defaults.warehouseId) : '',
    warehouseFromId: defaults.warehouseId ? String(defaults.warehouseId) : '',
    warehouseToId: '',
    supplierId: '',
    customerId: '',
    carrierId: '',
    forestTicketNo: '',
    forestDistrict: '',
    forestSubdistrict: '',
    chippingMode: defaults.chippingMode,
    chippingCompany: '',
    chippingRate: '',
    productionPlace: '',
    vehiclePlate: '',
    driverName: '',
    loadPlace: '',
    unloadPlace: '',
    distanceKm: '',
    transportRate: '',
    transportCost: '',
    externalNumber: '',
    notes: '',
  };
}

export function DocumentFormPage() {
  const params = useParams();
  const editId = params.id ? Number(params.id) : null;
  const docTypeParam = params.docType as DocType | undefined;

  const { t, intlLocale } = useI18n();
  const { warehouseId: activeWarehouse, warehouses, settings, can } = useAuth();
  const toast = useToast();
  const toMessage = useApiErrorMessage();
  const navigate = useNavigate();

  const globalRates: ConversionRates = settings?.conversion ?? { m3PerMp: 0.25, tPerMp: 0.33 };
  const defaultChipping: ChippingMode = settings?.rates.chippingDefaultMode ?? 'OWN';

  const [docType, setDocType] = useState<DocType>(docTypeParam && DOC_TYPES.includes(docTypeParam) ? docTypeParam : 'PZ');
  const [header, setHeader] = useState<HeaderState>(() =>
    emptyHeader({ warehouseId: activeWarehouse, chippingMode: defaultChipping }),
  );
  const [lines, setLines] = useState<LineState[]>(() => [emptyLine(docTypeParam === 'PROD' ? 'INPUT' : 'STD')]);
  const [version, setVersion] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Klucz idempotencji - powtorne wyslanie tego samego formularza nie utworzy duplikatu.
  const requestId = useRef(newRequestId());

  const products = useApiData<{ items: Product[] }>((signal) => api.get('/products', undefined, signal), []);
  const partners = useApiData<{ items: Partner[] }>((signal) => api.get('/partners', undefined, signal), []);
  const warehousesFull = useApiData<{ items: Warehouse[] }>((signal) => api.get('/warehouses', undefined, signal), []);

  const existing = useApiData<DocumentDetail>(
    (signal) => api.get<DocumentDetail>(`/documents/${editId}`, undefined, signal),
    [editId],
    { enabled: editId !== null },
  );

  // Wypelnienie formularza danymi edytowanego dokumentu.
  useEffect(() => {
    const doc = existing.data;
    if (!doc) return;
    setDocType(doc.docType);
    setVersion(doc.version);
    setHeader({
      docDate: doc.docDate,
      warehouseId: doc.warehouseId ? String(doc.warehouseId) : '',
      warehouseFromId: doc.warehouseFromId ? String(doc.warehouseFromId) : '',
      warehouseToId: doc.warehouseToId ? String(doc.warehouseToId) : '',
      supplierId: doc.supplierId ? String(doc.supplierId) : '',
      customerId: doc.customerId ? String(doc.customerId) : '',
      carrierId: doc.carrierId ? String(doc.carrierId) : '',
      forestTicketNo: doc.forestTicketNo,
      forestDistrict: doc.forestDistrict,
      forestSubdistrict: doc.forestSubdistrict,
      chippingMode: doc.chippingMode ?? defaultChipping,
      chippingCompany: doc.chippingCompany,
      chippingRate: doc.chippingRate ? String(doc.chippingRate) : '',
      productionPlace: doc.productionPlace,
      vehiclePlate: doc.vehiclePlate,
      driverName: doc.driverName,
      loadPlace: doc.loadPlace,
      unloadPlace: doc.unloadPlace,
      distanceKm: doc.distanceKm ? String(doc.distanceKm) : '',
      transportRate: doc.transportRate ? String(doc.transportRate) : '',
      transportCost: doc.transportCost ? String(doc.transportCost) : '',
      externalNumber: doc.externalNumber,
      notes: doc.notes,
    });
    setLines(
      doc.lines.map((line) => ({
        key: `line-${line.id}`,
        productId: String(line.productId),
        role: line.role,
        qtyBase: String(line.qtyBase),
        qtyM3: line.qtyM3Manual ? String(line.qtyM3) : '',
        qtyMp: line.qtyMpManual ? String(line.qtyMp) : '',
        qtyT: line.qtyTManual ? String(line.qtyT) : '',
        unitPrice: line.unitPrice ? String(line.unitPrice) : '',
        costUnitPrice: line.costUnitPrice ? String(line.costUnitPrice) : '',
        notes: line.notes,
      })),
    );
  }, [existing.data, defaultChipping]);

  // Produkcja wymaga pozycji wejsciowej i wyjsciowej - przygotowujemy je od razu.
  useEffect(() => {
    if (editId !== null) return;
    setLines(docType === 'PROD' ? [emptyLine('INPUT'), emptyLine('OUTPUT')] : [emptyLine('STD')]);
  }, [docType, editId]);

  // Stabilne referencje list - bez nich useMemo ponizej przeliczalby się
  // przy każdym renderze formularza.
  const productList = useMemo(() => products.data?.items ?? [], [products.data]);
  const partnerList = useMemo(() => partners.data?.items ?? [], [partners.data]);
  const warehouseList = useMemo(
    () => warehousesFull.data?.items ?? (warehouses as unknown as Warehouse[]),
    [warehousesFull.data, warehouses],
  );

  const productById = useMemo(() => new Map(productList.map((p) => [p.id, p])), [productList]);

  const supplierOptions = partnerList
    .filter((p) => p.isSupplier)
    .map((p) => ({ value: String(p.id), label: p.name }));
  const customerOptions = partnerList
    .filter((p) => p.isCustomer)
    .map((p) => ({ value: String(p.id), label: p.name }));
  const carrierOptions = partnerList
    .filter((p) => p.isCarrier)
    .map((p) => ({ value: String(p.id), label: p.name }));
  const warehouseOptions = warehouseList
    .filter((w) => w.isActive !== false)
    .map((w) => ({ value: String(w.id), label: w.name }));
  const productOptions = productList.map((p) => ({
    value: String(p.id),
    label: `${p.code} · ${p.name} [${UNIT_LABEL[p.baseUnit]}]`,
  }));

  const selectedSupplier = partnerList.find((p) => String(p.id) === header.supplierId);
  const showForestFields = docType === 'PZ';

  function patchHeader(patch: Partial<HeaderState>) {
    setHeader((prev) => ({ ...prev, ...patch }));
  }

  function patchLine(key: string, patch: Partial<LineState>) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  // Wybor nadleśnictwa automatycznie uzupelnia nazwe w danych kwitu.
  useEffect(() => {
    if (docType !== 'PZ' || !selectedSupplier?.isForestry) return;
    setHeader((prev) =>
      prev.forestDistrict === '' ? { ...prev, forestDistrict: selectedSupplier.name } : prev,
    );
  }, [docType, selectedSupplier]);

  function validate(): string | null {
    if (!header.docDate) return t('msg.requiredField');
    if (['PZ', 'WZ', 'PROD'].includes(docType) && !header.warehouseId) return t('doc.warehouse');
    if (docType === 'MM') {
      if (!header.warehouseFromId || !header.warehouseToId) return t('doc.warehouseFrom');
      if (header.warehouseFromId === header.warehouseToId) return t('doc.warehouseTo');
    }
    if (['PZ', 'SD'].includes(docType) && !header.supplierId) return t('doc.supplier');
    if (['WZ', 'SD'].includes(docType) && !header.customerId) return t('doc.customer');
    if (docType === 'TR' && !header.carrierId && header.vehiclePlate.trim() === '') return t('doc.carrier');
    if (docType === 'PROD' && header.chippingMode === 'EXTERNAL' && header.chippingCompany.trim() === '') {
      return t('production.company');
    }

    const usable = lines.filter((line) => line.productId !== '' && parseDecimal(line.qtyBase) !== null);
    if (usable.length === 0) return t('line.empty');
    for (const line of usable) {
      const qty = parseDecimal(line.qtyBase);
      if (qty === null || qty <= 0) return t('msg.positiveNumber');
    }
    if (docType === 'PROD') {
      if (!usable.some((line) => line.role === 'INPUT')) return t('production.input');
      if (!usable.some((line) => line.role === 'OUTPUT')) return t('production.output');
    }
    return null;
  }

  function buildPayload(): DocumentPayload {
    const optionalNumber = (value: string): number | null => {
      const parsed = parseDecimal(value);
      return parsed === null ? null : parsed;
    };

    const payloadLines: LinePayload[] = lines
      .filter((line) => line.productId !== '' && parseDecimal(line.qtyBase) !== null)
      .map((line) => ({
        productId: Number(line.productId),
        role: line.role,
        qtyBase: parseDecimal(line.qtyBase) as number,
        qtyM3: optionalNumber(line.qtyM3),
        qtyMp: optionalNumber(line.qtyMp),
        qtyT: optionalNumber(line.qtyT),
        unitPrice: parseDecimal(line.unitPrice) ?? 0,
        costUnitPrice: parseDecimal(line.costUnitPrice) ?? 0,
        notes: line.notes,
      }));

    return {
      docType,
      docDate: header.docDate,
      warehouseId: header.warehouseId ? Number(header.warehouseId) : null,
      warehouseFromId: header.warehouseFromId ? Number(header.warehouseFromId) : null,
      warehouseToId: header.warehouseToId ? Number(header.warehouseToId) : null,
      supplierId: header.supplierId ? Number(header.supplierId) : null,
      customerId: header.customerId ? Number(header.customerId) : null,
      carrierId: header.carrierId ? Number(header.carrierId) : null,
      forestTicketNo: header.forestTicketNo,
      forestDistrict: header.forestDistrict,
      forestSubdistrict: header.forestSubdistrict,
      chippingMode: docType === 'PROD' ? header.chippingMode : null,
      chippingCompany: header.chippingCompany,
      chippingRate: docType === 'PROD' ? optionalNumber(header.chippingRate) : null,
      productionPlace: header.productionPlace,
      vehiclePlate: header.vehiclePlate,
      driverName: header.driverName,
      loadPlace: header.loadPlace,
      unloadPlace: header.unloadPlace,
      distanceKm: parseDecimal(header.distanceKm) ?? 0,
      transportRate: docType === 'TR' ? optionalNumber(header.transportRate) : null,
      transportCost: docType === 'TR' ? optionalNumber(header.transportCost) : null,
      externalNumber: header.externalNumber,
      notes: header.notes,
      lines: payloadLines,
    };
  }

  async function handleSubmit() {
    const problem = validate();
    if (problem) {
      setFormError(problem);
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      const payload = buildPayload();
      if (editId !== null && version !== null) {
        const updated = await api.put<DocumentDetail>(`/documents/${editId}`, { ...payload, version });
        toast.success(t('msg.saved'), updated.docNumber);
        navigate(`/documents/${updated.id}`);
      } else {
        const created = await api.post<DocumentDetail>('/documents', {
          ...payload,
          clientRequestId: requestId.current,
        });
        toast.success(t('msg.created'), created.docNumber);
        navigate(`/documents/${created.id}`);
      }
    } catch (err) {
      const message = toMessage(err);
      setFormError(message);
      toast.error(t('action.save'), message);
      // Nowy klucz po bledzie - kolejna próba jest osobnym żądaniem.
      requestId.current = newRequestId();
    } finally {
      setSubmitting(false);
    }
  }

  if (editId !== null && existing.loading && !existing.data) return <LoadingState />;
  if (editId !== null && existing.error) return <Alert tone="danger">{existing.error}</Alert>;
  if (editId !== null && existing.data && existing.data.status !== 'DRAFT') {
    return <Alert tone="warning">{t('error.INVALID_STATE')}</Alert>;
  }

  const canManage = can(`${{ PZ: 'pz', WZ: 'wz', MM: 'mm', PROD: 'prod', TR: 'tr', SD: 'sd' }[docType]}.manage`);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">
            {editId ? `${t('action.edit')} · ${existing.data?.docNumber ?? ''}` : t(`doc.${docType}` as TranslationKey)}
          </h1>
          <p className="page-subtitle">
            {editId ? t('status.DRAFT') : t('action.create')} &middot; {t(`doc.${docType}.short` as TranslationKey)}
          </p>
        </div>
        <div className="page-actions">
          <Button onClick={() => navigate(-1)}>{t('action.back')}</Button>
          <Button variant="primary" onClick={handleSubmit} loading={submitting} disabled={!canManage}>
            {t('action.saveDraft')}
          </Button>
        </div>
      </div>

      {!canManage ? <Alert tone="danger">{t('error.FORBIDDEN')}</Alert> : null}
      {formError ? <Alert tone="danger">{formError}</Alert> : null}
      {docType === 'PROD' ? <Alert tone="info">{t('production.autoConsumption')}</Alert> : null}
      {docType === 'SD' ? <Alert tone="info">{t('doc.SD')}</Alert> : null}

      <Card title={t('doc.summary')}>
        <FormSection title={t('doc.summary')}>
          <TextInput
            label={t('doc.date')}
            type="date"
            value={header.docDate}
            required
            onChange={(event) => patchHeader({ docDate: event.target.value })}
          />

          {['PZ', 'WZ', 'PROD'].includes(docType) ? (
            <SelectInput
              label={t('doc.warehouse')}
              required
              value={header.warehouseId}
              placeholder="—"
              options={warehouseOptions}
              onChange={(event) => patchHeader({ warehouseId: event.target.value })}
            />
          ) : null}

          {['MM', 'TR'].includes(docType) ? (
            <>
              <SelectInput
                label={t('doc.warehouseFrom')}
                required={docType === 'MM'}
                value={header.warehouseFromId}
                placeholder="—"
                options={warehouseOptions}
                onChange={(event) => patchHeader({ warehouseFromId: event.target.value })}
              />
              <SelectInput
                label={t('doc.warehouseTo')}
                required={docType === 'MM'}
                value={header.warehouseToId}
                placeholder="—"
                options={warehouseOptions}
                onChange={(event) => patchHeader({ warehouseToId: event.target.value })}
              />
            </>
          ) : null}

          {['PZ', 'SD'].includes(docType) ? (
            <SelectInput
              label={t('doc.supplier')}
              required
              value={header.supplierId}
              placeholder="—"
              options={supplierOptions}
              onChange={(event) => patchHeader({ supplierId: event.target.value })}
            />
          ) : null}

          {['WZ', 'SD'].includes(docType) ? (
            <SelectInput
              label={t('doc.customer')}
              required
              value={header.customerId}
              placeholder="—"
              options={customerOptions}
              onChange={(event) => patchHeader({ customerId: event.target.value })}
            />
          ) : null}

          {docType === 'TR' ? (
            <SelectInput
              label={t('doc.carrier')}
              value={header.carrierId}
              placeholder="—"
              options={carrierOptions}
              onChange={(event) => patchHeader({ carrierId: event.target.value })}
            />
          ) : null}

          <TextInput
            label={t('doc.externalNumber')}
            value={header.externalNumber}
            maxLength={60}
            onChange={(event) => patchHeader({ externalNumber: event.target.value })}
          />
        </FormSection>

        {showForestFields ? (
          <FormSection title={t('forest.section')}>
            <TextInput
              label={t('forest.ticketNo')}
              value={header.forestTicketNo}
              maxLength={60}
              onChange={(event) => patchHeader({ forestTicketNo: event.target.value })}
            />
            <TextInput
              label={t('forest.district')}
              value={header.forestDistrict}
              maxLength={120}
              onChange={(event) => patchHeader({ forestDistrict: event.target.value })}
            />
            <TextInput
              label={t('forest.subdistrict')}
              value={header.forestSubdistrict}
              maxLength={120}
              onChange={(event) => patchHeader({ forestSubdistrict: event.target.value })}
            />
          </FormSection>
        ) : null}

        {docType === 'PROD' ? (
          <FormSection title={t('production.section')}>
            <div className="field">
              <RadioChips<ChippingMode>
                label={t('production.mode')}
                value={header.chippingMode}
                options={[
                  { value: 'OWN', label: t('production.mode.OWN') },
                  { value: 'EXTERNAL', label: t('production.mode.EXTERNAL') },
                ]}
                onChange={(value) => patchHeader({ chippingMode: value })}
              />
            </div>
            {header.chippingMode === 'EXTERNAL' ? (
              <TextInput
                label={t('production.company')}
                required
                value={header.chippingCompany}
                maxLength={200}
                onChange={(event) => patchHeader({ chippingCompany: event.target.value })}
              />
            ) : null}
            <TextInput
              label={t('production.rate')}
              value={header.chippingRate}
              inputMode="decimal"
              placeholder={String(settings?.rates.chippingPlnPerUnit ?? 10)}
              hint={t('transport.costAuto')}
              onChange={(event) => patchHeader({ chippingRate: event.target.value })}
            />
            <TextInput
              label={t('production.place')}
              value={header.productionPlace}
              maxLength={200}
              onChange={(event) => patchHeader({ productionPlace: event.target.value })}
            />
          </FormSection>
        ) : null}

        <FormSection title={t('transport.section')}>
          <TextInput
            label={t('transport.vehiclePlate')}
            value={header.vehiclePlate}
            maxLength={30}
            style={{ textTransform: 'uppercase' }}
            onChange={(event) => patchHeader({ vehiclePlate: event.target.value.toUpperCase() })}
          />
          <TextInput
            label={t('transport.driver')}
            value={header.driverName}
            maxLength={120}
            onChange={(event) => patchHeader({ driverName: event.target.value })}
          />
          {docType === 'TR' ? (
            <>
              <TextInput
                label={t('transport.loadPlace')}
                value={header.loadPlace}
                maxLength={200}
                onChange={(event) => patchHeader({ loadPlace: event.target.value })}
              />
              <TextInput
                label={t('transport.unloadPlace')}
                value={header.unloadPlace}
                maxLength={200}
                onChange={(event) => patchHeader({ unloadPlace: event.target.value })}
              />
              <TextInput
                label={t('transport.distance')}
                value={header.distanceKm}
                inputMode="decimal"
                onChange={(event) => patchHeader({ distanceKm: event.target.value })}
              />
              <TextInput
                label={t('transport.rate')}
                value={header.transportRate}
                inputMode="decimal"
                placeholder={String(settings?.rates.transportPlnPerKm ?? 5)}
                onChange={(event) => patchHeader({ transportRate: event.target.value })}
              />
              <TextInput
                label={t('transport.cost')}
                value={header.transportCost}
                inputMode="decimal"
                hint={t('transport.costAuto')}
                onChange={(event) => patchHeader({ transportCost: event.target.value })}
              />
            </>
          ) : null}
        </FormSection>
      </Card>

      <Card
        title={t('doc.lines')}
        actions={
          <>
            {docType === 'PROD' ? (
              <>
                <Button size="sm" onClick={() => setLines((prev) => [...prev, emptyLine('INPUT')])}>
                  + {t('production.input')}
                </Button>
                <Button size="sm" onClick={() => setLines((prev) => [...prev, emptyLine('OUTPUT')])}>
                  + {t('production.output')}
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setLines((prev) => [...prev, emptyLine('STD')])}>
                + {t('action.addLine')}
              </Button>
            )}
          </>
        }
        tight
      >
        <div className="table-wrap">
          <table className="lines-table">
            <thead>
              <tr>
                <th style={{ width: 34 }}>{t('line.no')}</th>
                {docType === 'PROD' ? <th style={{ width: 130 }}>{t('line.role')}</th> : null}
                <th style={{ minWidth: 220 }}>{t('line.product')}</th>
                <th style={{ width: 190 }}>{t('line.quantity')}</th>
                {docType !== 'MM' && docType !== 'PROD' ? (
                  <th style={{ width: 120 }}>{t('line.unitPrice')}</th>
                ) : null}
                {docType === 'SD' ? <th style={{ width: 120 }}>{t('line.costPrice')}</th> : null}
                <th style={{ minWidth: 140 }}>{t('line.notes')}</th>
                <th style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const product = productById.get(Number(line.productId));
                const qty = parseDecimal(line.qtyBase) ?? 0;
                const rates = ratesForProduct(product, globalRates);
                const derived = product ? deriveQuantities(qty, product.baseUnit, rates) : null;
                const manualM3 = parseDecimal(line.qtyM3);
                const manualMp = parseDecimal(line.qtyMp);
                const manualT = parseDecimal(line.qtyT);

                return (
                  <tr key={line.key}>
                    <td className="muted">{index + 1}</td>
                    {docType === 'PROD' ? (
                      <td>
                        <select
                          className="select"
                          value={line.role}
                          aria-label={t('line.role')}
                          onChange={(event) => patchLine(line.key, { role: event.target.value as LineRole })}
                        >
                          <option value="INPUT">{t('production.input')}</option>
                          <option value="OUTPUT">{t('production.output')}</option>
                        </select>
                      </td>
                    ) : null}
                    <td>
                      <select
                        className="select"
                        value={line.productId}
                        aria-label={t('line.product')}
                        onChange={(event) => patchLine(line.key, { productId: event.target.value })}
                      >
                        <option value="">—</option>
                        {productOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          className="input num-input"
                          inputMode="decimal"
                          value={line.qtyBase}
                          aria-label={t('line.quantity')}
                          onChange={(event) => patchLine(line.key, { qtyBase: event.target.value })}
                        />
                        <span className="text-sm muted nowrap">
                          {product ? UNIT_LABEL[product.baseUnit] : ''}
                        </span>
                      </div>
                      {derived && product && product.baseUnit !== 'SZT' ? (
                        <div className="line-derived">
                          <span className={manualM3 !== null ? 'manual' : ''}>
                            {formatQty(manualM3 ?? derived.m3, intlLocale)} m3
                            {manualM3 !== null ? ` (${t('line.manual')})` : ''}
                          </span>
                          <span className={manualMp !== null ? 'manual' : ''}>
                            {formatQty(manualMp ?? derived.mp, intlLocale)} MP
                            {manualMp !== null ? ` (${t('line.manual')})` : ''}
                          </span>
                          <span className={manualT !== null ? 'manual' : ''}>
                            {formatQty(manualT ?? derived.t, intlLocale)} t
                            {manualT !== null ? ` (${t('line.manual')})` : ''}
                          </span>
                        </div>
                      ) : null}
                      {product && product.baseUnit !== 'SZT' ? (
                        <details style={{ marginTop: 4 }}>
                          <summary className="text-xs muted" style={{ cursor: 'pointer' }}>
                            {t('line.autoCalculated')}
                          </summary>
                          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                            <input
                              className="input num-input"
                              inputMode="decimal"
                              placeholder="m3"
                              aria-label="m3"
                              value={line.qtyM3}
                              onChange={(event) => patchLine(line.key, { qtyM3: event.target.value })}
                            />
                            <input
                              className="input num-input"
                              inputMode="decimal"
                              placeholder="MP"
                              aria-label="MP"
                              value={line.qtyMp}
                              onChange={(event) => patchLine(line.key, { qtyMp: event.target.value })}
                            />
                            <input
                              className="input num-input"
                              inputMode="decimal"
                              placeholder="t"
                              aria-label="t"
                              value={line.qtyT}
                              onChange={(event) => patchLine(line.key, { qtyT: event.target.value })}
                            />
                          </div>
                        </details>
                      ) : null}
                    </td>
                    {docType !== 'MM' && docType !== 'PROD' ? (
                      <td>
                        <input
                          className="input num-input"
                          inputMode="decimal"
                          value={line.unitPrice}
                          aria-label={t('line.unitPrice')}
                          onChange={(event) => patchLine(line.key, { unitPrice: event.target.value })}
                        />
                      </td>
                    ) : null}
                    {docType === 'SD' ? (
                      <td>
                        <input
                          className="input num-input"
                          inputMode="decimal"
                          value={line.costUnitPrice}
                          aria-label={t('line.costPrice')}
                          onChange={(event) => patchLine(line.key, { costUnitPrice: event.target.value })}
                        />
                      </td>
                    ) : null}
                    <td>
                      <input
                        className="input"
                        value={line.notes}
                        maxLength={500}
                        aria-label={t('line.notes')}
                        onChange={(event) => patchLine(line.key, { notes: event.target.value })}
                      />
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t('action.removeLine')}
                        disabled={lines.length <= 1}
                        onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                      >
                        &times;
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <TextArea
          label={t('doc.notes')}
          value={header.notes}
          maxLength={2000}
          onChange={(event) => patchHeader({ notes: event.target.value })}
        />
        <div className="btn-group" style={{ marginTop: 'var(--space-3)' }}>
          <Button variant="primary" onClick={handleSubmit} loading={submitting} disabled={!canManage}>
            {t('action.saveDraft')}
          </Button>
          <Button onClick={() => navigate(-1)}>{t('action.cancel')}</Button>
        </div>
      </Card>
    </>
  );
}

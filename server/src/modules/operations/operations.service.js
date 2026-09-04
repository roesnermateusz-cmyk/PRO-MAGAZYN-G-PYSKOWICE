/**
 * Rejestr operacji magazynowych — księgowanie dokumentów PZ / WZ / PW / RW / MM / BO.
 *
 * Odpowiedzialności:
 *  • walidacja i normalizacja danych dokumentu,
 *  • przeliczenie ilości i wartości (silnik `domain/units.js`),
 *  • nadanie numeru dokumentu (`domain/documents.js`),
 *  • wygenerowanie ruchów magazynowych (`domain/stock.js`),
 *  • kontrola okresu rozliczeniowego i stanów ujemnych,
 *  • rejestracja korekt przy edycji i storno przy anulowaniu.
 *
 * Każdy zapis wykonuje się w jednej transakcji: dokument, ruchy, korekta i wpis
 * audytowy powstają razem albo wcale.
 */
import db from '../../db/index.js';
import { uuid } from '../../lib/crypto.js';
import { validate } from '../../lib/validate.js';
import { NotFoundError, ConflictError, ValidationError, ForbiddenError } from '../../lib/errors.js';
import { computeQuantities, computeValues, resolveFactors, roundMoney, roundQty } from '../../domain/units.js';
import { allocateDocNumber, seriesForType, OPERATION_TYPES, TYPE_DIRECTION } from '../../domain/documents.js';
import { deriveMoves, validateWarehouses, stockAt } from '../../domain/stock.js';
import { getUnitFactors, getSetting } from '../settings/settings.service.js';
import { products, partners, warehouses, vehicles, forest, loadingPlaces } from '../catalog/catalog.service.js';
import { assertPeriodOpen } from '../periods/periods.service.js';
import { audit } from '../../middleware/audit.js';

/* ------------------------------ Schemat ------------------------------- */

const OPERATION_SCHEMA = {
  type: { type: 'enum', values: OPERATION_TYPES, required: true, label: 'Typ operacji' },
  operationDate: { type: 'date', required: true, label: 'Data operacji' },
  loadingDate: { type: 'date', label: 'Data załadunku' },

  productId: { type: 'string', max: 40, label: 'Produkt (kartoteka)' },
  productName: { type: 'string', max: 120, label: 'Produkt' },
  grade: { type: 'string', max: 10, upper: true, label: 'Rodzaj (A/B)' },

  quantity: { type: 'number', required: true, min: 0.001, max: 1_000_000, label: 'Wolumen' },
  unit: { type: 'enum', values: ['M3', 'MP', 'TONA'], required: true, label: 'Jednostka' },
  m3Mode: { type: 'enum', values: ['AUTO', 'RECZNIE'], default: 'AUTO', label: 'Tryb m³' },
  m3Manual: { type: 'number', min: 0, max: 1_000_000, label: 'Rzeczywiste m³' },
  mpMode: { type: 'enum', values: ['AUTO', 'RECZNIE'], default: 'AUTO', label: 'Tryb MP' },
  mpManual: { type: 'number', min: 0, max: 1_000_000, label: 'Rzeczywiste MP' },
  tonneMode: { type: 'enum', values: ['AUTO', 'RECZNIE'], default: 'AUTO', label: 'Tryb ton' },
  tonneManual: { type: 'number', min: 0, max: 1_000_000, label: 'Masa rzeczywista' },

  warehouseFrom: { type: 'string', max: 120, label: 'Magazyn źródłowy' },
  warehouseTo: { type: 'string', max: 120, label: 'Magazyn docelowy' },
  supplierName: { type: 'string', max: 160, label: 'Dostawca / źródło' },
  recipientName: { type: 'string', max: 160, label: 'Odbiorca / cel' },

  loadingPlace: { type: 'string', max: 160, label: 'Miejsce załadunku' },
  originPlace: { type: 'string', max: 160, label: 'Miejsce pochodzenia' },
  forestDistrict: { type: 'string', max: 120, label: 'Nadleśnictwo' },
  forestRange: { type: 'string', max: 120, label: 'Leśnictwo' },
  haulageNoteNo: { type: 'string', max: 60, label: 'Nr kwitu wywozowego' },

  pricePurchase: { type: 'number', min: 0, max: 1_000_000, default: 0, label: 'Cena zakupu / produkcji' },
  priceSale: { type: 'number', min: 0, max: 1_000_000, default: 0, label: 'Cena sprzedaży' },
  chippingMode: { type: 'string', max: 40, label: 'Rąbanie' },
  chippingPrice: { type: 'number', min: 0, max: 1_000_000, default: 0, label: 'Koszt rąbania' },

  carrierName: { type: 'string', max: 160, label: 'Firma transportowa / kierowca' },
  vehiclePlate: { type: 'string', max: 20, upper: true, label: 'Nr rejestracyjny' },
  distanceKm: { type: 'number', min: 0, max: 100_000, default: 0, label: 'Odległość (km)' },
  transportCost: { type: 'number', min: 0, max: 10_000_000, default: 0, label: 'Koszt transportu' },

  certificate: { type: 'string', max: 20, upper: true, default: 'BRAK', label: 'Certyfikat' },
  isStored: { type: 'bool', default: true, label: 'Magazynowane' },

  notes: { type: 'string', max: 2000, label: 'Uwagi' },
  signature: { type: 'string', max: 120, label: 'Podpis zatwierdzającego' },
  chainRef: { type: 'string', max: 40, label: 'Powiązanie łańcucha' },
  parentId: { type: 'string', max: 40, label: 'Dokument nadrzędny' },
};

/** Etykiety pól używane w rejestrze korekt (czytelne dla kontrolera). */
export const FIELD_LABELS = Object.freeze({
  type: 'Typ operacji', operation_date: 'Data operacji', loading_date: 'Data załadunku',
  product_name: 'Produkt', grade: 'Rodzaj', quantity: 'Wolumen', unit: 'Jednostka',
  qty_m3: 'Ilość m³', qty_mp: 'Ilość MP', qty_tonne: 'Masa (t)', energy_gj: 'Energia (GJ)',
  supplier_name: 'Dostawca / źródło', recipient_name: 'Odbiorca / cel',
  warehouse_from_id: 'Magazyn źródłowy', warehouse_to_id: 'Magazyn docelowy',
  loading_place: 'Miejsce załadunku', origin_place: 'Miejsce pochodzenia',
  forest_district: 'Nadleśnictwo', forest_range: 'Leśnictwo', haulage_note_no: 'Nr kwitu wywozowego',
  price_purchase: 'Cena zakupu / produkcji', price_sale: 'Cena sprzedaży',
  value_purchase: 'Wartość zakupu', value_sale: 'Wartość sprzedaży',
  chipping_mode: 'Rąbanie', chipping_price: 'Stawka rąbania', chipping_cost: 'Koszt rąbania',
  carrier_name: 'Firma transportowa', vehicle_plate: 'Nr rejestracyjny',
  distance_km: 'Odległość (km)', transport_cost: 'Koszt transportu',
  certificate: 'Certyfikat', is_stored: 'Magazynowane', notes: 'Uwagi', signature: 'Podpis',
});

/* --------------------------- Przygotowanie ---------------------------- */

/**
 * Zamienia dane z formularza na wiersz tabeli `operations` (bez numeru i metryki).
 * Rozwiązuje nazwy na identyfikatory kartotek, zakładając brakujące pozycje.
 */
function prepareRow(input, { existing = null } = {}) {
  const d = validate(input, OPERATION_SCHEMA, existing ? { partial: true } : {});
  const type = d.type ?? existing?.type;
  const errors = [];

  /* --- Produkt --- */
  let productRow;
  if (d.productId) {
    productRow = products.getRaw(d.productId);
  } else if (d.productName) {
    const found = products.findByName(d.productName)
      || products.create({ name: d.productName, category: guessCategory(d.productName) });
    productRow = products.getRaw(found.id);
  } else if (existing) {
    productRow = products.getRaw(existing.product_id);
  } else {
    errors.push({ field: 'productName', message: 'Wskaż produkt z kartoteki lub podaj jego nazwę.' });
  }

  /* --- Ilości --- */
  const quantity = d.quantity ?? existing?.quantity;
  const unit = d.unit ?? existing?.unit;
  const factors = resolveFactors(productRow, getUnitFactors());
  const qty = computeQuantities({
    quantity,
    unit,
    factors,
    m3Mode: d.m3Mode ?? existing?.m3_mode ?? 'AUTO',
    m3Manual: d.m3Manual ?? existing?.m3_manual,
    mpMode: d.mpMode ?? existing?.mp_mode ?? 'AUTO',
    mpManual: d.mpManual ?? existing?.mp_manual,
    tonneMode: d.tonneMode ?? existing?.tonne_mode ?? 'AUTO',
    tonneManual: d.tonneManual ?? existing?.tonne_manual,
  });

  /* --- Wartości --- */
  const pricePurchase = d.pricePurchase ?? existing?.price_purchase ?? 0;
  const priceSale = d.priceSale ?? existing?.price_sale ?? 0;
  const chippingPrice = d.chippingPrice ?? existing?.chipping_price ?? 0;
  const values = computeValues({ quantity, pricePurchase, priceSale, chippingPrice });

  /* --- Magazyny i kontrahenci --- */
  const direction = TYPE_DIRECTION[type];
  const defaultWarehouse = warehouses.getDefault();

  const resolveWarehouse = (name, fallbackId) => {
    if (name === undefined) return fallbackId ?? null;
    if (!name) return null;
    return warehouses.ensure(name).id;
  };

  let warehouseFromId = resolveWarehouse(d.warehouseFrom, existing?.warehouse_from_id);
  let warehouseToId = resolveWarehouse(d.warehouseTo, existing?.warehouse_to_id);

  // Domyślny magazyn podstawia się tam, gdzie typ dokumentu go wymaga.
  if ((direction === 'IN' || direction === 'TRANSFER') && !warehouseToId) warehouseToId = defaultWarehouse.id;
  if ((direction === 'OUT' || direction === 'TRANSFER') && !warehouseFromId) warehouseFromId = defaultWarehouse.id;
  if (direction === 'IN') warehouseFromId = null;
  if (direction === 'OUT') warehouseToId = null;

  const supplierName = d.supplierName ?? existing?.supplier_name ?? null;
  const recipientName = d.recipientName ?? existing?.recipient_name ?? null;
  const partnerFrom = supplierName ? partners.ensure(supplierName, 'DOSTAWCA') : null;
  const partnerTo = recipientName ? partners.ensure(recipientName, 'ODBIORCA') : null;

  /* --- Słowniki pomocnicze --- */
  const carrierName = d.carrierName ?? existing?.carrier_name ?? null;
  const vehiclePlate = d.vehiclePlate ?? existing?.vehicle_plate ?? null;
  if (carrierName) partners.ensure(carrierName, 'PRZEWOZNIK');
  if (vehiclePlate) vehicles.ensure(vehiclePlate, carrierName);
  const forestDistrict = d.forestDistrict ?? existing?.forest_district ?? null;
  const forestRange = d.forestRange ?? existing?.forest_range ?? null;
  if (forestDistrict) forest.ensure(forestDistrict, forestRange);
  const loadingPlace = d.loadingPlace ?? existing?.loading_place ?? null;
  if (loadingPlace) loadingPlaces.ensure(loadingPlace);

  /* --- Podpis --- */
  const signature = (d.signature ?? existing?.signature ?? '').trim();
  if (getSetting('rules.require_signature') && signature.split(/\s+/).filter(Boolean).length < 2) {
    errors.push({
      field: 'signature',
      message: 'Podpisz dokument pełnym imieniem i nazwiskiem — wymóg kontroli KZR/SURE.',
    });
  }

  if (errors.length) throw new ValidationError('Dokument zawiera błędy — popraw zaznaczone pola.', errors);

  const row = {
    type,
    operation_date: d.operationDate ?? existing?.operation_date,
    loading_date: d.loadingDate ?? existing?.loading_date ?? null,

    product_id: productRow.id,
    product_name: productRow.name,
    grade: d.grade ?? existing?.grade ?? null,

    quantity: roundQty(quantity),
    unit,
    qty_m3: qty.qtyM3,
    qty_mp: qty.qtyMp,
    qty_tonne: qty.qtyTonne,
    energy_gj: qty.energyGj,
    m3_mode: d.m3Mode ?? existing?.m3_mode ?? 'AUTO',
    m3_manual: d.m3Manual ?? existing?.m3_manual ?? null,
    mp_mode: d.mpMode ?? existing?.mp_mode ?? 'AUTO',
    mp_manual: d.mpManual ?? existing?.mp_manual ?? null,
    tonne_mode: d.tonneMode ?? existing?.tonne_mode ?? 'AUTO',
    tonne_manual: d.tonneManual ?? existing?.tonne_manual ?? null,
    factor_m3_mp: factors.m3ToMp,
    factor_mp_tonne: factors.mpToTonne,
    factor_tonne_gj: factors.tonneToGj,

    warehouse_from_id: warehouseFromId,
    warehouse_to_id: warehouseToId,
    partner_from_id: partnerFrom?.id ?? null,
    partner_to_id: partnerTo?.id ?? null,
    supplier_name: supplierName,
    recipient_name: recipientName,

    loading_place: loadingPlace,
    origin_place: d.originPlace ?? existing?.origin_place ?? null,
    forest_district: forestDistrict,
    forest_range: forestRange,
    haulage_note_no: d.haulageNoteNo ?? existing?.haulage_note_no ?? null,

    price_purchase: roundMoney(pricePurchase),
    price_sale: roundMoney(priceSale),
    value_purchase: values.valuePurchase,
    value_sale: values.valueSale,
    chipping_mode: d.chippingMode ?? existing?.chipping_mode ?? null,
    chipping_price: roundMoney(chippingPrice),
    chipping_cost: values.chippingCost,

    carrier_name: carrierName,
    vehicle_plate: vehiclePlate,
    distance_km: d.distanceKm ?? existing?.distance_km ?? 0,
    transport_cost: roundMoney(d.transportCost ?? existing?.transport_cost ?? 0),

    certificate: d.certificate ?? existing?.certificate ?? 'BRAK',
    is_stored: d.isStored ?? (existing ? !!existing.is_stored : true),

    chain_ref: d.chainRef ?? existing?.chain_ref ?? null,
    parent_id: d.parentId ?? existing?.parent_id ?? null,
    notes: d.notes ?? existing?.notes ?? null,
    signature,
  };

  const warehouseProblems = validateWarehouses(row);
  if (warehouseProblems.length) {
    throw new ValidationError(warehouseProblems[0], warehouseProblems.map((m) => ({ field: 'warehouse', message: m })));
  }
  return row;
}

/** Heurystyka kategorii dla produktu zakładanego „w locie”. */
function guessCategory(name) {
  const n = String(name).toLowerCase();
  if (/zrębk|zrebk|pellet|pks/.test(n)) return 'ZREBKA';
  if (/drewno|kłod|klod|surowiec|papierów/.test(n)) return 'SUROWIEC';
  if (/trocin|zrzyn|pozostałoś|pozostalos|kor[ay]|łupin|lupin/.test(n)) return 'PRODUKT_UBOCZNY';
  return 'INNE';
}

/* ------------------------ Kontrole biznesowe -------------------------- */

/** Blokuje księgowanie zbyt daleko wstecz (poza korektą przez kierownika). */
function assertDateAllowed(date, user) {
  const limitDays = Number(getSetting('rules.backdate_days')) || 0;
  if (!limitDays) return;
  if (user.role === 'ADMIN' || user.role === 'KIEROWNIK') return;
  const diffDays = Math.floor((Date.now() - new Date(`${date}T12:00:00Z`).getTime()) / 86_400_000);
  if (diffDays > limitDays) {
    throw new ForbiddenError(
      `Data ${date} wykracza poza dozwolone ${limitDays} dni wstecz. Poproś kierownika o zaksięgowanie dokumentu.`,
    );
  }
  if (diffDays < -1) {
    throw new ValidationError('Data operacji nie może być z przyszłości.');
  }
}

/** Kontrola stanów ujemnych — ostrzeżenie lub twarda blokada zależnie od ustawień. */
function checkStock(row, { excludeOperationId = null } = {}) {
  const direction = TYPE_DIRECTION[row.type];
  if (direction !== 'OUT' && direction !== 'TRANSFER') return [];

  const before = db.get(
    `SELECT COALESCE(SUM(qty_mp), 0) AS qty_mp
       FROM stock_moves
      WHERE warehouse_id = :warehouseId AND product_id = :productId
        AND (:exclude IS NULL OR operation_id <> :exclude)`,
    { warehouseId: row.warehouse_from_id, productId: row.product_id, exclude: excludeOperationId },
  );
  const after = roundQty(before.qty_mp - row.qty_mp);
  if (after >= -0.001) return [];

  const message =
    `Wydanie ${row.qty_mp.toFixed(3)} MP produktu „${row.product_name}” zejdzie poniżej zera `
    + `(stan po operacji: ${after.toFixed(3)} MP).`;

  if (!getSetting('rules.allow_negative_stock')) {
    throw new ConflictError(`${message} Zablokowane ustawieniem „stany ujemne”.`);
  }
  return [message];
}

/* ------------------------------ Zapis --------------------------------- */

/**
 * Księguje nowy dokument.
 * @param {object} input dane z formularza
 * @param {object} ctx kontekst żądania (użytkownik, IP)
 * @returns {{operation:object, warnings:string[]}}
 */
export function createOperation(input, ctx) {
  const user = ctx.user;
  return db.tx(() => {
    const row = prepareRow(input);
    assertDateAllowed(row.operation_date, user);
    assertPeriodOpen(row.operation_date.slice(0, 7), user);
    const warnings = checkStock(row);

    const series = seriesForType(row.type);
    const year = Number(row.operation_date.slice(0, 4));
    const doc = allocateDocNumber(db, series, year);
    const id = uuid();

    insertOperation({ ...row, id, doc_no: doc.docNo, doc_series: doc.series, doc_year: doc.year, doc_number: doc.number }, user.id);
    writeMoves(id, { ...row, id });

    audit(ctx, 'CREATE', 'operations', id, { docNo: doc.docNo, type: row.type, qtyMp: row.qty_mp });
    return { operation: getOperation(id), warnings };
  });
}

/**
 * Aktualizuje dokument. Poprzedni stan trafia do rejestru korekt,
 * a ruchy magazynowe są przeliczane od nowa.
 */
export function updateOperation(id, input, ctx) {
  const user = ctx.user;
  return db.tx(() => {
    const existing = db.get('SELECT * FROM operations WHERE id = :id', { id });
    if (!existing) throw new NotFoundError('Nie znaleziono dokumentu.');
    if (existing.status === 'CANCELLED') {
      throw new ConflictError('Dokument jest anulowany — edycja nie jest możliwa. Wprowadź nowy dokument.');
    }
    if (user.role === 'MAGAZYNIER' && existing.created_by !== user.id) {
      throw new ForbiddenError('Magazynier może korygować wyłącznie własne dokumenty. Zgłoś zmianę kierownikowi.');
    }

    const row = prepareRow(input, { existing });
    assertDateAllowed(row.operation_date, user);
    assertPeriodOpen(existing.operation_date.slice(0, 7), user);
    assertPeriodOpen(row.operation_date.slice(0, 7), user);
    const warnings = checkStock(row, { excludeOperationId: id });

    const changes = diffRows(existing, row);
    if (!changes.length) return { operation: mapOperation(existing), warnings, changes: [] };

    const reason = String(input.correctionReason || '').trim().slice(0, 500);
    db.run(
      `INSERT INTO corrections(id, operation_id, doc_no, operation_type, product_name,
                               changed_by, changed_by_name, reason, changes_json, snapshot_before)
            VALUES (:id, :operationId, :docNo, :type, :productName,
                    :changedBy, :changedByName, :reason, :changes, :snapshot)`,
      {
        id: uuid(),
        operationId: id,
        docNo: existing.doc_no,
        type: existing.type,
        productName: existing.product_name,
        changedBy: user.id,
        changedByName: user.fullName,
        reason: reason || null,
        changes: JSON.stringify(changes),
        snapshot: JSON.stringify(existing),
      },
    );

    const sets = Object.keys(row).map((col) => `${col} = :${col}`).join(', ');
    db.run(
      `UPDATE operations SET ${sets}, revision = revision + 1,
              updated_at = datetime('now'), updated_by = :updatedBy
        WHERE id = :id`,
      { ...row, id, updatedBy: user.id },
    );

    writeMoves(id, { ...row, id });
    audit(ctx, 'UPDATE', 'operations', id, { docNo: existing.doc_no, fields: changes.map((c) => c.field) });
    return { operation: getOperation(id), warnings, changes };
  });
}

/**
 * Storno dokumentu. Dokument pozostaje w rejestrze ze statusem `CANCELLED`,
 * a jego ruchy magazynowe są usuwane — stan wraca do wartości sprzed księgowania.
 */
export function cancelOperation(id, { reason }, ctx) {
  const user = ctx.user;
  return db.tx(() => {
    const existing = db.get('SELECT * FROM operations WHERE id = :id', { id });
    if (!existing) throw new NotFoundError('Nie znaleziono dokumentu.');
    if (existing.status === 'CANCELLED') throw new ConflictError('Dokument został już anulowany.');

    const clean = validate({ reason }, {
      reason: { type: 'string', required: true, min: 5, max: 500, label: 'Przyczyna storna' },
    });
    assertPeriodOpen(existing.operation_date.slice(0, 7), user);

    // Dokument będący ogniwem łańcucha nie może zniknąć bez pozostałych ogniw.
    if (existing.chain_ref) {
      const siblings = db.all(
        "SELECT id, doc_no FROM operations WHERE chain_ref = :ref AND id <> :id AND status = 'POSTED'",
        { ref: existing.chain_ref, id },
      );
      if (siblings.length) {
        throw new ConflictError(
          `Dokument należy do łańcucha ${existing.chain_ref}. Anuluj najpierw powiązane dokumenty: `
          + siblings.map((s) => s.doc_no).join(', '),
        );
      }
    }

    db.run('DELETE FROM stock_moves WHERE operation_id = :id', { id });
    db.run(
      `UPDATE operations
          SET status = 'CANCELLED', cancelled_at = datetime('now'),
              cancelled_by = :userId, cancel_reason = :reason
        WHERE id = :id`,
      { id, userId: user.id, reason: clean.reason },
    );
    audit(ctx, 'CANCEL', 'operations', id, { docNo: existing.doc_no, reason: clean.reason });
    return getOperation(id);
  });
}

/** Przywraca dokument do stanu sprzed wskazanej korekty. */
export function restoreCorrection(correctionId, ctx) {
  return db.tx(() => {
    const corr = db.get('SELECT * FROM corrections WHERE id = :id', { id: correctionId });
    if (!corr) throw new NotFoundError('Nie znaleziono wpisu korekty.');
    const snapshot = JSON.parse(corr.snapshot_before);
    const input = toInput(snapshot);
    input.correctionReason = `Przywrócenie stanu sprzed korekty z ${corr.changed_at}`;
    return updateOperation(corr.operation_id, input, ctx);
  });
}

/* ---------------------------- Odczyt ---------------------------------- */

const LIST_SCHEMA = {
  q: { type: 'string', max: 120 },
  type: { type: 'string', max: 20 },
  productId: { type: 'string', max: 40 },
  warehouseId: { type: 'string', max: 40 },
  partnerId: { type: 'string', max: 40 },
  month: { type: 'month' },
  dateFrom: { type: 'date' },
  dateTo: { type: 'date' },
  status: { type: 'enum', values: ['POSTED', 'CANCELLED', 'ALL'], default: 'POSTED' },
  chainRef: { type: 'string', max: 40 },
  sort: { type: 'enum', values: ['date', 'doc', 'value'], default: 'date' },
  order: { type: 'enum', values: ['asc', 'desc'], default: 'desc' },
  limit: { type: 'int', min: 1, max: 500, default: 50 },
  offset: { type: 'int', min: 0, default: 0 },
};

/** Lista dokumentów z filtrowaniem, sortowaniem i stronicowaniem. */
export function listOperations(query) {
  const f = validate(query, LIST_SCHEMA, { partial: false });
  const where = [];
  const params = { limit: f.limit, offset: f.offset };

  if (f.status !== 'ALL') { where.push('o.status = :status'); params.status = f.status; }
  if (f.type) { where.push('o.type = :type'); params.type = f.type; }
  if (f.productId) { where.push('o.product_id = :productId'); params.productId = f.productId; }
  if (f.chainRef) { where.push('o.chain_ref = :chainRef'); params.chainRef = f.chainRef; }
  if (f.warehouseId) {
    where.push('(o.warehouse_from_id = :warehouseId OR o.warehouse_to_id = :warehouseId)');
    params.warehouseId = f.warehouseId;
  }
  if (f.partnerId) {
    where.push('(o.partner_from_id = :partnerId OR o.partner_to_id = :partnerId)');
    params.partnerId = f.partnerId;
  }
  if (f.month) { where.push('o.operation_month = :month'); params.month = f.month; }
  if (f.dateFrom) { where.push('o.operation_date >= :dateFrom'); params.dateFrom = f.dateFrom; }
  if (f.dateTo) { where.push('o.operation_date <= :dateTo'); params.dateTo = f.dateTo; }
  if (f.q) {
    where.push(`(o.doc_no LIKE :q OR o.product_name LIKE :q OR COALESCE(o.supplier_name,'') LIKE :q
                 OR COALESCE(o.recipient_name,'') LIKE :q OR COALESCE(o.vehicle_plate,'') LIKE :q
                 OR COALESCE(o.carrier_name,'') LIKE :q OR COALESCE(o.haulage_note_no,'') LIKE :q
                 OR COALESCE(o.forest_district,'') LIKE :q OR COALESCE(o.notes,'') LIKE :q)`);
    params.q = `%${f.q}%`;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderCol = { date: 'o.operation_date', doc: 'o.doc_no', value: '(o.value_sale + o.value_purchase)' }[f.sort];
  const orderSql = `ORDER BY ${orderCol} ${f.order === 'asc' ? 'ASC' : 'DESC'}, o.created_at DESC`;

  const rows = db.all(
    `${SELECT_OPERATION} ${whereSql} ${orderSql} LIMIT :limit OFFSET :offset`, params,
  );
  const total = db.value(`SELECT COUNT(*) FROM operations o ${whereSql}`, params);
  const totals = db.get(
    `SELECT COALESCE(SUM(o.qty_mp),0)         AS qty_mp,
            COALESCE(SUM(o.qty_tonne),0)      AS qty_tonne,
            COALESCE(SUM(o.value_purchase),0) AS value_purchase,
            COALESCE(SUM(o.value_sale),0)     AS value_sale,
            COALESCE(SUM(o.transport_cost),0) AS transport_cost
       FROM operations o ${whereSql}`,
    params,
  );

  return {
    items: rows.map(mapOperation),
    page: { total, limit: f.limit, offset: f.offset },
    totals: {
      qtyMp: roundQty(totals.qty_mp),
      qtyTonne: roundQty(totals.qty_tonne),
      valuePurchase: roundMoney(totals.value_purchase),
      valueSale: roundMoney(totals.value_sale),
      transportCost: roundMoney(totals.transport_cost),
    },
  };
}

export function getOperation(id) {
  const row = db.get(`${SELECT_OPERATION} WHERE o.id = :id`, { id });
  if (!row) throw new NotFoundError('Nie znaleziono dokumentu.');
  const op = mapOperation(row);
  op.attachments = db.all(
    `SELECT id, filename, mime_type, size_bytes, kind, created_at
       FROM attachments WHERE operation_id = :id ORDER BY created_at`,
    { id },
  ).map((a) => ({
    id: a.id, filename: a.filename, mimeType: a.mime_type,
    sizeBytes: a.size_bytes, kind: a.kind, createdAt: a.created_at,
  }));
  op.corrections = db.value('SELECT COUNT(*) FROM corrections WHERE operation_id = :id', { id });
  if (op.chainRef) {
    op.chain = db.all(
      `SELECT id, doc_no, type, product_name, qty_mp, status
         FROM operations WHERE chain_ref = :ref ORDER BY created_at`,
      { ref: op.chainRef },
    ).map((r) => ({ id: r.id, docNo: r.doc_no, type: r.type, productName: r.product_name, qtyMp: r.qty_mp, status: r.status }));
  }
  return op;
}

const SELECT_OPERATION = `
  SELECT o.*,
         wf.name AS warehouse_from_name,
         wt.name AS warehouse_to_name,
         u.full_name AS created_by_name
    FROM operations o
    LEFT JOIN warehouses wf ON wf.id = o.warehouse_from_id
    LEFT JOIN warehouses wt ON wt.id = o.warehouse_to_id
    LEFT JOIN users u       ON u.id  = o.created_by`;

/** Wiersz bazy → obiekt API (camelCase, bez pól technicznych). */
export function mapOperation(r) {
  return {
    id: r.id,
    docNo: r.doc_no,
    docSeries: r.doc_series,
    type: r.type,
    status: r.status,
    operationDate: r.operation_date,
    operationMonth: r.operation_month,
    loadingDate: r.loading_date,
    productId: r.product_id,
    productName: r.product_name,
    grade: r.grade,
    quantity: r.quantity,
    unit: r.unit,
    qtyM3: r.qty_m3,
    qtyMp: r.qty_mp,
    qtyTonne: r.qty_tonne,
    energyGj: r.energy_gj,
    m3Mode: r.m3_mode,
    m3Manual: r.m3_manual,
    mpMode: r.mp_mode,
    mpManual: r.mp_manual,
    tonneMode: r.tonne_mode,
    tonneManual: r.tonne_manual,
    factors: { m3ToMp: r.factor_m3_mp, mpToTonne: r.factor_mp_tonne, tonneToGj: r.factor_tonne_gj },
    warehouseFromId: r.warehouse_from_id,
    warehouseFrom: r.warehouse_from_name ?? null,
    warehouseToId: r.warehouse_to_id,
    warehouseTo: r.warehouse_to_name ?? null,
    supplierName: r.supplier_name,
    recipientName: r.recipient_name,
    loadingPlace: r.loading_place,
    originPlace: r.origin_place,
    forestDistrict: r.forest_district,
    forestRange: r.forest_range,
    haulageNoteNo: r.haulage_note_no,
    pricePurchase: r.price_purchase,
    priceSale: r.price_sale,
    valuePurchase: r.value_purchase,
    valueSale: r.value_sale,
    chippingMode: r.chipping_mode,
    chippingPrice: r.chipping_price,
    chippingCost: r.chipping_cost,
    carrierName: r.carrier_name,
    vehiclePlate: r.vehicle_plate,
    distanceKm: r.distance_km,
    transportCost: r.transport_cost,
    certificate: r.certificate,
    isStored: !!r.is_stored,
    chainRef: r.chain_ref,
    parentId: r.parent_id,
    notes: r.notes,
    signature: r.signature,
    revision: r.revision,
    createdAt: r.created_at,
    createdBy: r.created_by_name ?? r.created_by,
    updatedAt: r.updated_at,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
  };
}

/** Odwrotność `mapOperation` — pozwala odtworzyć dokument z migawki korekty. */
export function toInput(row) {
  return {
    type: row.type,
    operationDate: row.operation_date,
    loadingDate: row.loading_date,
    productId: row.product_id,
    grade: row.grade,
    quantity: row.quantity,
    unit: row.unit,
    m3Mode: row.m3_mode,
    m3Manual: row.m3_manual,
    mpMode: row.mp_mode,
    mpManual: row.mp_manual,
    tonneMode: row.tonne_mode,
    tonneManual: row.tonne_manual,
    supplierName: row.supplier_name,
    recipientName: row.recipient_name,
    loadingPlace: row.loading_place,
    originPlace: row.origin_place,
    forestDistrict: row.forest_district,
    forestRange: row.forest_range,
    haulageNoteNo: row.haulage_note_no,
    pricePurchase: row.price_purchase,
    priceSale: row.price_sale,
    chippingMode: row.chipping_mode,
    chippingPrice: row.chipping_price,
    carrierName: row.carrier_name,
    vehiclePlate: row.vehicle_plate,
    distanceKm: row.distance_km,
    transportCost: row.transport_cost,
    certificate: row.certificate,
    isStored: !!row.is_stored,
    notes: row.notes,
    signature: row.signature,
  };
}

/* ------------------------ Operacje pomocnicze ------------------------- */

const INSERT_COLUMNS = [
  'id', 'doc_no', 'doc_series', 'doc_year', 'doc_number', 'type', 'operation_date', 'loading_date',
  'product_id', 'product_name', 'grade', 'quantity', 'unit', 'qty_m3', 'qty_mp', 'qty_tonne', 'energy_gj',
  'm3_mode', 'm3_manual', 'mp_mode', 'mp_manual', 'tonne_mode', 'tonne_manual',
  'factor_m3_mp', 'factor_mp_tonne', 'factor_tonne_gj',
  'warehouse_from_id', 'warehouse_to_id', 'partner_from_id', 'partner_to_id', 'supplier_name', 'recipient_name',
  'loading_place', 'origin_place', 'forest_district', 'forest_range', 'haulage_note_no',
  'price_purchase', 'price_sale', 'value_purchase', 'value_sale',
  'chipping_mode', 'chipping_price', 'chipping_cost',
  'carrier_name', 'vehicle_plate', 'distance_km', 'transport_cost',
  'certificate', 'is_stored', 'chain_ref', 'parent_id', 'notes', 'signature',
];

function insertOperation(row, userId) {
  const cols = [...INSERT_COLUMNS, 'created_by'];
  db.run(
    `INSERT INTO operations(${cols.join(', ')}) VALUES (${cols.map((c) => `:${c}`).join(', ')})`,
    { ...pick(row, INSERT_COLUMNS), created_by: userId },
  );
}

/** Usuwa i tworzy od nowa ruchy magazynowe dokumentu (idempotentne). */
function writeMoves(operationId, row) {
  db.run('DELETE FROM stock_moves WHERE operation_id = :id', { id: operationId });
  for (const move of deriveMoves(row)) {
    db.run(
      `INSERT INTO stock_moves(id, operation_id, move_date, warehouse_id, product_id,
                               direction, qty_mp, qty_m3, qty_tonne, energy_gj, value)
            VALUES (:id, :operationId, :moveDate, :warehouseId, :productId,
                    :direction, :qtyMp, :qtyM3, :qtyTonne, :energyGj, :value)`,
      {
        id: uuid(),
        operationId,
        moveDate: row.operation_date,
        warehouseId: move.warehouseId,
        productId: move.productId,
        direction: move.direction,
        qtyMp: move.qtyMp,
        qtyM3: move.qtyM3,
        qtyTonne: move.qtyTonne,
        energyGj: move.energyGj,
        value: roundMoney(move.value),
      },
    );
  }
}

/**
 * Porównuje stan przed i po edycji; zwraca listę zmian do rejestru korekt.
 * Wartości logiczne sprowadzamy do 0/1, bo baza przechowuje je jako liczby —
 * bez tego każda edycja zgłaszałaby pozorną zmianę pola `is_stored`.
 */
function diffRows(before, after) {
  const norm = (v) => {
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  };
  const changes = [];
  for (const [field, raw] of Object.entries(after)) {
    const value = norm(raw);
    const prev = norm(before[field]);
    const same = typeof value === 'number' && typeof prev === 'number'
      ? Math.abs(value - prev) < 1e-9
      : String(prev ?? '') === String(value ?? '');
    if (same) continue;
    changes.push({
      field,
      label: FIELD_LABELS[field] || field,
      from: prev ?? null,
      to: value ?? null,
    });
  }
  return changes;
}

const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k] ?? null]));

export { prepareRow, checkStock, OPERATION_SCHEMA };

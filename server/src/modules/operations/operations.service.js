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
 *
 * Opis pól dokumentu (nazwy, kolumny, walidacja, etykiety) mieszka w jednym
 * miejscu — `domain/operation-fields.js`. Ten moduł zajmuje się wyłącznie
 * regułami biznesowymi.
 */
import db from '../../db/index.js';
import { uuid } from '../../lib/crypto.js';
import { validate } from '../../lib/validate.js';
import { NotFoundError, ConflictError, ValidationError, ForbiddenError } from '../../lib/errors.js';
import { computeQuantities, computeValues, resolveFactors, roundMoney, roundQty } from '../../domain/units.js';
import { allocateDocNumber, seriesForType, TYPE_DIRECTION } from '../../domain/documents.js';
import { deriveMoves, validateWarehouses } from '../../domain/stock.js';
import {
  OPERATION_SCHEMA, FIELD_LABELS, CONTENT_COLUMNS, DOCUMENT_COLUMNS, MONEY_FIELDS, FIELD_BY_API,
  rowToApi, rowToInput, carry,
} from '../../domain/operation-fields.js';
import { getUnitFactors, getSetting } from '../settings/settings.service.js';
import { products, warehouses, resolvePartners, ensureDictionaries } from '../catalog/catalog.service.js';
import { assertPeriodOpen } from '../periods/periods.service.js';
import { audit } from '../../middleware/audit.js';

export { OPERATION_SCHEMA, FIELD_LABELS };

/* ======================================================================
   Przygotowanie dokumentu
   ====================================================================== */

/**
 * Zamienia dane z formularza na wiersz tabeli `operations`.
 *
 * Podzielone na nazwane kroki, żeby każdy dało się czytać i zmieniać osobno:
 * produkt → ilości → magazyny → słowniki → złożenie wiersza → kontrola.
 *
 * @param {object} input dane żądania
 * @param {{existing?:object}} [options] edytowany dokument (wiersz bazy)
 * @returns {object} wiersz gotowy do zapisu (klucze = kolumny bazy)
 */
function prepareRow(input, { existing = null } = {}) {
  const d = validate(input, OPERATION_SCHEMA, existing ? { partial: true } : {});
  const errors = [];

  const type = carry(d, existing, 'type');
  const product = resolveProduct(d, existing, errors);
  const quantities = computeAmounts(d, existing, product);
  const places = resolveWarehouses(d, existing, type);
  const signature = String(carry(d, existing, 'signature') ?? '').trim();

  if (getSetting('rules.require_signature') && signature.split(/\s+/).filter(Boolean).length < 2) {
    errors.push({
      field: 'signature',
      message: 'Podpisz dokument pełnym imieniem i nazwiskiem — wymóg kontroli KZR/SURE.',
    });
  }
  if (errors.length) throw new ValidationError('Dokument zawiera błędy — popraw zaznaczone pola.', errors);

  const row = assembleRow({ d, existing, type, product, quantities, places, signature });

  // Uzupełnienie kartotek pomocniczych na podstawie gotowego wiersza —
  // wyłącznie dla wartości, które faktycznie się zmieniły.
  const partners = ensureDictionaries(row, existing);
  row.partner_from_id = partners.supplierId;
  row.partner_to_id = partners.recipientId;

  const problems = validateWarehouses(row);
  if (problems.length) {
    throw new ValidationError(problems[0], problems.map((m) => ({ field: 'warehouse', message: m })));
  }
  return row;
}

/** Krok 1 — produkt: z kartoteki po kluczu, po nazwie, albo zakładany w locie. */
function resolveProduct(d, existing, errors) {
  if (d.productId) return products.getRaw(d.productId);
  if (d.productName) {
    return products.findRowByName(d.productName)
      ?? products.getRaw(products.create({ name: d.productName, category: guessCategory(d.productName) }).id);
  }
  if (existing) return products.getRaw(existing.product_id);
  errors.push({ field: 'productName', message: 'Wskaż produkt z kartoteki lub podaj jego nazwę.' });
  return null;
}

/** Krok 2 — przeliczenie ilości i wartości przy użyciu przeliczników produktu. */
function computeAmounts(d, existing, product) {
  const quantity = carry(d, existing, 'quantity');
  const unit = carry(d, existing, 'unit');
  const factors = resolveFactors(product, getUnitFactors());

  const amounts = computeQuantities({
    quantity,
    unit,
    factors,
    m3Mode: carry(d, existing, 'm3Mode'),
    m3Manual: carry(d, existing, 'm3Manual'),
    mpMode: carry(d, existing, 'mpMode'),
    mpManual: carry(d, existing, 'mpManual'),
    tonneMode: carry(d, existing, 'tonneMode'),
    tonneManual: carry(d, existing, 'tonneManual'),
  });

  const values = computeValues({
    quantity,
    pricePurchase: carry(d, existing, 'pricePurchase'),
    priceSale: carry(d, existing, 'priceSale'),
    chippingPrice: carry(d, existing, 'chippingPrice'),
  });

  return { quantity, unit, factors, amounts, values };
}

/**
 * Krok 3 — magazyny. Klucz z żądania ma pierwszeństwo przed nazwą, nazwa przed
 * wartością z edytowanego dokumentu. Brakujący magazyn wymagany przez typ
 * dokumentu uzupełnia się magazynem domyślnym.
 */
function resolveWarehouses(d, existing, type) {
  const pick = (idKey, nameKey, existingCol) => {
    if (d[idKey]) return d[idKey];
    if (d[nameKey] !== undefined) return d[nameKey] ? warehouses.ensure(d[nameKey]).id : null;
    return existing?.[existingCol] ?? null;
  };

  let from = pick('warehouseFromId', 'warehouseFrom', 'warehouse_from_id');
  let to = pick('warehouseToId', 'warehouseTo', 'warehouse_to_id');

  // Magazyn domyślny odczytujemy dopiero, gdy któraś strona dokumentu go potrzebuje.
  let fallbackId = null;
  const fallback = () => (fallbackId ??= warehouses.getDefault().id);

  const direction = TYPE_DIRECTION[type];
  if ((direction === 'IN' || direction === 'TRANSFER') && !to) to = fallback();
  if ((direction === 'OUT' || direction === 'TRANSFER') && !from) from = fallback();
  if (direction === 'IN') from = null;
  if (direction === 'OUT') to = null;

  return { from, to };
}

/** Krok 4 — złożenie wiersza: pola proste z rejestru, wyliczane wprost. */
function assembleRow({ d, existing, type, product, quantities, places, signature }) {
  const { amounts, values, factors } = quantities;
  const row = {};

  // Pola przenoszone z żądania lub z edytowanego dokumentu.
  for (const column of CONTENT_COLUMNS) row[column] = undefined;
  for (const api of Object.keys(OPERATION_SCHEMA)) {
    const field = FIELD_BY_API[api];
    if (!field || field.derived) continue;
    row[field.col] = carry(d, existing, api);
  }

  // Kwoty jednostkowe zaokrąglane do groszy.
  for (const api of MONEY_FIELDS) {
    const field = FIELD_BY_API[api];
    if (field && !field.derived) row[field.col] = roundMoney(row[field.col]);
  }

  // Pola wyliczane i rozstrzygnięte w krokach wcześniejszych.
  Object.assign(row, {
    type,
    product_id: product.id,
    product_name: product.name,
    quantity: roundQty(quantities.quantity),
    unit: quantities.unit,
    qty_m3: amounts.qtyM3,
    qty_mp: amounts.qtyMp,
    qty_tonne: amounts.qtyTonne,
    energy_gj: amounts.energyGj,
    factor_m3_mp: factors.m3ToMp,
    factor_mp_tonne: factors.mpToTonne,
    factor_tonne_gj: factors.tonneToGj,
    value_purchase: values.valuePurchase,
    value_sale: values.valueSale,
    chipping_cost: values.chippingCost,
    warehouse_from_id: places.from,
    warehouse_to_id: places.to,
    signature,
  });

  // Kolumny nieobjęte żadnym z powyższych kroków muszą mieć jawną wartość.
  for (const column of CONTENT_COLUMNS) row[column] ??= null;
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

/* ======================================================================
   Kontrole biznesowe
   ====================================================================== */

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
  if (diffDays < -1) throw new ValidationError('Data operacji nie może być z przyszłości.');
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

/* ======================================================================
   Zapis
   ====================================================================== */

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
    assertPeriodOpen(row.operation_date.slice(0, 7));
    const warnings = checkStock(row);

    const doc = allocateDocNumber(db, seriesForType(row.type), Number(row.operation_date.slice(0, 4)));
    const id = uuid();
    const stored = {
      ...row, id, doc_no: doc.docNo, doc_series: doc.series, doc_year: doc.year, doc_number: doc.number,
    };

    insertOperation(stored, user.id);
    writeMoves(id, stored);

    audit(ctx, 'CREATE', 'operations', id, { docNo: doc.docNo, type: row.type, qtyMp: row.qty_mp });
    return { operation: readOperation(id), warnings };
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
    assertPeriodOpen(existing.operation_date.slice(0, 7));
    assertPeriodOpen(row.operation_date.slice(0, 7));
    const warnings = checkStock(row, { excludeOperationId: id });

    const changes = diffRows(existing, row);
    if (!changes.length) return { operation: readOperation(id), warnings, changes: [] };

    recordCorrection(existing, changes, input.correctionReason, user);

    const sets = Object.keys(row).map((col) => `${col} = :${col}`).join(', ');
    db.run(
      `UPDATE operations SET ${sets}, revision = revision + 1,
              updated_at = datetime('now'), updated_by = :updatedBy
        WHERE id = :id`,
      { ...row, id, updatedBy: user.id },
    );

    writeMoves(id, { ...row, id });
    audit(ctx, 'UPDATE', 'operations', id, { docNo: existing.doc_no, fields: changes.map((c) => c.field) });
    return { operation: readOperation(id), warnings, changes };
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
    assertPeriodOpen(existing.operation_date.slice(0, 7));

    // Dokument będący ogniwem łańcucha nie może zniknąć bez pozostałych ogniw.
    if (existing.chain_ref) {
      const siblings = db.all(
        "SELECT doc_no FROM operations WHERE chain_ref = :ref AND id <> :id AND status = 'POSTED'",
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
    return readOperation(id);
  });
}

/** Przywraca dokument do stanu sprzed wskazanej korekty. */
export function restoreCorrection(correctionId, ctx) {
  return db.tx(() => {
    const corr = db.get('SELECT * FROM corrections WHERE id = :id', { id: correctionId });
    if (!corr) throw new NotFoundError('Nie znaleziono wpisu korekty.');

    const input = rowToInput(JSON.parse(corr.snapshot_before));
    input.correctionReason = `Przywrócenie stanu sprzed korekty z ${corr.changed_at}`;
    return updateOperation(corr.operation_id, input, ctx);
  });
}

/** Zapisuje wpis w rejestrze korekt wraz z pełną migawką stanu sprzed zmiany. */
function recordCorrection(existing, changes, reason, user) {
  db.run(
    `INSERT INTO corrections(id, operation_id, doc_no, operation_type, product_name,
                             changed_by, changed_by_name, reason, changes_json, snapshot_before)
          VALUES (:id, :operationId, :docNo, :type, :productName,
                  :changedBy, :changedByName, :reason, :changes, :snapshot)`,
    {
      id: uuid(),
      operationId: existing.id,
      docNo: existing.doc_no,
      type: existing.type,
      productName: existing.product_name,
      changedBy: user.id,
      changedByName: user.fullName,
      reason: String(reason || '').trim().slice(0, 500) || null,
      changes: JSON.stringify(changes),
      snapshot: JSON.stringify(existing),
    },
  );
}

/* ======================================================================
   Odczyt
   ====================================================================== */

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

/** Buduje warunek WHERE i parametry na podstawie filtrów listy. */
function buildListFilter(query) {
  const f = validate(query, LIST_SCHEMA);
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

  const orderColumn = { date: 'o.operation_date', doc: 'o.doc_no', value: '(o.value_sale + o.value_purchase)' }[f.sort];
  return {
    filters: f,
    params,
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    orderSql: `ORDER BY ${orderColumn} ${f.order === 'asc' ? 'ASC' : 'DESC'}, o.created_at DESC`,
  };
}

/**
 * Lista dokumentów z filtrowaniem, sortowaniem i stronicowaniem.
 *
 * @param {object} query filtry
 * @param {{withTotals?:boolean}} [options] `withTotals:false` pomija liczenie
 *   sumy i podsumowań — używane przy stronicowanym eksporcie, gdzie te same
 *   agregaty liczyłyby się od nowa dla każdej strony.
 */
export function listOperations(query, { withTotals = true } = {}) {
  const { filters, params, whereSql, orderSql } = buildListFilter(query);
  const rows = db.all(`${SELECT_OPERATION} ${whereSql} ${orderSql} LIMIT :limit OFFSET :offset`, params);
  const items = rows.map(rowToApi);

  if (!withTotals) {
    return { items, page: { total: null, limit: filters.limit, offset: filters.offset }, totals: null };
  }

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
    items,
    page: { total, limit: filters.limit, offset: filters.offset },
    totals: {
      qtyMp: roundQty(totals.qty_mp),
      qtyTonne: roundQty(totals.qty_tonne),
      valuePurchase: roundMoney(totals.value_purchase),
      valueSale: roundMoney(totals.value_sale),
      transportCost: roundMoney(totals.transport_cost),
    },
  };
}

/**
 * Dokument wraz z załącznikami, liczbą korekt i pozostałymi ogniwami łańcucha.
 * Używane przez `GET /operations/:id`.
 */
export function getOperation(id) {
  const operation = readOperation(id);

  operation.attachments = db.all(
    `SELECT id, filename, mime_type, size_bytes, kind, created_at
       FROM attachments WHERE operation_id = :id ORDER BY created_at`,
    { id },
  ).map((a) => ({
    id: a.id, filename: a.filename, mimeType: a.mime_type,
    sizeBytes: a.size_bytes, kind: a.kind, createdAt: a.created_at,
  }));

  operation.corrections = db.value('SELECT COUNT(*) FROM corrections WHERE operation_id = :id', { id });

  if (operation.chainRef) {
    operation.chain = db.all(
      `SELECT id, doc_no, type, product_name, qty_mp, status
         FROM operations WHERE chain_ref = :ref ORDER BY created_at`,
      { ref: operation.chainRef },
    ).map((r) => ({
      id: r.id, docNo: r.doc_no, type: r.type,
      productName: r.product_name, qtyMp: r.qty_mp, status: r.status,
    }));
  }
  return operation;
}

/**
 * Sam dokument, bez zestawu powiązań — jedno zapytanie.
 * Zwracany po zapisie: ścieżka zapisu nie potrzebuje załączników ani historii
 * korekt, a ich doczytywanie kosztowało trzy dodatkowe zapytania na dokument.
 */
function readOperation(id) {
  const row = db.get(`${SELECT_OPERATION} WHERE o.id = :id`, { id });
  if (!row) throw new NotFoundError('Nie znaleziono dokumentu.');
  return rowToApi(row);
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

/* ======================================================================
   Operacje pomocnicze
   ====================================================================== */

const INSERT_COLUMNS = [...DOCUMENT_COLUMNS, ...CONTENT_COLUMNS, 'created_by'];

function insertOperation(row, userId) {
  db.run(
    `INSERT INTO operations(${INSERT_COLUMNS.join(', ')})
          VALUES (${INSERT_COLUMNS.map((c) => `:${c}`).join(', ')})`,
    { ...Object.fromEntries(INSERT_COLUMNS.map((c) => [c, row[c] ?? null])), created_by: userId },
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
  const norm = (v) => (typeof v === 'boolean' ? Number(v) : v);
  const changes = [];

  for (const [field, raw] of Object.entries(after)) {
    const value = norm(raw);
    const previous = norm(before[field]);
    const same = typeof value === 'number' && typeof previous === 'number'
      ? Math.abs(value - previous) < 1e-9
      : String(previous ?? '') === String(value ?? '');
    if (same) continue;

    changes.push({
      field,
      label: FIELD_LABELS[field] ?? field,
      from: previous ?? null,
      to: value ?? null,
    });
  }
  return changes;
}

export { prepareRow, checkStock };

import type { Db } from '../../db/index.js';
import { badRequest, conflict, forbidden, invalidState, notFound } from '../../core/errors.js';
import { nowIso, yearOf } from '../../core/time.js';
import { nextDocumentNumber } from '../../core/numbering.js';
import { docPermission, type DocType } from '../../core/permissions.js';
import { writeAudit, type AuditActor, type FieldChange } from '../../core/audit.js';
import { deriveQuantities, roundQty, type BaseUnit } from '../../core/units.js';
import { lineValueGr, toGrosze, toPln } from '../../core/money.js';
import type { AuthUser } from '../../core/context.js';
import { assertWarehouseAccess } from '../../middleware/auth.js';
import { getConversionRates, getSetting } from '../settings/settings.service.js';
import {
  applyMovements,
  planMovements,
  planReversal,
} from './stock.engine.js';
import {
  STOCK_AFFECTING,
  type DocumentInput,
  type DocumentLineRow,
  type DocumentListQuery,
  type DocumentRow,
  type DocumentUpdate,
  type LineInput,
} from './documents.types.js';

// --------------------------------------------------------------------------
// Pomocnicze
// --------------------------------------------------------------------------

interface ProductRow {
  id: number;
  code: string;
  name: string;
  base_unit: BaseUnit;
  kind: string;
  is_active: number;
  m3_per_mp: number | null;
  t_per_mp: number | null;
}

function assertDocPermission(user: AuthUser, docType: DocType, action: 'view' | 'manage' | 'post' | 'cancel'): void {
  const permission = docPermission(docType, action);
  if (!user.permissions.has(permission)) {
    throw forbidden(`Brak uprawnienia ${permission}.`);
  }
}

function loadProducts(db: Db, ids: number[]): Map<number, ProductRow> {
  if (ids.length === 0) return new Map();
  const unique = [...new Set(ids)];
  const placeholders = unique.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT id, code, name, base_unit, kind, is_active, m3_per_mp, t_per_mp
         FROM products WHERE id IN (${placeholders})`,
    )
    .all(...unique) as ProductRow[];
  return new Map(rows.map((r) => [r.id, r]));
}

function assertPartner(db: Db, id: number | null | undefined, role: 'supplier' | 'customer' | 'carrier'): void {
  if (id === null || id === undefined) return;
  const row = db.prepare('SELECT id, is_active, is_supplier, is_customer, is_carrier, name FROM partners WHERE id = ?').get(id) as
    | { id: number; is_active: number; is_supplier: number; is_customer: number; is_carrier: number; name: string }
    | undefined;
  if (!row) throw badRequest(`Kontrahent o identyfikatorze ${id} nie istnieje.`);
  if (!row.is_active) throw badRequest(`Kontrahent "${row.name}" jest nieaktywny.`);
  const flag = role === 'supplier' ? row.is_supplier : role === 'customer' ? row.is_customer : row.is_carrier;
  if (!flag) {
    const label = role === 'supplier' ? 'dostawcy' : role === 'customer' ? 'odbiorcy' : 'przewoźnika';
    throw badRequest(`Kontrahent "${row.name}" nie jest oznaczony jako ${label}.`);
  }
}

function assertWarehouseExists(db: Db, id: number, label: string): void {
  const row = db.prepare('SELECT id, is_active, name FROM warehouses WHERE id = ?').get(id) as
    | { id: number; is_active: number; name: string }
    | undefined;
  if (!row) throw badRequest(`${label} o identyfikatorze ${id} nie istnieje.`);
  if (!row.is_active) throw badRequest(`${label} "${row.name}" jest nieaktywny.`);
}

/**
 * Walidacja zależności wynikających z typu dokumentu oraz kontrola dostępu
 * użytkownika do wszystkich magazynów biorących udzial w operacji.
 */
function validateByType(db: Db, user: AuthUser, docType: DocType, input: DocumentInput | DocumentUpdate): void {
  const wh = input.warehouseId ?? null;
  const from = input.warehouseFromId ?? null;
  const to = input.warehouseToId ?? null;

  const requireMainWarehouse = (label: string): number => {
    if (wh === null) throw badRequest(`${label} wymaga wskazania magazynu.`);
    assertWarehouseExists(db, wh, 'Magazyn');
    assertWarehouseAccess(user.warehouseIds, wh, 'magazynu dokumentu');
    return wh;
  };

  switch (docType) {
    case 'PZ': {
      requireMainWarehouse('Przyjęcie PZ');
      if (!input.supplierId) throw badRequest('Przyjęcie PZ wymaga wskazania dostawcy.');
      assertPartner(db, input.supplierId, 'supplier');
      assertRoles(input.lines, ['STD'], 'PZ');
      break;
    }
    case 'WZ': {
      requireMainWarehouse('Wydanie WZ');
      if (!input.customerId) throw badRequest('Wydanie WZ wymaga wskazania odbiorcy.');
      assertPartner(db, input.customerId, 'customer');
      assertRoles(input.lines, ['STD'], 'WZ');
      break;
    }
    case 'MM': {
      if (from === null || to === null) {
        throw badRequest('Przesunięcie MM wymaga magazynu źródłowego i docelowego.');
      }
      if (from === to) throw badRequest('Magazyn źródłowy i docelowy muszą być różne.');
      assertWarehouseExists(db, from, 'Magazyn źródłowy');
      assertWarehouseExists(db, to, 'Magazyn docelowy');
      assertWarehouseAccess(user.warehouseIds, from, 'magazynu źródłowego');
      assertWarehouseAccess(user.warehouseIds, to, 'magazynu docelowego');
      assertRoles(input.lines, ['STD'], 'MM');
      break;
    }
    case 'PROD': {
      requireMainWarehouse('Produkcja');
      const inputs = input.lines.filter((l) => l.role === 'INPUT');
      const outputs = input.lines.filter((l) => l.role === 'OUTPUT');
      if (inputs.length === 0) throw badRequest('Produkcja wymaga co najmniej jednej pozycji surowca (INPUT).');
      if (outputs.length === 0) throw badRequest('Produkcja wymaga co najmniej jednej pozycji wyrobu (OUTPUT).');
      assertRoles(input.lines, ['INPUT', 'OUTPUT'], 'PROD');
      if (input.chippingMode === 'EXTERNAL' && !input.chippingCompany.trim()) {
        throw badRequest('Przy rąbaniu zewnętrznym wymagana jest nazwa firmy.');
      }
      break;
    }
    case 'TR': {
      if (wh !== null) {
        assertWarehouseExists(db, wh, 'Magazyn');
        assertWarehouseAccess(user.warehouseIds, wh, 'magazynu dokumentu');
      }
      if (from !== null) {
        assertWarehouseExists(db, from, 'Magazyn załadunku');
        assertWarehouseAccess(user.warehouseIds, from, 'magazynu załadunku');
      }
      if (to !== null) {
        assertWarehouseExists(db, to, 'Magazyn rozładunku');
        assertWarehouseAccess(user.warehouseIds, to, 'magazynu rozładunku');
      }
      if (!input.carrierId && !input.vehiclePlate.trim()) {
        throw badRequest('Transport wymaga wskazania przewoźnika lub numeru rejestracyjnego.');
      }
      assertPartner(db, input.carrierId, 'carrier');
      assertRoles(input.lines, ['STD'], 'TR');
      break;
    }
    case 'SD': {
      if (!input.supplierId) throw badRequest('Sprzedaż bezpośrednia wymaga wskazania dostawcy.');
      if (!input.customerId) throw badRequest('Sprzedaż bezpośrednia wymaga wskazania odbiorcy.');
      assertPartner(db, input.supplierId, 'supplier');
      assertPartner(db, input.customerId, 'customer');
      assertRoles(input.lines, ['STD'], 'SD');
      break;
    }
    default:
      throw badRequest(`Nieobsługiwany typ dokumentu: ${docType}`);
  }

  if (input.carrierId) assertPartner(db, input.carrierId, 'carrier');
}

function assertRoles(lines: LineInput[], allowed: Array<'STD' | 'INPUT' | 'OUTPUT'>, docType: string): void {
  for (const line of lines) {
    if (!allowed.includes(line.role)) {
      throw badRequest(`Dokument ${docType} nie dopuszcza pozycji o roli ${line.role}.`);
    }
  }
}

// --------------------------------------------------------------------------
// Przeliczenia naglowka
// --------------------------------------------------------------------------

interface ComputedLine {
  lineNo: number;
  role: 'STD' | 'INPUT' | 'OUTPUT';
  productId: number;
  baseUnit: BaseUnit;
  qtyBase: number;
  qtyM3: number;
  qtyMp: number;
  qtyT: number;
  qtyM3Manual: number;
  qtyMpManual: number;
  qtyTManual: number;
  unitPriceGr: number;
  valueGr: number;
  costUnitPriceGr: number;
  costValueGr: number;
  notes: string;
}

function computeLines(db: Db, input: DocumentInput | DocumentUpdate): ComputedLine[] {
  const globalRates = getConversionRates(db);
  const products = loadProducts(db, input.lines.map((l) => l.productId));
  const computed: ComputedLine[] = [];

  input.lines.forEach((line, index) => {
    const product = products.get(line.productId);
    if (!product) throw badRequest(`Produkt o identyfikatorze ${line.productId} nie istnieje.`);
    if (!product.is_active) throw badRequest(`Produkt "${product.name}" jest nieaktywny.`);

    // Przeliczniki produktu maja pierwszenstwo przed globalnymi.
    const rates = {
      m3PerMp: product.m3_per_mp ?? globalRates.m3PerMp,
      tPerMp: product.t_per_mp ?? globalRates.tPerMp,
    };

    const qtyBase = roundQty(line.qtyBase);
    const derived = deriveQuantities(qtyBase, product.base_unit, rates);

    const m3Manual = line.qtyM3 !== null && line.qtyM3 !== undefined;
    const mpManual = line.qtyMp !== null && line.qtyMp !== undefined;
    const tManual = line.qtyT !== null && line.qtyT !== undefined;

    const unitPriceGr = toGrosze(line.unitPrice);
    const costUnitPriceGr = toGrosze(line.costUnitPrice);

    computed.push({
      lineNo: index + 1,
      role: line.role,
      productId: product.id,
      baseUnit: product.base_unit,
      qtyBase,
      qtyM3: roundQty(m3Manual ? (line.qtyM3 as number) : derived.m3),
      qtyMp: roundQty(mpManual ? (line.qtyMp as number) : derived.mp),
      qtyT: roundQty(tManual ? (line.qtyT as number) : derived.t),
      qtyM3Manual: m3Manual ? 1 : 0,
      qtyMpManual: mpManual ? 1 : 0,
      qtyTManual: tManual ? 1 : 0,
      unitPriceGr,
      valueGr: lineValueGr(unitPriceGr, qtyBase),
      costUnitPriceGr,
      costValueGr: lineValueGr(costUnitPriceGr, qtyBase),
      notes: line.notes,
    });
  });

  return computed;
}

interface ComputedHeader {
  chippingMode: 'OWN' | 'EXTERNAL' | null;
  chippingRateGr: number;
  chippingCostGr: number;
  transportRateGr: number;
  transportCostGr: number;
  totalValueGr: number;
  totalCostGr: number;
}

function computeHeader(
  db: Db,
  docType: DocType,
  input: DocumentInput | DocumentUpdate,
  lines: ComputedLine[],
): ComputedHeader {
  const rates = getSetting(db, 'rates');

  let chippingMode: 'OWN' | 'EXTERNAL' | null = null;
  let chippingRateGr = 0;
  let chippingCostGr = 0;

  if (docType === 'PROD') {
    chippingMode = input.chippingMode ?? rates.chippingDefaultMode;
    chippingRateGr = toGrosze(
      input.chippingRate === null || input.chippingRate === undefined
        ? rates.chippingPlnPerUnit
        : input.chippingRate,
    );
    const outputQty = lines
      .filter((l) => l.role === 'OUTPUT')
      .reduce((sum, l) => sum + l.qtyBase, 0);
    chippingCostGr = lineValueGr(chippingRateGr, roundQty(outputQty));
  }

  let transportRateGr = 0;
  let transportCostGr = 0;
  if (docType === 'TR') {
    transportRateGr = toGrosze(
      input.transportRate === null || input.transportRate === undefined
        ? rates.transportPlnPerKm
        : input.transportRate,
    );
    transportCostGr =
      input.transportCost === null || input.transportCost === undefined
        ? lineValueGr(transportRateGr, roundQty(input.distanceKm))
        : toGrosze(input.transportCost);
  }

  const totalValueGr = lines
    .filter((l) => l.role !== 'INPUT')
    .reduce((sum, l) => sum + l.valueGr, 0);
  const totalCostGr =
    lines.filter((l) => l.role !== 'OUTPUT').reduce((sum, l) => sum + l.costValueGr, 0) +
    chippingCostGr +
    transportCostGr;

  return { chippingMode, chippingRateGr, chippingCostGr, transportRateGr, transportCostGr, totalValueGr, totalCostGr };
}

// --------------------------------------------------------------------------
// Zapis pozycji
// --------------------------------------------------------------------------

function insertLines(db: Db, documentId: number, lines: ComputedLine[]): void {
  const stmt = db.prepare(
    `INSERT INTO document_lines
       (document_id, line_no, line_role, product_id, base_unit, qty_base,
        qty_m3, qty_mp, qty_t, qty_m3_manual, qty_mp_manual, qty_t_manual,
        unit_price_gr, value_gr, cost_unit_price_gr, cost_value_gr, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const l of lines) {
    stmt.run(
      documentId,
      l.lineNo,
      l.role,
      l.productId,
      l.baseUnit,
      l.qtyBase,
      l.qtyM3,
      l.qtyMp,
      l.qtyT,
      l.qtyM3Manual,
      l.qtyMpManual,
      l.qtyTManual,
      l.unitPriceGr,
      l.valueGr,
      l.costUnitPriceGr,
      l.costValueGr,
      l.notes,
    );
  }
}

// --------------------------------------------------------------------------
// Operacje
// --------------------------------------------------------------------------

export function createDocument(
  db: Db,
  user: AuthUser,
  actor: AuditActor,
  input: DocumentInput,
): DocumentDto {
  assertDocPermission(user, input.docType, 'manage');
  validateByType(db, user, input.docType, input);

  if (input.clientRequestId) {
    const existing = db
      .prepare('SELECT id FROM documents WHERE client_request_id = ?')
      .get(input.clientRequestId) as { id: number } | undefined;
    // Powtorzone żądanie (np. podwojne klikniecie) zwraca istniejący dokument
    // zamiast tworzyc duplikat.
    if (existing) return getDocument(db, user, existing.id);
  }

  const lines = computeLines(db, input);
  const header = computeHeader(db, input.docType, input, lines);

  const tx = db.transaction(() => {
    const year = yearOf(input.docDate);
    const numberingWarehouseId = input.warehouseId ?? input.warehouseFromId ?? null;
    const warehouseCode = numberingWarehouseId
      ? ((db.prepare('SELECT code FROM warehouses WHERE id = ?').get(numberingWarehouseId) as { code: string } | undefined)
          ?.code ?? null)
      : null;
    const { number, seq } = nextDocumentNumber(db, input.docType, year, numberingWarehouseId, warehouseCode);

    const stamp = nowIso();
    const result = db
      .prepare(
        `INSERT INTO documents
           (doc_type, doc_number, doc_year, doc_seq, doc_date, status,
            warehouse_id, warehouse_from_id, warehouse_to_id,
            supplier_id, customer_id, carrier_id,
            forest_ticket_no, forest_district, forest_subdistrict,
            chipping_mode, chipping_company, chipping_rate_gr, chipping_cost_gr, production_place,
            vehicle_plate, driver_name, load_place, unload_place,
            distance_km, transport_rate_gr, transport_cost_gr,
            total_value_gr, total_cost_gr, client_request_id,
            parent_document_id, external_number, notes, version,
            created_at, created_by, updated_at, updated_by)
         VALUES
           (@doc_type, @doc_number, @doc_year, @doc_seq, @doc_date, 'DRAFT',
            @warehouse_id, @warehouse_from_id, @warehouse_to_id,
            @supplier_id, @customer_id, @carrier_id,
            @forest_ticket_no, @forest_district, @forest_subdistrict,
            @chipping_mode, @chipping_company, @chipping_rate_gr, @chipping_cost_gr, @production_place,
            @vehicle_plate, @driver_name, @load_place, @unload_place,
            @distance_km, @transport_rate_gr, @transport_cost_gr,
            @total_value_gr, @total_cost_gr, @client_request_id,
            @parent_document_id, @external_number, @notes, 1,
            @stamp, @user_id, @stamp, @user_id)`,
      )
      .run({
        doc_type: input.docType,
        doc_number: number,
        doc_year: year,
        doc_seq: seq,
        doc_date: input.docDate,
        warehouse_id: input.warehouseId ?? null,
        warehouse_from_id: input.warehouseFromId ?? null,
        warehouse_to_id: input.warehouseToId ?? null,
        supplier_id: input.supplierId ?? null,
        customer_id: input.customerId ?? null,
        carrier_id: input.carrierId ?? null,
        forest_ticket_no: input.forestTicketNo,
        forest_district: input.forestDistrict,
        forest_subdistrict: input.forestSubdistrict,
        chipping_mode: header.chippingMode,
        chipping_company: input.chippingCompany,
        chipping_rate_gr: header.chippingRateGr,
        chipping_cost_gr: header.chippingCostGr,
        production_place: input.productionPlace,
        vehicle_plate: input.vehiclePlate.toUpperCase(),
        driver_name: input.driverName,
        load_place: input.loadPlace,
        unload_place: input.unloadPlace,
        distance_km: roundQty(input.distanceKm),
        transport_rate_gr: header.transportRateGr,
        transport_cost_gr: header.transportCostGr,
        total_value_gr: header.totalValueGr,
        total_cost_gr: header.totalCostGr,
        client_request_id: input.clientRequestId ?? null,
        parent_document_id: input.parentDocumentId ?? null,
        external_number: input.externalNumber,
        notes: input.notes,
        stamp,
        user_id: user.id,
      });

    const documentId = Number(result.lastInsertRowid);
    insertLines(db, documentId, lines);

    writeAudit(db, {
      actor,
      action: 'CREATE',
      module: moduleOfDoc(input.docType),
      entityType: 'document',
      entityId: documentId,
      entityLabel: number,
      warehouseId: input.warehouseId ?? input.warehouseFromId ?? null,
      changes: [
        { field: 'status', before: null, after: 'DRAFT' },
        { field: 'docDate', before: null, after: input.docDate },
        { field: 'lines', before: null, after: lines.length },
        { field: 'totalValue', before: null, after: toPln(header.totalValueGr) },
      ],
    });

    return documentId;
  });

  const id = tx.immediate();
  return getDocument(db, user, id);
}

export function updateDocument(
  db: Db,
  user: AuthUser,
  actor: AuditActor,
  id: number,
  input: DocumentUpdate,
): DocumentDto {
  const existing = loadDocumentRow(db, id);
  assertDocPermission(user, existing.doc_type, 'manage');

  if (existing.status !== 'DRAFT') {
    throw invalidState(
      `Dokument ${existing.doc_number} ma status ${existing.status} i nie może być edytowany. Użyj korekty.`,
    );
  }

  const asInput = { ...input, docType: existing.doc_type } as DocumentInput;
  validateByType(db, user, existing.doc_type, asInput);

  const lines = computeLines(db, asInput);
  const header = computeHeader(db, existing.doc_type, asInput, lines);
  const previousLines = loadLines(db, id);

  const tx = db.transaction(() => {
    const stamp = nowIso();
    const result = db
      .prepare(
        `UPDATE documents SET
            doc_date = @doc_date,
            warehouse_id = @warehouse_id,
            warehouse_from_id = @warehouse_from_id,
            warehouse_to_id = @warehouse_to_id,
            supplier_id = @supplier_id,
            customer_id = @customer_id,
            carrier_id = @carrier_id,
            forest_ticket_no = @forest_ticket_no,
            forest_district = @forest_district,
            forest_subdistrict = @forest_subdistrict,
            chipping_mode = @chipping_mode,
            chipping_company = @chipping_company,
            chipping_rate_gr = @chipping_rate_gr,
            chipping_cost_gr = @chipping_cost_gr,
            production_place = @production_place,
            vehicle_plate = @vehicle_plate,
            driver_name = @driver_name,
            load_place = @load_place,
            unload_place = @unload_place,
            distance_km = @distance_km,
            transport_rate_gr = @transport_rate_gr,
            transport_cost_gr = @transport_cost_gr,
            total_value_gr = @total_value_gr,
            total_cost_gr = @total_cost_gr,
            parent_document_id = @parent_document_id,
            external_number = @external_number,
            notes = @notes,
            version = version + 1,
            updated_at = @stamp,
            updated_by = @user_id
          WHERE id = @id AND version = @version AND status = 'DRAFT'`,
      )
      .run({
        id,
        version: input.version,
        doc_date: input.docDate,
        warehouse_id: input.warehouseId ?? null,
        warehouse_from_id: input.warehouseFromId ?? null,
        warehouse_to_id: input.warehouseToId ?? null,
        supplier_id: input.supplierId ?? null,
        customer_id: input.customerId ?? null,
        carrier_id: input.carrierId ?? null,
        forest_ticket_no: input.forestTicketNo,
        forest_district: input.forestDistrict,
        forest_subdistrict: input.forestSubdistrict,
        chipping_mode: header.chippingMode,
        chipping_company: input.chippingCompany,
        chipping_rate_gr: header.chippingRateGr,
        chipping_cost_gr: header.chippingCostGr,
        production_place: input.productionPlace,
        vehicle_plate: input.vehiclePlate.toUpperCase(),
        driver_name: input.driverName,
        load_place: input.loadPlace,
        unload_place: input.unloadPlace,
        distance_km: roundQty(input.distanceKm),
        transport_rate_gr: header.transportRateGr,
        transport_cost_gr: header.transportCostGr,
        total_value_gr: header.totalValueGr,
        total_cost_gr: header.totalCostGr,
        parent_document_id: input.parentDocumentId ?? null,
        external_number: input.externalNumber,
        notes: input.notes,
        stamp,
        user_id: user.id,
      });

    if (result.changes === 0) {
      throw conflict(
        'Dokument został w międzyczasie zmieniony przez innego użytkownika. Odśwież dane i sprobuj ponownie.',
        'VERSION_CONFLICT',
      );
    }

    db.prepare('DELETE FROM document_lines WHERE document_id = ?').run(id);
    insertLines(db, id, lines);

    const changes: FieldChange[] = [
      { field: 'docDate', before: existing.doc_date, after: input.docDate },
      { field: 'totalValue', before: toPln(existing.total_value_gr), after: toPln(header.totalValueGr) },
      { field: 'lines', before: previousLines.length, after: lines.length },
      {
        field: 'quantityTotal',
        before: roundQty(previousLines.reduce((s, l) => s + l.qty_base, 0)),
        after: roundQty(lines.reduce((s, l) => s + l.qtyBase, 0)),
      },
    ].filter((c) => String(c.before) !== String(c.after));

    writeAudit(db, {
      actor,
      action: 'UPDATE',
      module: moduleOfDoc(existing.doc_type),
      entityType: 'document',
      entityId: id,
      entityLabel: existing.doc_number,
      warehouseId: input.warehouseId ?? input.warehouseFromId ?? null,
      changes,
    });
  });

  tx.immediate();
  return getDocument(db, user, id);
}

export function postDocument(
  db: Db,
  user: AuthUser,
  actor: AuditActor,
  id: number,
  version: number,
): DocumentDto {
  const existing = loadDocumentRow(db, id);
  assertDocPermission(user, existing.doc_type, 'post');

  if (existing.status === 'POSTED') {
    throw invalidState(`Dokument ${existing.doc_number} jest już zatwierdzony.`);
  }
  if (existing.status === 'CANCELLED') {
    throw invalidState(`Dokument ${existing.doc_number} jest anulowany i nie może zostac zatwierdzony.`);
  }

  const policy = getSetting(db, 'stockPolicy');
  const allowNegative = policy.allowNegative && user.permissions.has('stock.allow_negative');

  const tx = db.transaction(() => {
    // Ponowny odczyt wewnątrz transakcji - chroni przed wyścigiem dwoch
    // równoczesnych zatwierdzen tego samego dokumentu.
    const fresh = loadDocumentRow(db, id);
    if (fresh.status !== 'DRAFT') {
      throw invalidState(`Dokument ${fresh.doc_number} ma status ${fresh.status}.`);
    }
    if (fresh.version !== version) {
      throw conflict(
        'Dokument został w międzyczasie zmieniony. Odśwież dane i sprobuj ponownie.',
        'VERSION_CONFLICT',
      );
    }

    const lines = loadLines(db, id);
    if (lines.length === 0) throw badRequest('Dokument bez pozycji nie może zostac zatwierdzony.');

    const movements = planMovements(fresh, lines);
    applyMovements(db, fresh, movements, { allowNegative, reason: 'POSTING', userId: user.id });

    const stamp = nowIso();
    const result = db
      .prepare(
        `UPDATE documents
            SET status = 'POSTED', posted_at = ?, posted_by = ?, updated_at = ?, updated_by = ?, version = version + 1
          WHERE id = ? AND version = ? AND status = 'DRAFT'`,
      )
      .run(stamp, user.id, stamp, user.id, id, version);

    if (result.changes === 0) {
      throw conflict('Nie udało się zatwierdzić dokumentu - stan uległ zmianie.', 'VERSION_CONFLICT');
    }

    writeAudit(db, {
      actor,
      action: 'POST',
      module: moduleOfDoc(fresh.doc_type),
      entityType: 'document',
      entityId: id,
      entityLabel: fresh.doc_number,
      warehouseId: fresh.warehouse_id ?? fresh.warehouse_from_id,
      changes: [
        { field: 'status', before: 'DRAFT', after: 'POSTED' },
        { field: 'movements', before: 0, after: movements.length },
      ],
    });
  });

  tx.immediate();
  return getDocument(db, user, id);
}

export function cancelDocument(
  db: Db,
  user: AuthUser,
  actor: AuditActor,
  id: number,
  reason: string,
  version: number,
): DocumentDto {
  const existing = loadDocumentRow(db, id);
  assertDocPermission(user, existing.doc_type, 'cancel');

  if (existing.status === 'CANCELLED') {
    throw invalidState(`Dokument ${existing.doc_number} jest już anulowany.`);
  }

  const policy = getSetting(db, 'stockPolicy');
  const allowNegative = policy.allowNegative && user.permissions.has('stock.allow_negative');

  const tx = db.transaction(() => {
    const fresh = loadDocumentRow(db, id);
    if (fresh.status === 'CANCELLED') throw invalidState('Dokument jest już anulowany.');
    if (fresh.version !== version) {
      throw conflict('Dokument został w międzyczasie zmieniony. Odśwież dane.', 'VERSION_CONFLICT');
    }

    if (fresh.status === 'POSTED' && STOCK_AFFECTING.has(fresh.doc_type)) {
      const reversal = planReversal(db, id);
      applyMovements(db, fresh, reversal, { allowNegative, reason: 'REVERSAL', userId: user.id });
    }

    const stamp = nowIso();
    const result = db
      .prepare(
        `UPDATE documents
            SET status = 'CANCELLED', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?,
                updated_at = ?, updated_by = ?, version = version + 1
          WHERE id = ? AND version = ? AND status <> 'CANCELLED'`,
      )
      .run(stamp, user.id, reason, stamp, user.id, id, version);

    if (result.changes === 0) {
      throw conflict('Nie udało się anulować dokumentu - stan uległ zmianie.', 'VERSION_CONFLICT');
    }

    writeAudit(db, {
      actor,
      action: 'CANCEL',
      module: moduleOfDoc(fresh.doc_type),
      entityType: 'document',
      entityId: id,
      entityLabel: fresh.doc_number,
      warehouseId: fresh.warehouse_id ?? fresh.warehouse_from_id,
      changes: [
        { field: 'status', before: fresh.status, after: 'CANCELLED' },
        { field: 'cancelReason', before: '', after: reason },
      ],
    });
  });

  tx.immediate();
  return getDocument(db, user, id);
}

/**
 * Korekta dokumentu zatwierdzonego: anuluje oryginal (ze stornem ruchow)
 * i tworzy nowy dokument roboczy bedacy jego kopia, oznaczony jako korekta.
 * Obie czynnosci wykonywane są w jednej transakcji.
 */
export function correctDocument(
  db: Db,
  user: AuthUser,
  actor: AuditActor,
  id: number,
  reason: string,
  version: number,
): DocumentDto {
  const existing = loadDocumentRow(db, id);
  assertDocPermission(user, existing.doc_type, 'cancel');
  assertDocPermission(user, existing.doc_type, 'manage');

  if (existing.status !== 'POSTED') {
    throw invalidState('Korekcie podlegaja wyłącznie dokumenty zatwierdzone.');
  }

  const policy = getSetting(db, 'stockPolicy');
  const allowNegative = policy.allowNegative && user.permissions.has('stock.allow_negative');

  const tx = db.transaction(() => {
    const fresh = loadDocumentRow(db, id);
    if (fresh.status !== 'POSTED') throw invalidState('Dokument nie jest zatwierdzony.');
    if (fresh.version !== version) {
      throw conflict('Dokument został w międzyczasie zmieniony. Odśwież dane.', 'VERSION_CONFLICT');
    }

    if (STOCK_AFFECTING.has(fresh.doc_type)) {
      const reversal = planReversal(db, id);
      applyMovements(db, fresh, reversal, { allowNegative, reason: 'REVERSAL', userId: user.id });
    }

    const stamp = nowIso();
    db.prepare(
      `UPDATE documents
          SET status = 'CANCELLED', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?,
              updated_at = ?, updated_by = ?, version = version + 1
        WHERE id = ? AND version = ?`,
    ).run(stamp, user.id, `Korekta: ${reason}`, stamp, user.id, id, version);

    const numberingWarehouseId = fresh.warehouse_id ?? fresh.warehouse_from_id ?? null;
    const warehouseCode = numberingWarehouseId
      ? ((db.prepare('SELECT code FROM warehouses WHERE id = ?').get(numberingWarehouseId) as { code: string } | undefined)
          ?.code ?? null)
      : null;
    const { number, seq } = nextDocumentNumber(
      db,
      fresh.doc_type,
      yearOf(fresh.doc_date),
      numberingWarehouseId,
      warehouseCode,
    );

    const copy = db
      .prepare(
        `INSERT INTO documents
           (doc_type, doc_number, doc_year, doc_seq, doc_date, status,
            warehouse_id, warehouse_from_id, warehouse_to_id,
            supplier_id, customer_id, carrier_id,
            forest_ticket_no, forest_district, forest_subdistrict,
            chipping_mode, chipping_company, chipping_rate_gr, chipping_cost_gr, production_place,
            vehicle_plate, driver_name, load_place, unload_place,
            distance_km, transport_rate_gr, transport_cost_gr,
            total_value_gr, total_cost_gr,
            parent_document_id, correction_of_id, external_number, notes, version,
            created_at, created_by, updated_at, updated_by)
         SELECT doc_type, ?, ?, ?, doc_date, 'DRAFT',
                warehouse_id, warehouse_from_id, warehouse_to_id,
                supplier_id, customer_id, carrier_id,
                forest_ticket_no, forest_district, forest_subdistrict,
                chipping_mode, chipping_company, chipping_rate_gr, chipping_cost_gr, production_place,
                vehicle_plate, driver_name, load_place, unload_place,
                distance_km, transport_rate_gr, transport_cost_gr,
                total_value_gr, total_cost_gr,
                parent_document_id, ?, external_number, notes, 1,
                ?, ?, ?, ?
           FROM documents WHERE id = ?`,
      )
      .run(number, yearOf(fresh.doc_date), seq, id, stamp, user.id, stamp, user.id, id);

    const newId = Number(copy.lastInsertRowid);

    db.prepare(
      `INSERT INTO document_lines
         (document_id, line_no, line_role, product_id, base_unit, qty_base,
          qty_m3, qty_mp, qty_t, qty_m3_manual, qty_mp_manual, qty_t_manual,
          unit_price_gr, value_gr, cost_unit_price_gr, cost_value_gr, notes)
       SELECT ?, line_no, line_role, product_id, base_unit, qty_base,
              qty_m3, qty_mp, qty_t, qty_m3_manual, qty_mp_manual, qty_t_manual,
              unit_price_gr, value_gr, cost_unit_price_gr, cost_value_gr, notes
         FROM document_lines WHERE document_id = ? ORDER BY line_no`,
    ).run(newId, id);

    writeAudit(db, {
      actor,
      action: 'CORRECT',
      module: moduleOfDoc(fresh.doc_type),
      entityType: 'document',
      entityId: id,
      entityLabel: fresh.doc_number,
      warehouseId: fresh.warehouse_id ?? fresh.warehouse_from_id,
      changes: [
        { field: 'status', before: 'POSTED', after: 'CANCELLED' },
        { field: 'correctedBy', before: null, after: number },
        { field: 'reason', before: null, after: reason },
      ],
    });

    writeAudit(db, {
      actor,
      action: 'CREATE',
      module: moduleOfDoc(fresh.doc_type),
      entityType: 'document',
      entityId: newId,
      entityLabel: number,
      warehouseId: fresh.warehouse_id ?? fresh.warehouse_from_id,
      changes: [{ field: 'correctionOf', before: null, after: fresh.doc_number }],
    });

    return newId;
  });

  const newId = tx.immediate();
  return getDocument(db, user, newId);
}

export function deleteDraft(db: Db, user: AuthUser, actor: AuditActor, id: number): void {
  const existing = loadDocumentRow(db, id);
  assertDocPermission(user, existing.doc_type, 'manage');
  if (existing.status !== 'DRAFT') {
    throw invalidState('Usunąć można wyłącznie dokument roboczy. Dokument zatwierdzony należy anulować.');
  }

  const tx = db.transaction(() => {
    writeAudit(db, {
      actor,
      action: 'DELETE',
      module: moduleOfDoc(existing.doc_type),
      entityType: 'document',
      entityId: id,
      entityLabel: existing.doc_number,
      warehouseId: existing.warehouse_id ?? existing.warehouse_from_id,
      changes: [{ field: 'status', before: 'DRAFT', after: 'DELETED' }],
    });
    db.prepare('DELETE FROM documents WHERE id = ? AND status = ?').run(id, 'DRAFT');
  });
  tx.immediate();
}

// --------------------------------------------------------------------------
// Odczyt
// --------------------------------------------------------------------------

export function loadDocumentRow(db: Db, id: number): DocumentRow {
  const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as DocumentRow | undefined;
  if (!row) throw notFound(`Nie znaleziono dokumentu o identyfikatorze ${id}.`);
  return row;
}

function loadLines(db: Db, documentId: number): DocumentLineRow[] {
  return db
    .prepare('SELECT * FROM document_lines WHERE document_id = ? ORDER BY line_no')
    .all(documentId) as DocumentLineRow[];
}

export interface DocumentLineDto {
  id: number;
  lineNo: number;
  role: 'STD' | 'INPUT' | 'OUTPUT';
  productId: number;
  productCode: string;
  productName: string;
  baseUnit: BaseUnit;
  qtyBase: number;
  qtyM3: number;
  qtyMp: number;
  qtyT: number;
  qtyM3Manual: boolean;
  qtyMpManual: boolean;
  qtyTManual: boolean;
  unitPrice: number;
  value: number;
  costUnitPrice: number;
  costValue: number;
  notes: string;
}

export interface DocumentDto {
  id: number;
  docType: DocType;
  docNumber: string;
  docDate: string;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  warehouseId: number | null;
  warehouseName: string | null;
  warehouseFromId: number | null;
  warehouseFromName: string | null;
  warehouseToId: number | null;
  warehouseToName: string | null;
  supplierId: number | null;
  supplierName: string | null;
  customerId: number | null;
  customerName: string | null;
  carrierId: number | null;
  carrierName: string | null;
  forestTicketNo: string;
  forestDistrict: string;
  forestSubdistrict: string;
  chippingMode: 'OWN' | 'EXTERNAL' | null;
  chippingCompany: string;
  chippingRate: number;
  chippingCost: number;
  productionPlace: string;
  vehiclePlate: string;
  driverName: string;
  loadPlace: string;
  unloadPlace: string;
  distanceKm: number;
  transportRate: number;
  transportCost: number;
  totalValue: number;
  totalCost: number;
  parentDocumentId: number | null;
  correctionOfId: number | null;
  correctionOfNumber: string | null;
  correctedByNumber: string | null;
  cancelReason: string;
  externalNumber: string;
  notes: string;
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  postedAt: string | null;
  postedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  lines: DocumentLineDto[];
  attachments: AttachmentDto[];
  totals: {
    qtyM3: number;
    qtyMp: number;
    qtyT: number;
    inputQtyBase: number;
    outputQtyBase: number;
  };
  derived: {
    costPerKm: number | null;
    costPerT: number | null;
    costPerMp: number | null;
    costPerM3: number | null;
  };
}

export interface AttachmentDto {
  id: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: string;
}

function userNameOf(db: Db, id: number | null): string | null {
  if (id === null) return null;
  const row = db.prepare('SELECT full_name FROM users WHERE id = ?').get(id) as { full_name: string } | undefined;
  return row?.full_name ?? `#${id}`;
}

function nameOf(db: Db, table: 'warehouses' | 'partners' | 'products', id: number | null): string | null {
  if (id === null) return null;
  const row = db.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(id) as { name: string } | undefined;
  return row?.name ?? null;
}

export function getDocument(db: Db, user: AuthUser, id: number): DocumentDto {
  const doc = loadDocumentRow(db, id);
  assertDocPermission(user, doc.doc_type, 'view');
  assertDocumentVisibility(user, doc);

  const lines = loadLines(db, id);
  const products = loadProducts(db, lines.map((l) => l.product_id));

  const lineDtos: DocumentLineDto[] = lines.map((l) => {
    const product = products.get(l.product_id);
    return {
      id: l.id,
      lineNo: l.line_no,
      role: l.line_role,
      productId: l.product_id,
      productCode: product?.code ?? '',
      productName: product?.name ?? `#${l.product_id}`,
      baseUnit: l.base_unit,
      qtyBase: roundQty(l.qty_base),
      qtyM3: roundQty(l.qty_m3),
      qtyMp: roundQty(l.qty_mp),
      qtyT: roundQty(l.qty_t),
      qtyM3Manual: l.qty_m3_manual === 1,
      qtyMpManual: l.qty_mp_manual === 1,
      qtyTManual: l.qty_t_manual === 1,
      unitPrice: toPln(l.unit_price_gr),
      value: toPln(l.value_gr),
      costUnitPrice: toPln(l.cost_unit_price_gr),
      costValue: toPln(l.cost_value_gr),
      notes: l.notes,
    };
  });

  const attachments = db
    .prepare(
      `SELECT a.id, a.file_name, a.original_name, a.mime_type, a.size_bytes, a.uploaded_at, u.full_name
         FROM attachments a JOIN users u ON u.id = a.uploaded_by
        WHERE a.document_id = ? ORDER BY a.uploaded_at`,
    )
    .all(id) as Array<{
    id: string;
    file_name: string;
    original_name: string;
    mime_type: string;
    size_bytes: number;
    uploaded_at: string;
    full_name: string;
  }>;

  const relevant = lineDtos.filter((l) => l.role !== 'INPUT');
  const totals = {
    qtyM3: roundQty(relevant.reduce((s, l) => s + l.qtyM3, 0)),
    qtyMp: roundQty(relevant.reduce((s, l) => s + l.qtyMp, 0)),
    qtyT: roundQty(relevant.reduce((s, l) => s + l.qtyT, 0)),
    inputQtyBase: roundQty(lineDtos.filter((l) => l.role === 'INPUT').reduce((s, l) => s + l.qtyBase, 0)),
    outputQtyBase: roundQty(lineDtos.filter((l) => l.role === 'OUTPUT').reduce((s, l) => s + l.qtyBase, 0)),
  };

  const cost = toPln(doc.transport_cost_gr);
  const derived = {
    costPerKm: doc.distance_km > 0 ? round2(cost / doc.distance_km) : null,
    costPerT: totals.qtyT > 0 ? round2(cost / totals.qtyT) : null,
    costPerMp: totals.qtyMp > 0 ? round2(cost / totals.qtyMp) : null,
    costPerM3: totals.qtyM3 > 0 ? round2(cost / totals.qtyM3) : null,
  };

  const correctionOfNumber = doc.correction_of_id
    ? ((db.prepare('SELECT doc_number FROM documents WHERE id = ?').get(doc.correction_of_id) as
        | { doc_number: string }
        | undefined)?.doc_number ?? null)
    : null;
  const correctedBy = db
    .prepare('SELECT doc_number FROM documents WHERE correction_of_id = ? ORDER BY id DESC LIMIT 1')
    .get(doc.id) as { doc_number: string } | undefined;

  return {
    id: doc.id,
    docType: doc.doc_type,
    docNumber: doc.doc_number,
    docDate: doc.doc_date,
    status: doc.status,
    warehouseId: doc.warehouse_id,
    warehouseName: nameOf(db, 'warehouses', doc.warehouse_id),
    warehouseFromId: doc.warehouse_from_id,
    warehouseFromName: nameOf(db, 'warehouses', doc.warehouse_from_id),
    warehouseToId: doc.warehouse_to_id,
    warehouseToName: nameOf(db, 'warehouses', doc.warehouse_to_id),
    supplierId: doc.supplier_id,
    supplierName: nameOf(db, 'partners', doc.supplier_id),
    customerId: doc.customer_id,
    customerName: nameOf(db, 'partners', doc.customer_id),
    carrierId: doc.carrier_id,
    carrierName: nameOf(db, 'partners', doc.carrier_id),
    forestTicketNo: doc.forest_ticket_no,
    forestDistrict: doc.forest_district,
    forestSubdistrict: doc.forest_subdistrict,
    chippingMode: doc.chipping_mode,
    chippingCompany: doc.chipping_company,
    chippingRate: toPln(doc.chipping_rate_gr),
    chippingCost: toPln(doc.chipping_cost_gr),
    productionPlace: doc.production_place,
    vehiclePlate: doc.vehicle_plate,
    driverName: doc.driver_name,
    loadPlace: doc.load_place,
    unloadPlace: doc.unload_place,
    distanceKm: doc.distance_km,
    transportRate: toPln(doc.transport_rate_gr),
    transportCost: cost,
    totalValue: toPln(doc.total_value_gr),
    totalCost: toPln(doc.total_cost_gr),
    parentDocumentId: doc.parent_document_id,
    correctionOfId: doc.correction_of_id,
    correctionOfNumber,
    correctedByNumber: correctedBy?.doc_number ?? null,
    cancelReason: doc.cancel_reason,
    externalNumber: doc.external_number,
    notes: doc.notes,
    version: doc.version,
    createdAt: doc.created_at,
    createdBy: userNameOf(db, doc.created_by) ?? '',
    updatedAt: doc.updated_at,
    postedAt: doc.posted_at,
    postedBy: userNameOf(db, doc.posted_by),
    cancelledAt: doc.cancelled_at,
    cancelledBy: userNameOf(db, doc.cancelled_by),
    lines: lineDtos,
    attachments: attachments.map((a) => ({
      id: a.id,
      fileName: a.file_name,
      originalName: a.original_name,
      mimeType: a.mime_type,
      sizeBytes: a.size_bytes,
      uploadedAt: a.uploaded_at,
      uploadedBy: a.full_name,
    })),
    totals,
    derived,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Dokument jest widoczny, jeśli dotyczy magazynu przypisanego użytkownikowi.
 * Dokumenty bez kontekstu magazynowego (TR bez magazynów, SD) są widoczne dla
 * każdego, kto ma uprawnienie podglądu danego typu.
 */
function assertDocumentVisibility(user: AuthUser, doc: DocumentRow): void {
  if (user.isAdmin) return;
  const involved = [doc.warehouse_id, doc.warehouse_from_id, doc.warehouse_to_id].filter(
    (x): x is number => x !== null,
  );
  if (involved.length === 0) return;
  if (involved.some((id) => user.warehouseIds.includes(id))) return;
  throw forbidden('Brak dostępu do dokumentu spoza przypisanych magazynów.', 'WAREHOUSE_FORBIDDEN');
}

export interface DocumentListItem {
  id: number;
  docType: DocType;
  docNumber: string;
  docDate: string;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  warehouseName: string | null;
  warehouseFromName: string | null;
  warehouseToName: string | null;
  partnerName: string | null;
  totalValue: number;
  totalCost: number;
  qtyBase: number;
  qtyMp: number;
  qtyM3: number;
  qtyT: number;
  createdBy: string;
  createdAt: string;
  attachmentCount: number;
}

export function listDocuments(
  db: Db,
  user: AuthUser,
  query: DocumentListQuery,
): { items: DocumentListItem[]; total: number; page: number; pageSize: number } {
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (query.docType) {
    assertDocPermission(user, query.docType, 'view');
    where.push('d.doc_type = @docType');
    params.docType = query.docType;
  } else {
    const visible = (['PZ', 'WZ', 'MM', 'PROD', 'TR', 'SD'] as DocType[]).filter((t) =>
      user.permissions.has(docPermission(t, 'view')),
    );
    if (visible.length === 0) return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
    where.push(`d.doc_type IN (${visible.map((t) => `'${t}'`).join(',')})`);
  }

  if (query.status) {
    where.push('d.status = @status');
    params.status = query.status;
  }

  // Ograniczenie do magazynów użytkownika egzekwowane po stronie SQL.
  if (!user.isAdmin) {
    if (user.warehouseIds.length === 0) {
      where.push('d.warehouse_id IS NULL AND d.warehouse_from_id IS NULL AND d.warehouse_to_id IS NULL');
    } else {
      const list = user.warehouseIds.join(',');
      where.push(
        `((d.warehouse_id IS NULL AND d.warehouse_from_id IS NULL AND d.warehouse_to_id IS NULL)
          OR d.warehouse_id IN (${list}) OR d.warehouse_from_id IN (${list}) OR d.warehouse_to_id IN (${list}))`,
      );
    }
  }

  if (query.warehouseId) {
    where.push(
      '(d.warehouse_id = @warehouseId OR d.warehouse_from_id = @warehouseId OR d.warehouse_to_id = @warehouseId)',
    );
    params.warehouseId = query.warehouseId;
  }
  if (query.partnerId) {
    where.push('(d.supplier_id = @partnerId OR d.customer_id = @partnerId OR d.carrier_id = @partnerId)');
    params.partnerId = query.partnerId;
  }
  if (query.productId) {
    where.push('EXISTS (SELECT 1 FROM document_lines dl WHERE dl.document_id = d.id AND dl.product_id = @productId)');
    params.productId = query.productId;
  }
  if (query.dateFrom) {
    where.push('d.doc_date >= @dateFrom');
    params.dateFrom = query.dateFrom;
  }
  if (query.dateTo) {
    where.push('d.doc_date <= @dateTo');
    params.dateTo = query.dateTo;
  }
  if (query.search) {
    where.push(
      `(d.doc_number LIKE @search OR d.external_number LIKE @search OR d.notes LIKE @search
        OR d.vehicle_plate LIKE @search OR d.forest_ticket_no LIKE @search
        OR ps.name LIKE @search OR pc.name LIKE @search)`,
    );
    params.search = `%${query.search}%`;
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const sortColumn = {
    docDate: 'd.doc_date',
    docNumber: 'd.doc_number',
    totalValue: 'd.total_value_gr',
    createdAt: 'd.created_at',
  }[query.sort];
  const orderSql = `${sortColumn} ${query.order === 'asc' ? 'ASC' : 'DESC'}, d.id DESC`;

  const baseFrom = `
    FROM documents d
    LEFT JOIN warehouses w  ON w.id  = d.warehouse_id
    LEFT JOIN warehouses wf ON wf.id = d.warehouse_from_id
    LEFT JOIN warehouses wt ON wt.id = d.warehouse_to_id
    LEFT JOIN partners  ps  ON ps.id = d.supplier_id
    LEFT JOIN partners  pc  ON pc.id = d.customer_id
    LEFT JOIN users     u   ON u.id  = d.created_by
    ${whereSql}
  `;

  const totalRow = db.prepare(`SELECT COUNT(*) AS c ${baseFrom}`).get(params) as { c: number };
  const offset = (query.page - 1) * query.pageSize;

  const rows = db
    .prepare(
      `SELECT d.id, d.doc_type, d.doc_number, d.doc_date, d.status,
              w.name AS warehouse_name, wf.name AS wh_from_name, wt.name AS wh_to_name,
              COALESCE(pc.name, ps.name) AS partner_name,
              d.total_value_gr, d.total_cost_gr,
              u.full_name AS created_by, d.created_at,
              (SELECT COUNT(*) FROM attachments a WHERE a.document_id = d.id) AS attachment_count,
              (SELECT COALESCE(SUM(dl.qty_base), 0) FROM document_lines dl
                WHERE dl.document_id = d.id AND dl.line_role <> 'INPUT') AS qty_base,
              (SELECT COALESCE(SUM(dl.qty_mp), 0) FROM document_lines dl
                WHERE dl.document_id = d.id AND dl.line_role <> 'INPUT') AS qty_mp,
              (SELECT COALESCE(SUM(dl.qty_m3), 0) FROM document_lines dl
                WHERE dl.document_id = d.id AND dl.line_role <> 'INPUT') AS qty_m3,
              (SELECT COALESCE(SUM(dl.qty_t), 0) FROM document_lines dl
                WHERE dl.document_id = d.id AND dl.line_role <> 'INPUT') AS qty_t
       ${baseFrom}
       ORDER BY ${orderSql}
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: query.pageSize, offset }) as Array<Record<string, any>>;

  return {
    items: rows.map((r) => ({
      id: r.id,
      docType: r.doc_type,
      docNumber: r.doc_number,
      docDate: r.doc_date,
      status: r.status,
      warehouseName: r.warehouse_name,
      warehouseFromName: r.wh_from_name,
      warehouseToName: r.wh_to_name,
      partnerName: r.partner_name,
      totalValue: toPln(r.total_value_gr),
      totalCost: toPln(r.total_cost_gr),
      qtyBase: roundQty(r.qty_base),
      qtyMp: roundQty(r.qty_mp),
      qtyM3: roundQty(r.qty_m3),
      qtyT: roundQty(r.qty_t),
      createdBy: r.created_by ?? '',
      createdAt: r.created_at,
      attachmentCount: r.attachment_count,
    })),
    total: totalRow.c,
    page: query.page,
    pageSize: query.pageSize,
  };
}

function moduleOfDoc(docType: DocType): string {
  return {
    PZ: 'receipts',
    WZ: 'issues',
    MM: 'transfers',
    PROD: 'production',
    TR: 'transport',
    SD: 'direct-sale',
  }[docType];
}

/**
 * Raporty zarządcze i kontrolne.
 *
 *  • dashboard          — kafle pulpitu (stany, obroty, transport, marża),
 *  • monthlyReport      — pełny raport miesięczny (BO, obroty, BZ, koszty, kontrahenci),
 *  • productionDay      — kwit produkcji dnia (zużycie surowca → uzysk zrębki),
 *  • transportReport    — zestawienie frachtów wg przewoźnika i pojazdu,
 *  • partnerReport      — obroty w podziale na kontrahentów,
 *  • certificationReport— zestawienie pochodzenia surowca (KZR/SURE).
 *
 * Raporty czytają dane wyłącznie przez agregaty SQL — bez ładowania rejestru
 * do pamięci procesu, więc czas odpowiedzi nie rośnie z liczbą dokumentów.
 */
import db from '../../db/index.js';
import { validate } from '../../lib/validate.js';
import { roundQty, roundMoney } from '../../domain/units.js';
import { endOfMonth, periodStatus } from '../periods/periods.service.js';
import { currentStock, negativeStock } from '../stock/stock.service.js';

const MONTH_NAMES = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
];

export function monthLabel(month) {
  if (!month) return '—';
  const [y, m] = month.split('-');
  return `${MONTH_NAMES[Number(m) - 1] ?? m} ${y}`;
}

const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => today().slice(0, 7);

/* ----------------------------- Pulpit -------------------------------- */

/** Zestaw wskaźników dla ekranu głównego. */
export function dashboard({ month } = {}) {
  const m = /^\d{4}-\d{2}$/.test(month || '') ? month : currentMonth();
  const stock = currentStock();

  const turnover = db.get(
    `SELECT
       COUNT(*)                                                                    AS documents,
       COALESCE(SUM(CASE WHEN type = 'ZAKUP'    THEN value_purchase END), 0)       AS purchase_value,
       COALESCE(SUM(CASE WHEN type = 'SPRZEDAZ' THEN value_sale END), 0)           AS sale_value,
       COALESCE(SUM(chipping_cost), 0)                                             AS chipping_cost,
       COALESCE(SUM(transport_cost), 0)                                            AS transport_cost,
       COALESCE(SUM(CASE WHEN type = 'ZAKUP'      THEN qty_mp END), 0)             AS purchase_mp,
       COALESCE(SUM(CASE WHEN type = 'SPRZEDAZ'   THEN qty_mp END), 0)             AS sale_mp,
       COALESCE(SUM(CASE WHEN type = 'PRODUKCJA'  THEN qty_mp END), 0)             AS production_mp,
       COALESCE(SUM(CASE WHEN type = 'PRODUKCJA'  THEN qty_tonne END), 0)          AS production_t
     FROM operations
    WHERE status = 'POSTED' AND operation_month = :month`,
    { month: m },
  );

  const transports = db.get(
    `SELECT
       COALESCE(SUM(CASE WHEN type IN ('ZAKUP','PRODUKCJA','BO') THEN 1 ELSE 0 END), 0) AS inbound,
       COALESCE(SUM(CASE WHEN type IN ('SPRZEDAZ','MM')          THEN 1 ELSE 0 END), 0) AS outbound
     FROM operations
    WHERE status = 'POSTED' AND operation_month = :month
      AND (COALESCE(carrier_name,'') <> '' OR COALESCE(vehicle_plate,'') <> '' OR transport_cost > 0)`,
    { month: m },
  );

  const lastProductionDay = db.value(
    "SELECT MAX(operation_date) FROM operations WHERE type = 'PRODUKCJA' AND status = 'POSTED'",
  );

  const recent = db.all(
    `SELECT o.id, o.doc_no, o.type, o.product_name, o.qty_mp, o.qty_tonne,
            o.operation_date, o.supplier_name, o.recipient_name
       FROM operations o
      WHERE o.status = 'POSTED'
      ORDER BY o.created_at DESC LIMIT 8`,
  ).map((r) => ({
    id: r.id, docNo: r.doc_no, type: r.type, productName: r.product_name,
    qtyMp: r.qty_mp, qtyTonne: r.qty_tonne, operationDate: r.operation_date,
    counterparty: r.recipient_name || r.supplier_name,
  }));

  const rawMaterialMp = stock.byProduct
    .filter((p) => p.category === 'SUROWIEC')
    .reduce((a, p) => a + p.qtyMp, 0);
  const chipsMp = stock.byProduct
    .filter((p) => p.category === 'ZREBKA')
    .reduce((a, p) => a + p.qtyMp, 0);
  const chipsTonne = stock.byProduct
    .filter((p) => p.category === 'ZREBKA')
    .reduce((a, p) => a + p.qtyTonne, 0);

  return {
    month: m,
    monthLabel: monthLabel(m),
    periodStatus: periodStatus(m),
    stock: {
      totals: stock.totals,
      rawMaterialMp: roundQty(rawMaterialMp),
      rawMaterialM3: roundQty(
        stock.byProduct.filter((p) => p.category === 'SUROWIEC').reduce((a, p) => a + p.qtyM3, 0),
      ),
      chipsMp: roundQty(chipsMp),
      chipsTonne: roundQty(chipsTonne),
      chipsGj: roundQty(
        stock.byProduct.filter((p) => p.category === 'ZREBKA').reduce((a, p) => a + p.energyGj, 0),
      ),
      byProduct: stock.byProduct,
    },
    turnover: {
      documents: turnover.documents,
      purchaseValue: roundMoney(turnover.purchase_value),
      saleValue: roundMoney(turnover.sale_value),
      chippingCost: roundMoney(turnover.chipping_cost),
      transportCost: roundMoney(turnover.transport_cost),
      grossMargin: roundMoney(
        turnover.sale_value - turnover.purchase_value - turnover.chipping_cost - turnover.transport_cost,
      ),
      purchaseMp: roundQty(turnover.purchase_mp),
      saleMp: roundQty(turnover.sale_mp),
      productionMp: roundQty(turnover.production_mp),
      productionTonne: roundQty(turnover.production_t),
    },
    transports: { inbound: transports.inbound, outbound: transports.outbound },
    production: lastProductionDay ? productionDay({ date: lastProductionDay }) : null,
    alerts: buildAlerts(),
    recent,
  };
}

/** Sygnały wymagające reakcji — pokazywane na pulpicie. */
function buildAlerts() {
  const alerts = [];
  for (const n of negativeStock()) {
    alerts.push({
      level: 'warning',
      message: `Stan ujemny: ${n.productName} w ${n.warehouseName} — ${n.qtyMp.toFixed(3)} MP. Sprawdź brakujący dokument przyjęcia.`,
    });
  }
  const missingSignature = db.value(
    "SELECT COUNT(*) FROM operations WHERE status = 'POSTED' AND TRIM(COALESCE(signature,'')) = ''",
  );
  if (missingSignature) {
    alerts.push({ level: 'warning', message: `${missingSignature} dokument(ów) bez podpisu zatwierdzającego.` });
  }
  const openOld = db.get(
    `SELECT o.operation_month AS month FROM operations o
      LEFT JOIN periods p ON p.month = o.operation_month
     WHERE o.status = 'POSTED' AND COALESCE(p.status,'OPEN') = 'OPEN'
       AND o.operation_month < strftime('%Y-%m', 'now', '-1 month')
     ORDER BY o.operation_month LIMIT 1`,
  );
  if (openOld) {
    alerts.push({ level: 'info', message: `Okres ${openOld.month} nadal otwarty — rozważ zamknięcie miesiąca.` });
  }
  return alerts;
}

/* ------------------------ Raport miesięczny --------------------------- */

/**
 * Pełny raport miesięczny: bilans otwarcia, obroty wg typu i produktu,
 * bilans zamknięcia, koszty, najwięksi kontrahenci.
 */
export function monthlyReport(query) {
  const f = validate(query, {
    month: { type: 'month', required: true, label: 'Miesiąc' },
    warehouseId: { type: 'string', max: 40 },
  });
  const from = `${f.month}-01`;
  const to = endOfMonth(f.month);
  const params = { from, to, month: f.month, warehouseId: f.warehouseId ?? null };

  const warehouseFilter = f.warehouseId ? 'AND m.warehouse_id = :warehouseId' : '';

  /* Bilans otwarcia i zamknięcia — z ruchów magazynowych. */
  const opening = db.all(
    `SELECT m.product_id, p.name AS product_name, p.category,
            SUM(m.qty_mp) AS qty_mp, SUM(m.qty_tonne) AS qty_tonne, SUM(m.qty_m3) AS qty_m3
       FROM stock_moves m JOIN products p ON p.id = m.product_id
      WHERE m.move_date < :from ${warehouseFilter}
      GROUP BY m.product_id`,
    params,
  );
  const closing = db.all(
    `SELECT m.product_id, p.name AS product_name, p.category,
            SUM(m.qty_mp) AS qty_mp, SUM(m.qty_tonne) AS qty_tonne, SUM(m.qty_m3) AS qty_m3
       FROM stock_moves m JOIN products p ON p.id = m.product_id
      WHERE m.move_date <= :to ${warehouseFilter}
      GROUP BY m.product_id`,
    params,
  );

  /* Obroty miesiąca w rozbiciu na typ dokumentu i produkt. */
  const turnover = db.all(
    `SELECT o.type, o.product_id, o.product_name, p.category,
            COUNT(*) AS documents,
            SUM(o.qty_mp) AS qty_mp, SUM(o.qty_m3) AS qty_m3,
            SUM(o.qty_tonne) AS qty_tonne, SUM(o.energy_gj) AS energy_gj,
            SUM(o.value_purchase) AS value_purchase, SUM(o.value_sale) AS value_sale,
            SUM(o.chipping_cost) AS chipping_cost, SUM(o.transport_cost) AS transport_cost
       FROM operations o JOIN products p ON p.id = o.product_id
      WHERE o.status = 'POSTED' AND o.operation_month = :month
      GROUP BY o.type, o.product_id
      ORDER BY o.type, o.product_name`,
    params,
  );

  const byProduct = new Map();
  const ensure = (productId, productName, category) => {
    if (!byProduct.has(productId)) {
      byProduct.set(productId, {
        productId, productName, category,
        opening: { qtyMp: 0, qtyTonne: 0, qtyM3: 0 },
        purchase: emptyBucket(), production: emptyBucket(),
        sale: emptyBucket(), consumption: emptyBucket(), transfer: emptyBucket(),
        closing: { qtyMp: 0, qtyTonne: 0, qtyM3: 0 },
      });
    }
    return byProduct.get(productId);
  };

  for (const r of opening) {
    const e = ensure(r.product_id, r.product_name, r.category);
    e.opening = { qtyMp: roundQty(r.qty_mp), qtyTonne: roundQty(r.qty_tonne), qtyM3: roundQty(r.qty_m3) };
  }
  for (const r of closing) {
    const e = ensure(r.product_id, r.product_name, r.category);
    e.closing = { qtyMp: roundQty(r.qty_mp), qtyTonne: roundQty(r.qty_tonne), qtyM3: roundQty(r.qty_m3) };
  }
  const bucketByType = {
    ZAKUP: 'purchase', PRODUKCJA: 'production', SPRZEDAZ: 'sale',
    ZUZYCIE: 'consumption', MM: 'transfer', BO: 'purchase',
  };
  for (const r of turnover) {
    const e = ensure(r.product_id, r.product_name, r.category);
    e[bucketByType[r.type]] = {
      documents: r.documents,
      qtyMp: roundQty(r.qty_mp),
      qtyM3: roundQty(r.qty_m3),
      qtyTonne: roundQty(r.qty_tonne),
      energyGj: roundQty(r.energy_gj),
      valuePurchase: roundMoney(r.value_purchase),
      valueSale: roundMoney(r.value_sale),
    };
  }

  const costs = db.get(
    `SELECT COALESCE(SUM(value_purchase), 0)  AS purchase,
            COALESCE(SUM(value_sale), 0)      AS sale,
            COALESCE(SUM(chipping_cost), 0)   AS chipping,
            COALESCE(SUM(transport_cost), 0)  AS transport,
            COALESCE(SUM(distance_km), 0)     AS km,
            COUNT(*)                          AS documents
       FROM operations WHERE status = 'POSTED' AND operation_month = :month`,
    params,
  );

  const suppliers = db.all(
    `SELECT COALESCE(supplier_name, '—') AS name, COUNT(*) AS documents,
            SUM(qty_mp) AS qty_mp, SUM(value_purchase) AS value
       FROM operations
      WHERE status = 'POSTED' AND operation_month = :month AND type IN ('ZAKUP','BO')
      GROUP BY supplier_name ORDER BY value DESC LIMIT 20`,
    params,
  ).map(mapPartnerRow);

  const recipients = db.all(
    `SELECT COALESCE(recipient_name, '—') AS name, COUNT(*) AS documents,
            SUM(qty_mp) AS qty_mp, SUM(value_sale) AS value
       FROM operations
      WHERE status = 'POSTED' AND operation_month = :month AND type = 'SPRZEDAZ'
      GROUP BY recipient_name ORDER BY value DESC LIMIT 20`,
    params,
  ).map(mapPartnerRow);

  const corrections = db.value(
    `SELECT COUNT(*) FROM corrections c JOIN operations o ON o.id = c.operation_id
      WHERE o.operation_month = :month`,
    params,
  );
  const cancelled = db.value(
    "SELECT COUNT(*) FROM operations WHERE status = 'CANCELLED' AND operation_month = :month",
    params,
  );

  const purchaseValue = roundMoney(costs.purchase);
  const saleValue = roundMoney(costs.sale);
  const chippingCost = roundMoney(costs.chipping);
  const transportCost = roundMoney(costs.transport);

  return {
    month: f.month,
    monthLabel: monthLabel(f.month),
    range: { from, to },
    status: periodStatus(f.month),
    generatedAt: new Date().toISOString(),
    products: [...byProduct.values()].sort((a, b) => a.productName.localeCompare(b.productName, 'pl')),
    summary: {
      documents: costs.documents,
      purchaseValue,
      saleValue,
      chippingCost,
      transportCost,
      totalCost: roundMoney(purchaseValue + chippingCost + transportCost),
      grossMargin: roundMoney(saleValue - purchaseValue - chippingCost - transportCost),
      distanceKm: roundQty(costs.km),
      corrections,
      cancelled,
    },
    suppliers,
    recipients,
  };
}

const emptyBucket = () => ({
  documents: 0, qtyMp: 0, qtyM3: 0, qtyTonne: 0, energyGj: 0, valuePurchase: 0, valueSale: 0,
});

const mapPartnerRow = (r) => ({
  name: r.name,
  documents: r.documents,
  qtyMp: roundQty(r.qty_mp),
  value: roundMoney(r.value),
});

/* --------------------- Kwit produkcji dnia ---------------------------- */

/**
 * Raport dzienny produkcji: co zużyto, co wyprodukowano, skąd pochodził surowiec
 * i jakie dokumenty wywozowe temu towarzyszyły.
 */
export function productionDay(query) {
  const f = validate(query, { date: { type: 'date', required: true, label: 'Data' } });
  const params = { date: f.date };

  const production = db.all(
    `SELECT * FROM operations
      WHERE status = 'POSTED' AND type = 'PRODUKCJA' AND operation_date = :date
      ORDER BY doc_no`,
    params,
  );
  const consumption = db.all(
    `SELECT * FROM operations
      WHERE status = 'POSTED' AND type = 'ZUZYCIE' AND operation_date = :date
      ORDER BY doc_no`,
    params,
  );
  const dispatch = db.all(
    `SELECT * FROM operations
      WHERE status = 'POSTED' AND type = 'SPRZEDAZ' AND operation_date = :date
      ORDER BY doc_no`,
    params,
  );

  const byProduct = new Map();
  for (const r of production) {
    const acc = byProduct.get(r.product_id) || {
      productId: r.product_id, productName: r.product_name,
      documents: 0, qtyMp: 0, qtyM3: 0, qtyTonne: 0, energyGj: 0, sources: new Set(),
    };
    acc.documents += 1;
    acc.qtyMp = roundQty(acc.qtyMp + r.qty_mp);
    acc.qtyM3 = roundQty(acc.qtyM3 + r.qty_m3);
    acc.qtyTonne = roundQty(acc.qtyTonne + r.qty_tonne);
    acc.energyGj = roundQty(acc.energyGj + r.energy_gj);
    const source = forestLabel(r);
    if (source) acc.sources.add(source);
    byProduct.set(r.product_id, acc);
  }

  const totals = production.reduce(
    (a, r) => ({
      qtyMp: roundQty(a.qtyMp + r.qty_mp),
      qtyM3: roundQty(a.qtyM3 + r.qty_m3),
      qtyTonne: roundQty(a.qtyTonne + r.qty_tonne),
      energyGj: roundQty(a.energyGj + r.energy_gj),
      chippingCost: roundMoney(a.chippingCost + r.chipping_cost),
    }),
    { qtyMp: 0, qtyM3: 0, qtyTonne: 0, energyGj: 0, chippingCost: 0 },
  );

  const consumedMp = roundQty(consumption.reduce((a, r) => a + r.qty_mp, 0));
  // Uzysk: ile MP zrębki powstało z 1 MP surowca (kontrola wydajności rębaka).
  const yieldRatio = consumedMp > 0 ? roundQty(totals.qtyMp / consumedMp) : null;

  return {
    date: f.date,
    documents: production.map((r) => r.doc_no),
    totals,
    yieldRatio,
    byProduct: [...byProduct.values()].map((p) => ({ ...p, sources: [...p.sources] })),
    consumption: consumption.map((r) => ({
      docNo: r.doc_no,
      productName: r.product_name,
      qtyMp: r.qty_mp,
      qtyM3: r.qty_m3,
      qtyTonne: r.qty_tonne,
      source: forestLabel(r) || r.origin_place || r.loading_place || '',
    })),
    dispatch: dispatch.map((r) => ({
      docNo: r.doc_no,
      productName: r.product_name,
      recipient: r.recipient_name,
      qtyMp: r.qty_mp,
      qtyTonne: r.qty_tonne,
      value: r.value_sale,
      vehiclePlate: r.vehicle_plate,
    })),
    haulageNotes: [...new Set(
      [...production, ...consumption, ...dispatch].map((r) => r.haulage_note_no).filter(Boolean),
    )],
    forests: [...new Set(production.map(forestLabel).filter(Boolean))],
    count: production.length,
  };
}

const forestLabel = (r) => {
  const parts = [];
  if (r.forest_district) parts.push(`NDL ${r.forest_district}`);
  if (r.forest_range) parts.push(r.forest_range);
  return parts.join(', ');
};

/** Dni z zaksięgowaną produkcją (nawigacja w widoku produkcji). */
export function productionDays(limit = 60) {
  return db.all(
    `SELECT operation_date AS date, COUNT(*) AS documents, ROUND(SUM(qty_mp), 3) AS qty_mp
       FROM operations WHERE status = 'POSTED' AND type = 'PRODUKCJA'
      GROUP BY operation_date ORDER BY operation_date DESC LIMIT :limit`,
    { limit: Math.min(Number(limit) || 60, 365) },
  ).map((r) => ({ date: r.date, documents: r.documents, qtyMp: r.qty_mp }));
}

/* --------------------------- Transport -------------------------------- */

/** Zestawienie kosztów transportu wg przewoźnika i pojazdu. */
export function transportReport(query) {
  const f = validate(query, {
    dateFrom: { type: 'date', required: true, label: 'Data od' },
    dateTo: { type: 'date', required: true, label: 'Data do' },
  });

  const rows = db.all(
    `SELECT COALESCE(NULLIF(TRIM(carrier_name), ''), '—') AS carrier,
            COALESCE(NULLIF(TRIM(vehicle_plate), ''), '—') AS plate,
            COUNT(*) AS trips,
            SUM(distance_km)    AS km,
            SUM(transport_cost) AS cost,
            SUM(qty_tonne)      AS tonnes,
            SUM(qty_mp)         AS qty_mp
       FROM operations
      WHERE status = 'POSTED' AND operation_date BETWEEN :dateFrom AND :dateTo
        AND (transport_cost > 0 OR distance_km > 0 OR TRIM(COALESCE(carrier_name,'')) <> '')
      GROUP BY carrier, plate
      ORDER BY cost DESC`,
    f,
  );

  const items = rows.map((r) => ({
    carrier: r.carrier,
    plate: r.plate,
    trips: r.trips,
    distanceKm: roundQty(r.km),
    cost: roundMoney(r.cost),
    tonnes: roundQty(r.tonnes),
    qtyMp: roundQty(r.qty_mp),
    costPerKm: r.km > 0 ? roundMoney(r.cost / r.km) : null,
    costPerTonne: r.tonnes > 0 ? roundMoney(r.cost / r.tonnes) : null,
  }));

  const totals = items.reduce(
    (a, r) => ({
      trips: a.trips + r.trips,
      distanceKm: roundQty(a.distanceKm + r.distanceKm),
      cost: roundMoney(a.cost + r.cost),
      tonnes: roundQty(a.tonnes + r.tonnes),
    }),
    { trips: 0, distanceKm: 0, cost: 0, tonnes: 0 },
  );
  totals.costPerKm = totals.distanceKm > 0 ? roundMoney(totals.cost / totals.distanceKm) : null;
  totals.costPerTonne = totals.tonnes > 0 ? roundMoney(totals.cost / totals.tonnes) : null;

  return { range: { from: f.dateFrom, to: f.dateTo }, items, totals };
}

/* -------------------------- Kontrahenci ------------------------------- */

/** Obroty w podziale na kontrahentów (zakup i sprzedaż w jednym zestawieniu). */
export function partnerReport(query) {
  const f = validate(query, {
    dateFrom: { type: 'date', required: true, label: 'Data od' },
    dateTo: { type: 'date', required: true, label: 'Data do' },
  });

  const rows = db.all(
    `SELECT name, SUM(purchase_value) AS purchase_value, SUM(sale_value) AS sale_value,
            SUM(purchase_mp) AS purchase_mp, SUM(sale_mp) AS sale_mp, SUM(documents) AS documents
       FROM (
         SELECT COALESCE(NULLIF(TRIM(supplier_name), ''), '—') AS name,
                value_purchase AS purchase_value, 0 AS sale_value,
                qty_mp AS purchase_mp, 0 AS sale_mp, 1 AS documents
           FROM operations
          WHERE status = 'POSTED' AND type IN ('ZAKUP','BO')
            AND operation_date BETWEEN :dateFrom AND :dateTo
         UNION ALL
         SELECT COALESCE(NULLIF(TRIM(recipient_name), ''), '—'),
                0, value_sale, 0, qty_mp, 1
           FROM operations
          WHERE status = 'POSTED' AND type = 'SPRZEDAZ'
            AND operation_date BETWEEN :dateFrom AND :dateTo
       )
      GROUP BY name
      ORDER BY (SUM(purchase_value) + SUM(sale_value)) DESC`,
    f,
  );

  return {
    range: { from: f.dateFrom, to: f.dateTo },
    items: rows.map((r) => ({
      name: r.name,
      documents: r.documents,
      purchaseValue: roundMoney(r.purchase_value),
      saleValue: roundMoney(r.sale_value),
      purchaseMp: roundQty(r.purchase_mp),
      saleMp: roundQty(r.sale_mp),
      turnover: roundMoney(r.purchase_value + r.sale_value),
    })),
  };
}

/* ------------------------- Certyfikacja ------------------------------- */

/**
 * Zestawienie pochodzenia surowca — wymagane przy audycie KZR INiG / SURE.
 * Pokazuje, z jakich nadleśnictw pochodził surowiec i jakie kwity wywozowe
 * towarzyszyły dostawom.
 */
export function certificationReport(query) {
  const f = validate(query, {
    dateFrom: { type: 'date', required: true, label: 'Data od' },
    dateTo: { type: 'date', required: true, label: 'Data do' },
  });

  const origins = db.all(
    `SELECT COALESCE(NULLIF(TRIM(forest_district), ''), '(brak wskazania)') AS district,
            COALESCE(NULLIF(TRIM(forest_range), ''), '—')                   AS range_name,
            certificate,
            COUNT(*) AS documents,
            SUM(qty_m3) AS qty_m3, SUM(qty_mp) AS qty_mp, SUM(qty_tonne) AS qty_tonne
       FROM operations
      WHERE status = 'POSTED' AND type IN ('ZAKUP','BO')
        AND operation_date BETWEEN :dateFrom AND :dateTo
      GROUP BY district, range_name, certificate
      ORDER BY district, range_name`,
    f,
  );

  const missing = db.all(
    `SELECT id, doc_no, operation_date, product_name, supplier_name
       FROM operations
      WHERE status = 'POSTED' AND type IN ('ZAKUP','BO')
        AND operation_date BETWEEN :dateFrom AND :dateTo
        AND (TRIM(COALESCE(forest_district,'')) = '' OR TRIM(COALESCE(haulage_note_no,'')) = '')
      ORDER BY operation_date DESC LIMIT 200`,
    f,
  ).map((r) => ({
    id: r.id, docNo: r.doc_no, date: r.operation_date,
    productName: r.product_name, supplier: r.supplier_name,
  }));

  return {
    range: { from: f.dateFrom, to: f.dateTo },
    origins: origins.map((r) => ({
      district: r.district,
      range: r.range_name,
      certificate: r.certificate,
      documents: r.documents,
      qtyM3: roundQty(r.qty_m3),
      qtyMp: roundQty(r.qty_mp),
      qtyTonne: roundQty(r.qty_tonne),
    })),
    incomplete: missing,
  };
}

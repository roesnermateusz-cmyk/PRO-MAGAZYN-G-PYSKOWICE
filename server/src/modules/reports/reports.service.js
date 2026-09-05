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
import { cache, keyFor, TAG } from '../../lib/cache.js';

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

/* --------------------- Szereg czasowy i bilans miesiąca ---------------- */

/** Miesiąc przesunięty o `back` miesięcy wstecz, w formacie RRRR-MM. */
function shiftMonth(month, back) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - back, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Lista `count` kolejnych miesięcy kończąca się na `month`. */
function monthWindow(month, count) {
  return Array.from({ length: count }, (_, i) => shiftMonth(month, count - 1 - i));
}

/**
 * Szereg 12 miesięcy: obroty ilościowe i wartościowe oraz stan końcowy.
 *
 * Stan końcowy liczony jest narastająco: bilans otwarcia okna (suma ruchów
 * sprzed pierwszego miesiąca) plus kolejne salda miesięczne. Dzięki temu
 * wykres stanu magazynu zgadza się co do jednostki z kartoteką magazynową,
 * bez osobnego zapytania na każdy miesiąc.
 *
 * @param {string} month ostatni miesiąc okna (RRRR-MM)
 * @param {number} [count] długość okna w miesiącach
 */
function buildTrend(month, count = 12) {
  // Okno przycinane do pierwszego miesiąca z dokumentami. Firma, która ruszyła
  // pół roku temu, nie ma po co oglądać sześciu pustych słupków — a wykres
  // rozciągnięty na puste miesiące spłaszcza to, co faktycznie się wydarzyło.
  const firstDoc = db.value("SELECT MIN(operation_month) FROM operations WHERE status = 'POSTED'");
  let months = monthWindow(month, count);
  if (firstDoc && firstDoc > months[0]) {
    const trimmed = months.filter((mm) => mm >= firstDoc);
    if (trimmed.length >= 2) months = trimmed;
  }
  const from = `${months[0]}-01`;
  const to = endOfMonth(month);

  const rows = db.all(
    `SELECT o.operation_month AS month,
            COUNT(*)                                                              AS documents,
            COALESCE(SUM(CASE WHEN o.type = 'ZAKUP'     THEN o.qty_mp END), 0)    AS purchase_mp,
            COALESCE(SUM(CASE WHEN o.type = 'PRODUKCJA' THEN o.qty_mp END), 0)    AS production_mp,
            COALESCE(SUM(CASE WHEN o.type = 'SPRZEDAZ'  THEN o.qty_mp END), 0)    AS sale_mp,
            COALESCE(SUM(CASE WHEN o.type = 'ZUZYCIE'   THEN o.qty_mp END), 0)    AS consumption_mp,
            COALESCE(SUM(CASE WHEN o.type = 'ZAKUP'    THEN o.value_purchase END), 0) AS purchase_value,
            COALESCE(SUM(CASE WHEN o.type = 'SPRZEDAZ' THEN o.value_sale END), 0)     AS sale_value,
            COALESCE(SUM(o.chipping_cost), 0)                                     AS chipping_cost,
            COALESCE(SUM(o.transport_cost), 0)                                    AS transport_cost
       FROM operations o
      WHERE o.status = 'POSTED' AND o.operation_month BETWEEN :fromMonth AND :toMonth
      GROUP BY o.operation_month`,
    { fromMonth: months[0], toMonth: month },
  );
  const byMonth = new Map(rows.map((r) => [r.month, r]));

  // Saldo ruchów w każdym miesiącu okna oraz bilans otwarcia całego okna.
  const netRows = db.all(
    `SELECT strftime('%Y-%m', m.move_date) AS month, SUM(m.qty_mp) AS net_mp
       FROM stock_moves m
      WHERE m.move_date BETWEEN :from AND :to
      GROUP BY 1`,
    { from, to },
  );
  const netByMonth = new Map(netRows.map((r) => [r.month, r.net_mp]));
  let running = db.value(
    'SELECT COALESCE(SUM(qty_mp), 0) FROM stock_moves WHERE move_date < :from',
    { from },
  ) ?? 0;

  return months.map((mm) => {
    const r = byMonth.get(mm);
    running += netByMonth.get(mm) ?? 0;
    const purchaseValue = roundMoney(r?.purchase_value ?? 0);
    const saleValue = roundMoney(r?.sale_value ?? 0);
    const chippingCost = roundMoney(r?.chipping_cost ?? 0);
    const transportCost = roundMoney(r?.transport_cost ?? 0);
    return {
      month: mm,
      label: monthLabel(mm),
      short: `${mm.slice(5)}.${mm.slice(2, 4)}`,
      documents: r?.documents ?? 0,
      purchaseMp: roundQty(r?.purchase_mp ?? 0),
      productionMp: roundQty(r?.production_mp ?? 0),
      saleMp: roundQty(r?.sale_mp ?? 0),
      consumptionMp: roundQty(r?.consumption_mp ?? 0),
      purchaseValue,
      saleValue,
      chippingCost,
      transportCost,
      grossMargin: roundMoney(saleValue - purchaseValue - chippingCost - transportCost),
      closingMp: roundQty(running),
    };
  });
}

/**
 * Bilans miesiąca w MP — od stanu otwarcia do stanu zamknięcia.
 *
 * Ostatnia pozycja („korekty i przesunięcia”) to reszta domykająca równanie.
 * Nie jest ozdobnikiem: mieszczą się w niej storna, przesunięcia międzymagazynowe
 * zaksięgowane tylko po jednej stronie oraz dokumenty BO wprowadzone w trakcie
 * miesiąca. Bez niej wykres pokazywałby stan zamknięcia, którego nie da się
 * wyprowadzić z widocznych słupków — a taki wykres kłamie.
 */
function buildBalance(month) {
  const from = `${month}-01`;
  const to = endOfMonth(month);
  const opening = db.value(
    'SELECT COALESCE(SUM(qty_mp), 0) FROM stock_moves WHERE move_date < :from', { from },
  ) ?? 0;
  const closing = db.value(
    'SELECT COALESCE(SUM(qty_mp), 0) FROM stock_moves WHERE move_date <= :to', { to },
  ) ?? 0;
  const t = db.get(
    `SELECT COALESCE(SUM(CASE WHEN type = 'ZAKUP'     THEN qty_mp END), 0) AS purchase,
            COALESCE(SUM(CASE WHEN type = 'PRODUKCJA' THEN qty_mp END), 0) AS production,
            COALESCE(SUM(CASE WHEN type = 'ZUZYCIE'   THEN qty_mp END), 0) AS consumption,
            COALESCE(SUM(CASE WHEN type = 'SPRZEDAZ'  THEN qty_mp END), 0) AS sale
       FROM operations
      WHERE status = 'POSTED' AND operation_month = :month`,
    { month },
  );
  const steps = [
    { key: 'purchase', label: 'Zakup', delta: roundQty(t.purchase) },
    { key: 'production', label: 'Produkcja', delta: roundQty(t.production) },
    { key: 'consumption', label: 'Zużycie', delta: roundQty(-t.consumption) },
    { key: 'sale', label: 'Sprzedaż', delta: roundQty(-t.sale) },
  ];
  const explained = steps.reduce((a, s) => a + s.delta, 0);
  const residual = roundQty(closing - opening - explained);
  if (Math.abs(residual) >= 0.001) {
    steps.push({ key: 'other', label: 'Korekty i przesunięcia', delta: residual });
  }
  return {
    opening: roundQty(opening),
    closing: roundQty(closing),
    steps,
  };
}

/* ----------------------------- Pulpit -------------------------------- */

/** Zestaw wskaźników dla ekranu głównego. */
function computeDashboard({ month, months } = {}) {
  const m = /^\d{4}-\d{2}$/.test(month || '') ? month : currentMonth();
  const window = Math.min(36, Math.max(3, Number.parseInt(months, 10) || 12));
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
    trendMonths: window,
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
    trend: buildTrend(m, window),
    balance: buildBalance(m),
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
function computeMonthlyReport(query) {
  const f = validate(query, {
    month: { type: 'month', required: true, label: 'Miesiąc' },
    warehouseId: { type: 'string', max: 40 },
  });
  const from = `${f.month}-01`;
  const to = endOfMonth(f.month);
  const params = { from, to, month: f.month, warehouseId: f.warehouseId ?? null };

  // Filtr magazynu musi obowiązywać we WSZYSTKICH członach raportu. Wcześniej
  // zawężał tylko bilans otwarcia i zamknięcia (liczone z ruchów), a obroty
  // i koszty szły po całej firmie — bilans produktu wtedy się nie domykał.
  const moveFilter = f.warehouseId ? 'AND m.warehouse_id = :warehouseId' : '';
  const docFilter = f.warehouseId
    ? 'AND (o.warehouse_from_id = :warehouseId OR o.warehouse_to_id = :warehouseId)'
    : '';

  /* Bilans otwarcia i zamknięcia — z ruchów magazynowych. */
  const opening = db.all(
    `SELECT m.product_id, p.name AS product_name, p.category,
            SUM(m.qty_mp) AS qty_mp, SUM(m.qty_tonne) AS qty_tonne, SUM(m.qty_m3) AS qty_m3
       FROM stock_moves m JOIN products p ON p.id = m.product_id
      WHERE m.move_date < :from ${moveFilter}
      GROUP BY m.product_id`,
    params,
  );
  const closing = db.all(
    `SELECT m.product_id, p.name AS product_name, p.category,
            SUM(m.qty_mp) AS qty_mp, SUM(m.qty_tonne) AS qty_tonne, SUM(m.qty_m3) AS qty_m3
       FROM stock_moves m JOIN products p ON p.id = m.product_id
      WHERE m.move_date <= :to ${moveFilter}
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
      WHERE o.status = 'POSTED' AND o.operation_month = :month ${docFilter}
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
    `SELECT COALESCE(SUM(o.value_purchase), 0)  AS purchase,
            COALESCE(SUM(o.value_sale), 0)      AS sale,
            COALESCE(SUM(o.chipping_cost), 0)   AS chipping,
            COALESCE(SUM(o.transport_cost), 0)  AS transport,
            COALESCE(SUM(o.distance_km), 0)     AS km,
            COUNT(*)                          AS documents
       FROM operations o
      WHERE o.status = 'POSTED' AND o.operation_month = :month ${docFilter}`,
    params,
  );

  const suppliers = db.all(
    `SELECT COALESCE(o.supplier_name, '—') AS name, COUNT(*) AS documents,
            SUM(o.qty_mp) AS qty_mp, SUM(o.value_purchase) AS value
       FROM operations o
      WHERE o.status = 'POSTED' AND o.operation_month = :month
        AND o.type IN ('ZAKUP','BO') ${docFilter}
      GROUP BY o.supplier_name ORDER BY value DESC LIMIT 20`,
    params,
  ).map(mapPartnerRow);

  const recipients = db.all(
    `SELECT COALESCE(o.recipient_name, '—') AS name, COUNT(*) AS documents,
            SUM(o.qty_mp) AS qty_mp, SUM(o.value_sale) AS value
       FROM operations o
      WHERE o.status = 'POSTED' AND o.operation_month = :month
        AND o.type = 'SPRZEDAZ' ${docFilter}
      GROUP BY o.recipient_name ORDER BY value DESC LIMIT 20`,
    params,
  ).map(mapPartnerRow);

  const corrections = db.value(
    `SELECT COUNT(*) FROM corrections c JOIN operations o ON o.id = c.operation_id
      WHERE o.operation_month = :month ${docFilter}`,
    params,
  );
  const cancelled = db.value(
    `SELECT COUNT(*) FROM operations o
      WHERE o.status = 'CANCELLED' AND o.operation_month = :month ${docFilter}`,
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
function computeProductionDay(query) {
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
function computeProductionDays(limit = 60) {
  return db.all(
    `SELECT operation_date AS date, COUNT(*) AS documents, ROUND(SUM(qty_mp), 3) AS qty_mp
       FROM operations WHERE status = 'POSTED' AND type = 'PRODUKCJA'
      GROUP BY operation_date ORDER BY operation_date DESC LIMIT :limit`,
    { limit: Math.min(Number(limit) || 60, 365) },
  ).map((r) => ({ date: r.date, documents: r.documents, qtyMp: r.qty_mp }));
}

/* --------------------------- Transport -------------------------------- */

/** Zestawienie kosztów transportu wg przewoźnika i pojazdu. */
function computeTransportReport(query) {
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
function computePartnerReport(query) {
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
function computeCertificationReport(query) {
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

/* ======================================================================
   Buforowanie odczytów

   Raport jest funkcją danych, nie użytkownika — ten sam miesiąc daje ten sam
   wynik każdemu, kto ma prawo go zobaczyć. Dlatego wolno go policzyć raz
   i podać pozostałym; kontrola uprawnień zostaje w warstwie tras i dzieje się
   PRZED sięgnięciem do pamięci podręcznej.

   Tagi opisują, od czego wynik zależy. Zapis dokumentu podbija `stock`,
   `documents`, tag swojego miesiąca i tag swojego magazynu — wpisy oznaczone
   którymkolwiek z nich odpadają natychmiast, reszta zostaje. Dzięki temu
   zaksięgowanie dokumentu we wrześniu nie unieważnia raportu za marzec.
   ====================================================================== */

/**
 * Opakowuje odczyt raportu pamięcią podręczną.
 * @param {string} name nazwa odczytu (część klucza)
 * @param {(query:object) => string[]} tagsOf tagi wyliczone z parametrów
 * @param {Function} compute właściwa implementacja
 */
function cached(name, tagsOf, compute) {
  return (query = {}, ...rest) => cache.wrap(
    keyFor(name, typeof query === 'object' ? query : { value: query }),
    { tags: tagsOf(query) },
    () => compute(query, ...rest),
  );
}

/** Wspólny zestaw dla raportów liczonych z ruchów i dokumentów. */
const LEDGER_TAGS = [TAG.STOCK, TAG.DOCUMENTS, TAG.PERIODS, TAG.SETTINGS, TAG.catalog('products')];

export const dashboard = cached(
  'reports.dashboard',
  (q) => [...LEDGER_TAGS, TAG.month(q?.month), TAG.warehouse(null)],
  computeDashboard,
);

/**
 * Tagi raportu miesięcznego zależą od tego, czy miesiąc jest zamknięty.
 *
 * Miesiąc OTWARTY zmienia każdy zapis — dokument może trafić w niego wprost
 * albo przed niego i przesunąć bilans otwarcia. Pełny zestaw tagów.
 *
 * Miesiąc ZAMKNIĘTY jest zapieczętowany: nie da się do niego nic dopisać.
 * Zmienić go może wyłącznie otwarcie okresu (`periods`), zmiana nazw
 * w kartotekach (`catalog`) albo księgowanie wstecz w jakimś wcześniejszym
 * miesiącu, który nigdy nie został zamknięty (`history`). Zwykłe księgowanie
 * dnia dzisiejszego go nie dotyczy — i nie ma powodu, żeby raport sprzed
 * czterech lat przeliczał się przy każdym przyjęciu zrębki.
 */
function monthlyTags(q) {
  const month = q?.month;
  if (month && periodStatus(month) === 'CLOSED') {
    // Bez tagów magazynu i bez `stock`/`documents`: żaden zapis nie wejdzie
    // do zamkniętego okresu, więc jedyne realne źródła zmiany to otwarcie
    // okresu, zmiana nazw produktów i księgowanie wstecz (`history`).
    return [TAG.PERIODS, TAG.SETTINGS, TAG.catalog('products'), TAG.HISTORY, TAG.month(month)];
  }
  return [...LEDGER_TAGS, TAG.month(month), TAG.warehouse(q?.warehouseId)];
}

export const monthlyReport = cached('reports.monthly', monthlyTags, computeMonthlyReport);

export const productionDay = cached(
  'reports.productionDay',
  (q) => [...LEDGER_TAGS, TAG.month(String(q?.date ?? '').slice(0, 7)), TAG.warehouse(null)],
  computeProductionDay,
);

export const productionDays = cached(
  'reports.productionDays',
  () => [TAG.DOCUMENTS, TAG.warehouse(null)],
  computeProductionDays,
);

// Raporty okresowe obejmują dowolny zakres dat, więc nie da się zawęzić ich
// do jednego miesiąca — unieważnia je każdy zapis dokumentu.
const RANGE_TAGS = [TAG.DOCUMENTS, TAG.CATALOG, TAG.warehouse(null)];

export const transportReport = cached('reports.transport', () => RANGE_TAGS, computeTransportReport);
export const partnerReport = cached('reports.partners', () => RANGE_TAGS, computePartnerReport);
export const certificationReport = cached('reports.certification', () => RANGE_TAGS, computeCertificationReport);

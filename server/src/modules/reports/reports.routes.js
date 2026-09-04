/** Trasy raportów i stanów magazynowych: /api/v1/{reports,stock,corrections} */
import { Router } from '../../lib/http.js';
import { guard } from '../../middleware/auth.js';
import { audit } from '../../middleware/audit.js';
import { toCsv } from '../../lib/csv.js';
import * as reports from './reports.service.js';
import { currentStock, stockLedger, negativeStock } from '../stock/stock.service.js';
import { listCorrections, getCorrection } from '../corrections/corrections.service.js';
import { restoreCorrection } from '../operations/operations.service.js';

/** Odpowiedź CSV z nagłówkiem pobierania. */
function sendCsv(ctx, filename, columns, rows) {
  const csv = toCsv(columns, rows);
  ctx.send(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': Buffer.byteLength(csv),
  }, csv);
}

export function reportRoutes(prefix) {
  const r = new Router(prefix);

  /* --- Stany magazynowe --- */
  r.get('/stock', ...guard('stock:read'), (ctx) => currentStock(ctx.query));
  r.get('/stock/ledger', ...guard('stock:read'), (ctx) => stockLedger(ctx.query));
  r.get('/stock/negative', ...guard('stock:read'), () => ({ items: negativeStock() }));
  r.get('/stock/export.csv', ...guard('stock:read'), (ctx) => {
    const { items } = currentStock(ctx.query);
    sendCsv(ctx, `stany-magazynowe-${new Date().toISOString().slice(0, 10)}.csv`, [
      { key: 'warehouseName', label: 'Magazyn' },
      { key: 'productName', label: 'Produkt' },
      { key: 'category', label: 'Kategoria' },
      { key: 'qtyMp', label: 'MP' },
      { key: 'qtyM3', label: 'm3' },
      { key: 'qtyTonne', label: 'Tony' },
      { key: 'energyGj', label: 'GJ' },
      { key: 'lastMoveDate', label: 'Ostatni ruch' },
    ], items);
  });

  /* --- Raporty --- */
  r.get('/reports/dashboard', ...guard('reports:read'), (ctx) => reports.dashboard(ctx.query));
  r.get('/reports/monthly', ...guard('reports:read'), (ctx) => reports.monthlyReport(ctx.query));
  r.get('/reports/production-days', ...guard('reports:read'),
    (ctx) => ({ items: reports.productionDays(ctx.query.limit) }));
  r.get('/reports/production-day', ...guard('reports:read'), (ctx) => reports.productionDay(ctx.query));
  r.get('/reports/transport', ...guard('reports:read'), (ctx) => reports.transportReport(ctx.query));
  r.get('/reports/partners', ...guard('reports:read'), (ctx) => reports.partnerReport(ctx.query));
  r.get('/reports/certification', ...guard('reports:read'), (ctx) => reports.certificationReport(ctx.query));

  r.get('/reports/monthly/export.csv', ...guard('reports:read'), (ctx) => {
    const report = reports.monthlyReport(ctx.query);
    audit(ctx, 'EXPORT_CSV', 'reports', report.month);
    const rows = report.products.map((p) => ({
      product: p.productName,
      category: p.category,
      openingMp: p.opening.qtyMp,
      purchaseMp: p.purchase.qtyMp,
      productionMp: p.production.qtyMp,
      saleMp: p.sale.qtyMp,
      consumptionMp: p.consumption.qtyMp,
      closingMp: p.closing.qtyMp,
      purchaseValue: p.purchase.valuePurchase,
      saleValue: p.sale.valueSale,
    }));
    sendCsv(ctx, `raport-miesieczny-${report.month}.csv`, [
      { key: 'product', label: 'Produkt' },
      { key: 'category', label: 'Kategoria' },
      { key: 'openingMp', label: 'BO [MP]' },
      { key: 'purchaseMp', label: 'Zakup [MP]' },
      { key: 'productionMp', label: 'Produkcja [MP]' },
      { key: 'consumptionMp', label: 'Zużycie [MP]' },
      { key: 'saleMp', label: 'Sprzedaż [MP]' },
      { key: 'closingMp', label: 'BZ [MP]' },
      { key: 'purchaseValue', label: 'Wartość zakupu' },
      { key: 'saleValue', label: 'Wartość sprzedaży' },
    ], rows);
  });

  /* --- Korekty --- */
  r.get('/corrections', ...guard('corrections:read'), (ctx) => listCorrections(ctx.query));
  r.get('/corrections/:id', ...guard('corrections:read'), (ctx) => getCorrection(ctx.params.id));
  r.post('/corrections/:id/restore', ...guard('operations:write'),
    (ctx) => restoreCorrection(ctx.params.id, ctx));

  return r;
}

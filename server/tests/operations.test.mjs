/** Testy integracyjne warstwy dokumentów: księgowanie, korekty, storno, okresy. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareEnv, cleanupEnv, testContext, operationInput } from './helpers.mjs';

prepareEnv('operations');

const { default: db } = await import('../src/db/index.js');
const { bootstrap } = await import('../src/bootstrap.js');
const ops = await import('../src/modules/operations/operations.service.js');
const { createChain } = await import('../src/modules/operations/chain.service.js');
const { closePeriod, reopenPeriod, periodStatus } = await import('../src/modules/periods/periods.service.js');
const { currentStock, stockLedger } = await import('../src/modules/stock/stock.service.js');
const { monthlyReport, productionDay } = await import('../src/modules/reports/reports.service.js');
const { listCorrections } = await import('../src/modules/corrections/corrections.service.js');
const { updateSettings, invalidateSettingsCache } = await import('../src/modules/settings/settings.service.js');

bootstrap();
const admin = db.get("SELECT id, email, full_name FROM users WHERE role = 'ADMIN' LIMIT 1");
const ctx = testContext({ userId: admin.id });

const stockOf = (productName) => {
  const row = db.get(
    `SELECT COALESCE(SUM(m.qty_mp), 0) AS mp FROM stock_moves m
       JOIN products p ON p.id = m.product_id WHERE p.name = :name`,
    { name: productName },
  );
  return row.mp;
};

test.after(cleanupEnv);

test('księgowanie dokumentu nadaje numer i przelicza jednostki', () => {
  const { operation } = ops.createOperation(operationInput(), ctx);
  assert.match(operation.docNo, /^PZ\/2026\/\d{6}$/);
  assert.equal(operation.type, 'ZAKUP');
  assert.equal(operation.qtyMp, 400);
  assert.equal(operation.qtyTonne, 132);
  assert.equal(operation.valuePurchase, 9000);
  assert.equal(operation.status, 'POSTED');
  assert.equal(operation.createdBy, admin.full_name);
});

test('numeracja jest ciągła i unikalna w obrębie serii', () => {
  const a = ops.createOperation(operationInput({ quantity: 10 }), ctx).operation;
  const b = ops.createOperation(operationInput({ quantity: 12 }), ctx).operation;
  const numA = Number(a.docNo.split('/')[2]);
  const numB = Number(b.docNo.split('/')[2]);
  assert.equal(numB, numA + 1);
  assert.notEqual(a.docNo, b.docNo);
});

test('dokument tworzy dokładnie jeden ruch magazynowy', () => {
  const { operation } = ops.createOperation(operationInput({ quantity: 25 }), ctx);
  const moves = db.all('SELECT * FROM stock_moves WHERE operation_id = :id', { id: operation.id });
  assert.equal(moves.length, 1);
  assert.equal(moves[0].direction, 1);
  assert.equal(moves[0].qty_mp, 100);
});

test('stan magazynowy to suma ruchów', () => {
  const before = stockOf('Drewno opałowe z lasu');
  ops.createOperation(operationInput({ quantity: 50 }), ctx);
  assert.equal(stockOf('Drewno opałowe z lasu'), before + 200);
});

test('wydanie odejmuje ze stanu', () => {
  const before = stockOf('Drewno opałowe z lasu');
  ops.createOperation(operationInput({
    type: 'SPRZEDAZ', quantity: 10, unit: 'MP',
    recipientName: 'Elektrownia Test', priceSale: 70, supplierName: undefined,
  }), ctx);
  assert.equal(stockOf('Drewno opałowe z lasu'), before - 10);
});

test('brak podpisu blokuje zapis, gdy reguła jest włączona', () => {
  assert.throws(
    () => ops.createOperation(operationInput({ signature: 'Jan' }), ctx),
    (err) => err.code === 'VALIDATION_ERROR' && /pełnym imieniem i nazwiskiem/.test(JSON.stringify(err.details)),
  );
});

test('wolumen zerowy lub ujemny jest odrzucany', () => {
  assert.throws(() => ops.createOperation(operationInput({ quantity: 0 }), ctx), /VALIDATION|błęd/i);
  assert.throws(() => ops.createOperation(operationInput({ quantity: -5 }), ctx), /VALIDATION|błęd/i);
});

test('nieznany produkt zakłada się automatycznie z właściwą kategorią', () => {
  const { operation } = ops.createOperation(
    operationInput({ productName: 'Zrębka Testowa Nowa', quantity: 20, unit: 'MP' }), ctx,
  );
  const product = db.get('SELECT * FROM products WHERE id = :id', { id: operation.productId });
  assert.equal(product.name, 'Zrębka Testowa Nowa');
  assert.equal(product.category, 'ZREBKA', 'heurystyka rozpoznaje zrębkę po nazwie');
});

test('edycja zapisuje korektę ze stanem przed i po', () => {
  const { operation } = ops.createOperation(operationInput({ quantity: 60 }), ctx);
  const result = ops.updateOperation(operation.id, {
    quantity: 75, correctionReason: 'Korekta po ponownym obmiarze',
  }, ctx);

  assert.equal(result.operation.quantity, 75);
  assert.equal(result.operation.qtyMp, 300);
  assert.equal(result.operation.revision, 2);

  const changed = result.changes.map((c) => c.field);
  assert.ok(changed.includes('quantity'));
  assert.ok(changed.includes('qty_mp'));
  assert.ok(!changed.includes('is_stored'), 'pola niezmienione nie trafiają do korekty');

  const corrections = listCorrections({ operationId: operation.id });
  assert.equal(corrections.items.length, 1);
  assert.equal(corrections.items[0].reason, 'Korekta po ponownym obmiarze');
});

test('edycja przelicza ruchy magazynowe', () => {
  const before = stockOf('Drewno opałowe z lasu');
  const { operation } = ops.createOperation(operationInput({ quantity: 10 }), ctx);
  assert.equal(stockOf('Drewno opałowe z lasu'), before + 40);

  ops.updateOperation(operation.id, { quantity: 20, correctionReason: 'Poprawka' }, ctx);
  assert.equal(stockOf('Drewno opałowe z lasu'), before + 80, 'stan odzwierciedla nową ilość, nie sumę obu');
});

test('przywrócenie korekty cofa dokument i dopisuje kolejny wpis historii', () => {
  const { operation } = ops.createOperation(operationInput({ quantity: 30 }), ctx);
  ops.updateOperation(operation.id, { quantity: 45, correctionReason: 'Zmiana' }, ctx);
  const correction = listCorrections({ operationId: operation.id }).items[0];

  const restored = ops.restoreCorrection(correction.id, ctx);
  assert.equal(restored.operation.quantity, 30);
  assert.equal(listCorrections({ operationId: operation.id }).items.length, 2,
    'historia rośnie, nie jest nadpisywana');
});

test('storno usuwa ruchy, zachowując dokument w rejestrze', () => {
  const before = stockOf('Drewno opałowe z lasu');
  const { operation } = ops.createOperation(operationInput({ quantity: 15 }), ctx);
  assert.equal(stockOf('Drewno opałowe z lasu'), before + 60);

  const cancelled = ops.cancelOperation(operation.id, { reason: 'Pomyłka przy wprowadzaniu' }, ctx);
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(stockOf('Drewno opałowe z lasu'), before);
  assert.equal(db.value('SELECT COUNT(*) FROM operations WHERE id = :id', { id: operation.id }), 1);
  assert.equal(db.value('SELECT COUNT(*) FROM stock_moves WHERE operation_id = :id', { id: operation.id }), 0);
});

test('anulowanego dokumentu nie można edytować ani anulować ponownie', () => {
  const { operation } = ops.createOperation(operationInput({ quantity: 8 }), ctx);
  ops.cancelOperation(operation.id, { reason: 'Test blokady' }, ctx);
  assert.throws(() => ops.updateOperation(operation.id, { quantity: 9 }, ctx), /anulowany/i);
  assert.throws(() => ops.cancelOperation(operation.id, { reason: 'Drugi raz' }, ctx), /już anulowany/i);
});

test('storno wymaga sensownego uzasadnienia', () => {
  const { operation } = ops.createOperation(operationInput({ quantity: 7 }), ctx);
  assert.throws(() => ops.cancelOperation(operation.id, { reason: 'x' }, ctx), /VALIDATION|błęd/i);
});

test('łańcuch terenowy tworzy komplet spójnych dokumentów', () => {
  const rawBefore = stockOf('Drewno opałowe z lasu');
  const result = createChain({
    purchase: operationInput({
      operationDate: '2026-03-15', quantity: 50, unit: 'M3',
      chippingMode: 'wynajęte', chippingPrice: 12,
      carrierName: 'Trans-Bio', vehiclePlate: 'SK 12345', distanceKm: 60, transportCost: 520,
      haulageNoteNo: 'KW/2026/0099',
    }),
    chain: {
      produceChips: true, sellDirectly: true,
      chipProductName: 'Zrębka Produkcyjna Leśna', chipQuantityMp: 190,
      saleRecipient: 'Elektrownia Rybnik', salePrice: 72, saleUnit: 'MP',
    },
  }, ctx);

  const series = result.operations.map((o) => o.docNo.split('/')[0]);
  assert.deepEqual(series, ['PZ', 'RW', 'PW', 'WZ']);
  assert.ok(result.operations.every((o) => o.chainRef === result.chainRef));

  // Surowiec wchodzi i od razu schodzi — bilans netto zero.
  assert.equal(stockOf('Drewno opałowe z lasu'), rawBefore, 'surowiec przerobiony w całości');
  // Zrębka wyprodukowana i sprzedana w tej samej ilości.
  assert.equal(stockOf('Zrębka Produkcyjna Leśna'), 0);

  // Koszty nie są dublowane.
  const [pz, rw, pw, wz] = result.operations;
  assert.equal(pz.valuePurchase, 4500);
  assert.equal(rw.valuePurchase, 0);
  assert.equal(pw.chippingCost, 190 * 12);
  assert.equal(pz.transportCost, 0, 'transport nie zostaje na PZ');
  assert.equal(wz.transportCost, 520, 'transport przypisany do wywozu');
  assert.equal(wz.haulageNoteNo, 'KW/2026/0099');
  assert.equal(wz.valueSale, 190 * 72);
});

test('łańcuch bez sprzedaży zostawia zrębkę na magazynie', () => {
  const before = stockOf('Zrębka Produkcyjna Leśna');
  const result = createChain({
    purchase: operationInput({ operationDate: '2026-03-16', quantity: 40, unit: 'M3' }),
    chain: { produceChips: true, sellDirectly: false, chipProductName: 'Zrębka Produkcyjna Leśna', chipQuantityMp: 150 },
  }, ctx);
  assert.equal(result.operations.length, 3);
  assert.equal(stockOf('Zrębka Produkcyjna Leśna'), before + 150);
});

test('sprzedaż prosto z lasu bez odbiorcy i ceny jest odrzucana', () => {
  assert.throws(
    () => createChain({
      purchase: operationInput({ operationDate: '2026-03-17', quantity: 20 }),
      chain: { produceChips: true, sellDirectly: true },
    }, ctx),
    /odbiorcy i ceny/i,
  );
});

test('ogniwa łańcucha nie dają się anulować pojedynczo', () => {
  const result = createChain({
    purchase: operationInput({ operationDate: '2026-03-18', quantity: 30 }),
    chain: { produceChips: true, sellDirectly: false, chipQuantityMp: 100 },
  }, ctx);
  const consumption = result.operations.find((o) => o.type === 'ZUZYCIE');
  assert.throws(
    () => ops.cancelOperation(consumption.id, { reason: 'Próba rozbicia łańcucha' }, ctx),
    /należy do łańcucha/i,
  );
});

test('raport produkcji dnia liczy uzysk i wiąże dokumenty', () => {
  const report = productionDay({ date: '2026-03-16' });
  assert.ok(report.count >= 1);
  assert.ok(report.totals.qtyMp > 0);
  assert.ok(report.yieldRatio > 0, 'uzysk = MP zrębki / MP surowca');
  assert.ok(report.consumption.length >= 1);
});

test('kartoteka magazynowa daje saldo narastające', () => {
  const product = db.get("SELECT id FROM products WHERE name = 'Drewno opałowe z lasu'");
  const ledger = stockLedger({ productId: product.id, limit: 500 });
  assert.ok(ledger.items.length > 0);
  const last = ledger.items[ledger.items.length - 1];
  assert.equal(last.balanceMp, ledger.closing);
  assert.equal(ledger.closing, stockOf('Drewno opałowe z lasu'));
});

test('stan bieżący zgadza się z sumą pozycji', () => {
  const stock = currentStock();
  const sum = stock.items.reduce((a, i) => a + i.qtyMp, 0);
  assert.ok(Math.abs(sum - stock.totals.qtyMp) < 0.01);
});

test('raport miesięczny domyka bilans: BO + przychody − rozchody = BZ', () => {
  const report = monthlyReport({ month: '2026-03' });
  for (const p of report.products) {
    const expected = p.opening.qtyMp
      + p.purchase.qtyMp + p.production.qtyMp
      - p.sale.qtyMp - p.consumption.qtyMp;
    assert.ok(
      Math.abs(expected - p.closing.qtyMp) < 0.01,
      `bilans produktu ${p.productName}: oczekiwano ${expected}, jest ${p.closing.qtyMp}`,
    );
  }
  assert.ok(report.summary.documents > 0);
  assert.equal(
    report.summary.grossMargin,
    Math.round((report.summary.saleValue - report.summary.purchaseValue
      - report.summary.chippingCost - report.summary.transportCost) * 100) / 100,
  );
});

test('zamknięty okres blokuje zapisy, a otwarcie je przywraca', () => {
  closePeriod('2026-03', { note: 'Zamknięcie testowe' }, ctx);
  assert.equal(periodStatus('2026-03'), 'CLOSED');
  assert.throws(
    () => ops.createOperation(operationInput({ operationDate: '2026-03-20', quantity: 5 }), ctx),
    (err) => err.code === 'PERIOD_CLOSED',
  );

  // Migawka stanów została utrwalona.
  assert.ok(db.value("SELECT COUNT(*) FROM stock_snapshots WHERE month = '2026-03'") > 0);

  reopenPeriod('2026-03', { reason: 'Uzupełnienie brakującego dokumentu' }, ctx);
  assert.equal(periodStatus('2026-03'), 'OPEN');
  const { operation } = ops.createOperation(operationInput({ operationDate: '2026-03-20', quantity: 5 }), ctx);
  assert.ok(operation.docNo);
});

test('zamknięcie okresu wymaga zamknięcia wcześniejszych miesięcy', () => {
  ops.createOperation(operationInput({ operationDate: '2026-01-15', quantity: 5 }), ctx);
  ops.createOperation(operationInput({ operationDate: '2026-02-15', quantity: 5 }), ctx);
  assert.throws(() => closePeriod('2026-02', {}, ctx), /zamknij wcześniejszy okres 2026-01/i);
});

test('blokada stanów ujemnych działa po zmianie ustawienia', () => {
  updateSettings({ 'rules.allow_negative_stock': false }, admin.id);
  invalidateSettingsCache();
  assert.throws(
    () => ops.createOperation(operationInput({
      type: 'SPRZEDAZ', operationDate: '2026-04-01', productName: 'Produkt Bez Stanu',
      quantity: 100, unit: 'MP', recipientName: 'Odbiorca', priceSale: 50, supplierName: undefined,
    }), ctx),
    /poniżej zera|stany ujemne/i,
  );
  updateSettings({ 'rules.allow_negative_stock': true }, admin.id);
  invalidateSettingsCache();
});

test('zmiana przeliczników nie rusza dokumentów już zaksięgowanych', () => {
  const { operation } = ops.createOperation(
    operationInput({ operationDate: '2026-04-02', quantity: 10, unit: 'M3' }), ctx,
  );
  assert.equal(operation.qtyMp, 40);
  assert.equal(operation.factors.m3ToMp, 4);

  updateSettings({ 'units.m3_to_mp': 3 }, admin.id);
  invalidateSettingsCache();

  const reread = ops.getOperation(operation.id);
  assert.equal(reread.qtyMp, 40, 'historia pozostaje bez zmian');
  assert.equal(reread.factors.m3ToMp, 4, 'dokument pamięta użyty przelicznik');

  const fresh = ops.createOperation(operationInput({ operationDate: '2026-04-02', quantity: 10, unit: 'M3' }), ctx);
  assert.equal(fresh.operation.qtyMp, 30, 'nowy dokument używa nowego przelicznika');

  updateSettings({ 'units.m3_to_mp': 4 }, admin.id);
  invalidateSettingsCache();
});

test('lista dokumentów filtruje i podsumowuje', () => {
  const all = ops.listOperations({});
  assert.ok(all.page.total > 0);
  assert.ok(all.totals.qtyMp !== 0);

  const purchases = ops.listOperations({ type: 'ZAKUP' });
  assert.ok(purchases.items.every((o) => o.type === 'ZAKUP'));
  assert.ok(purchases.page.total < all.page.total);

  const march = ops.listOperations({ month: '2026-03' });
  assert.ok(march.items.every((o) => o.operationMonth === '2026-03'));

  const search = ops.listOperations({ q: 'KW/2026/0099' });
  assert.ok(search.page.total >= 1);
});

test('stronicowanie zwraca rozłączne strony', () => {
  const first = ops.listOperations({ limit: 5, offset: 0 });
  const second = ops.listOperations({ limit: 5, offset: 5 });
  const ids = new Set(first.items.map((o) => o.id));
  assert.ok(second.items.every((o) => !ids.has(o.id)));
});

test('magazynier nie może edytować cudzego dokumentu', () => {
  const { operation } = ops.createOperation(operationInput({ operationDate: '2026-04-05', quantity: 12 }), ctx);
  const other = testContext({ userId: 'inny-uzytkownik', role: 'MAGAZYNIER' });
  assert.throws(
    () => ops.updateOperation(operation.id, { quantity: 13, correctionReason: 'Próba' }, other),
    /wyłącznie własne dokumenty/i,
  );
});

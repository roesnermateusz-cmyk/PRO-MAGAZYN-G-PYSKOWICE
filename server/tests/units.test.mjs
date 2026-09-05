/** Testy silnika przeliczeń jednostek i numeracji dokumentów. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeQuantities, computeValues, resolveFactors, roundQty, roundMoney, DEFAULT_FACTORS,
} from '../src/domain/units.js';
import { formatDocNo, parseDocNo, seriesForType, SERIES_BY_TYPE } from '../src/domain/documents.js';
import { deriveMoves, validateWarehouses } from '../src/domain/stock.js';

const factors = { m3ToMp: 4, mpToTonne: 0.33, tonneToGj: 8.5 };

test('przeliczenie z m³ rozwija cały łańcuch jednostek', () => {
  const q = computeQuantities({ quantity: 100, unit: 'M3', factors });
  assert.equal(q.qtyM3, 100);
  assert.equal(q.qtyMp, 400);
  assert.equal(q.qtyTonne, 132);          // 400 MP × 0.33
  assert.equal(q.energyGj, 1122);         // 132 t × 8.5
});

test('przeliczenie z MP jest spójne z przeliczeniem z m³', () => {
  const fromM3 = computeQuantities({ quantity: 100, unit: 'M3', factors });
  const fromMp = computeQuantities({ quantity: fromM3.qtyMp, unit: 'MP', factors });
  assert.equal(fromMp.qtyM3, 100);
  assert.equal(fromMp.qtyTonne, fromM3.qtyTonne);
});

test('przeliczenie z ton działa w drugą stronę', () => {
  const q = computeQuantities({ quantity: 132, unit: 'TONA', factors });
  assert.equal(q.qtyMp, 400);
  assert.equal(q.qtyM3, 100);
  assert.equal(q.energyGj, 1122);
});

test('waga rzeczywista nadpisuje przeliczenie masy, nie zmieniając MP', () => {
  const q = computeQuantities({
    quantity: 100, unit: 'M3', factors, tonneMode: 'RECZNIE', tonneManual: 118.5,
  });
  assert.equal(q.qtyMp, 400, 'stan magazynu liczony w MP pozostaje bez zmian');
  assert.equal(q.qtyTonne, 118.5);
  assert.equal(q.energyGj, roundQty(118.5 * 8.5));
  assert.equal(q.tonneManual, true);
});

test('rzeczywiste MP przelicza masę w dół łańcucha', () => {
  const q = computeQuantities({
    quantity: 100, unit: 'M3', factors, mpMode: 'RECZNIE', mpManual: 370,
  });
  assert.equal(q.qtyMp, 370);
  assert.equal(q.qtyTonne, roundQty(370 * 0.33));
  assert.equal(q.mpManual, true);
});

test('tryb ręczny bez wartości nie zmienia przeliczenia', () => {
  const q = computeQuantities({ quantity: 50, unit: 'MP', factors, tonneMode: 'RECZNIE', tonneManual: 0 });
  assert.equal(q.qtyTonne, roundQty(50 * 0.33));
  assert.equal(q.tonneManual, false);
});

test('przeliczniki produktu mają pierwszeństwo przed globalnymi', () => {
  const resolved = resolveFactors({ m3_to_mp: 2.8, mp_to_tonne: null, tonne_to_gj: 9.1 }, factors);
  assert.equal(resolved.m3ToMp, 2.8);
  assert.equal(resolved.mpToTonne, 0.33, 'brak wartości produktu → wartość globalna');
  assert.equal(resolved.tonneToGj, 9.1);
});

test('brak przeliczników w ogóle cofa się do wartości domyślnych', () => {
  const resolved = resolveFactors(null, {});
  assert.deepEqual(resolved, DEFAULT_FACTORS);
});

test('wartości pieniężne liczone są od jednostki wprowadzenia', () => {
  const v = computeValues({ quantity: 100, pricePurchase: 92.5, priceSale: 0, chippingPrice: 11 });
  assert.equal(v.valuePurchase, 9250);
  assert.equal(v.valueSale, 0);
  assert.equal(v.chippingCost, 1100);
});

test('zaokrąglenia: ilości do 3 miejsc, kwoty do 2', () => {
  assert.equal(roundQty(1.23456), 1.235);
  assert.equal(roundMoney(1.005), 1);      // IEEE-754: 1.005 to w istocie 1.00499…
  assert.equal(roundMoney(2.345), 2.35);
});

test('numeracja dokumentów: format, rozbiór i serie', () => {
  assert.equal(formatDocNo('PZ', 2026, 7), 'PZ/2026/000007');
  assert.deepEqual(parseDocNo('WZ/2026/000123'), { series: 'WZ', year: 2026, number: 123 });
  assert.equal(parseDocNo('stary-numer-42'), null);
  assert.equal(seriesForType('ZAKUP'), 'PZ');
  assert.equal(seriesForType('ZUZYCIE'), 'RW');
  assert.equal(seriesForType('PRODUKCJA'), 'PW');
  assert.throws(() => seriesForType('NIEZNANY'), /Nieznany typ operacji/);
});

test('każdy typ operacji ma przypisaną serię dokumentu', () => {
  for (const [type, series] of Object.entries(SERIES_BY_TYPE)) {
    assert.match(series, /^[A-Z]{2}$/, `seria dla ${type}`);
  }
});

test('ruchy magazynowe: przyjęcie dodaje, wydanie odejmuje', () => {
  const base = {
    status: 'POSTED', product_id: 'p1', qty_mp: 400, qty_m3: 100, qty_tonne: 132, energy_gj: 1122,
    value_purchase: 9000, value_sale: 0,
  };
  const inbound = deriveMoves({ ...base, type: 'ZAKUP', warehouse_to_id: 'w1' });
  assert.equal(inbound.length, 1);
  assert.equal(inbound[0].direction, 1);
  assert.equal(inbound[0].qtyMp, 400);

  const outbound = deriveMoves({ ...base, type: 'SPRZEDAZ', warehouse_from_id: 'w1' });
  assert.equal(outbound[0].direction, -1);
  assert.equal(outbound[0].qtyMp, -400);
  assert.equal(outbound[0].qtyTonne, -132);
});

test('MM tworzy parę ruchów o sumie zerowej', () => {
  const moves = deriveMoves({
    status: 'POSTED', type: 'MM', product_id: 'p1',
    warehouse_from_id: 'w1', warehouse_to_id: 'w2',
    qty_mp: 120, qty_m3: 30, qty_tonne: 39.6, energy_gj: 336.6,
  });
  assert.equal(moves.length, 2);
  assert.equal(moves[0].qtyMp + moves[1].qtyMp, 0);
  assert.equal(moves[0].warehouseId, 'w1');
  assert.equal(moves[1].warehouseId, 'w2');
});

test('dokument anulowany nie generuje ruchów', () => {
  const moves = deriveMoves({ status: 'CANCELLED', type: 'ZAKUP', warehouse_to_id: 'w1', qty_mp: 100 });
  assert.deepEqual(moves, []);
});

test('walidacja magazynów zależy od typu dokumentu', () => {
  assert.deepEqual(validateWarehouses({ type: 'ZAKUP', warehouse_to_id: 'w1' }), []);
  assert.equal(validateWarehouses({ type: 'ZAKUP' }).length, 1);
  assert.equal(validateWarehouses({ type: 'SPRZEDAZ' }).length, 1);
  assert.equal(validateWarehouses({ type: 'MM', warehouse_from_id: 'w1', warehouse_to_id: 'w1' }).length, 1,
    'MM na ten sam magazyn jest błędem');
  assert.deepEqual(validateWarehouses({ type: 'MM', warehouse_from_id: 'w1', warehouse_to_id: 'w2' }), []);
});

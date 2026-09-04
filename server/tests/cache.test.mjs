/**
 * Testy warstwy pamięci podręcznej.
 *
 * Pamięć podręczna w systemie magazynowym jest ryzykowna z definicji: jej jedyny
 * możliwy błąd to podanie nieaktualnego stanu, a taki błąd jest niewidoczny —
 * liczba wygląda poprawnie, tylko jest nie ta. Dlatego testy sprawdzają nie
 * skuteczność trafień, lecz to, czy wpis na pewno znika, kiedy powinien.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { Cache, keyFor, TAG } from '../src/lib/cache.js';

/** Zegar sterowany ręcznie — testy czasu życia nie mogą czekać. */
function fakeClock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms) => { now += ms; } };
}

test('odczyt bez zapisu to chybienie', () => {
  const c = new Cache();
  assert.equal(c.get('nie ma'), undefined);
  assert.equal(c.report().misses, 1);
});

test('zapisana wartość wraca bez ponownego liczenia', () => {
  const c = new Cache();
  let calls = 0;
  const compute = () => { calls += 1; return { value: 42 }; };

  assert.deepEqual(c.wrap('k', {}, compute), { value: 42 });
  assert.deepEqual(c.wrap('k', {}, compute), { value: 42 });
  assert.equal(calls, 1, 'druga próba nie uruchamia obliczenia');
});

test('podbicie tagu unieważnia wpis oznaczony tym tagiem', () => {
  const c = new Cache();
  let calls = 0;
  const read = () => c.wrap('raport', { tags: ['stock', 'month:2026-09'] }, () => { calls += 1; return calls; });

  assert.equal(read(), 1);
  assert.equal(read(), 1);
  c.bump('stock');
  assert.equal(read(), 2, 'po podbiciu tagu wartość liczona od nowa');
  assert.equal(c.report().stale, 1);
});

test('podbicie obcego tagu nie rusza wpisu', () => {
  const c = new Cache();
  let calls = 0;
  const read = () => c.wrap('raport', { tags: ['month:2021-07'] }, () => { calls += 1; return calls; });

  assert.equal(read(), 1);
  c.bump('month:2026-09');
  c.bump('users');
  assert.equal(read(), 1, 'wpis za lipiec 2021 przeżywa zapis z innego miesiąca');
  assert.equal(calls, 1);
});

test('tag nadany po zapisie nie unieważnia wstecz', () => {
  const c = new Cache();
  c.set('a', 1, { tags: ['stock'] });
  // Wpis zapisany przy generacji 0; podbicie do 1 musi go usunąć.
  c.bump('stock');
  assert.equal(c.get('a'), undefined);
  // Kolejny zapis widzi generację 1 i przy niej pozostaje ważny.
  c.set('a', 2, { tags: ['stock'] });
  assert.equal(c.get('a'), 2);
});

test('wpis wygasa po czasie życia', () => {
  const clock = fakeClock();
  const c = new Cache({ ttlMs: 1000, now: clock.now });
  c.set('a', 'wartość');
  clock.advance(999);
  assert.equal(c.get('a'), 'wartość');
  clock.advance(2);
  assert.equal(c.get('a'), undefined);
  assert.equal(c.report().expired, 1);
});

test('limit wpisów wypiera najdawniej używane', () => {
  const c = new Cache({ maxEntries: 3 });
  c.set('a', 1); c.set('b', 2); c.set('c', 3);
  c.get('a');                     // odświeżenie „a” — teraz „b” jest najstarsze
  c.set('d', 4);

  assert.equal(c.get('b'), undefined, 'najdawniej używany wpis wypada');
  assert.equal(c.get('a'), 1);
  assert.equal(c.get('c'), 3);
  assert.equal(c.get('d'), 4);
  assert.equal(c.report().entries, 3);
});

test('czyszczenie usuwa wpisy, zachowując generacje tagów', () => {
  const c = new Cache();
  c.bump('stock');
  const generation = c.generation('stock');
  c.set('a', 1, { tags: ['stock'] });
  c.flush();

  assert.equal(c.get('a'), undefined);
  assert.equal(c.generation('stock'), generation, 'generacje przeżywają czyszczenie');
});

test('wartość false i zero są zapamiętywane, nie mylone z brakiem', () => {
  const c = new Cache();
  let calls = 0;
  const read = (key, value) => c.wrap(key, {}, () => { calls += 1; return value; });

  assert.equal(read('zero', 0), 0);
  assert.equal(read('zero', 0), 0);
  assert.equal(read('falsz', false), false);
  assert.equal(read('falsz', false), false);
  assert.equal(calls, 2, 'zero i false nie są liczone ponownie');
});

test('wyjątek z obliczenia nie trafia do pamięci', () => {
  const c = new Cache();
  assert.throws(() => c.wrap('k', {}, () => { throw new Error('błąd odczytu'); }), /błąd odczytu/);
  assert.equal(c.get('k'), undefined, 'po błędzie nie zostaje nic do podania');
});

test('klucz nie zależy od kolejności pól ani od pustych wartości', () => {
  assert.equal(
    keyFor('raport', { month: '2026-09', warehouseId: 'W1' }),
    keyFor('raport', { warehouseId: 'W1', month: '2026-09' }),
  );
  assert.equal(
    keyFor('raport', { month: '2026-09' }),
    keyFor('raport', { month: '2026-09', warehouseId: null, extra: undefined }),
  );
  assert.notEqual(keyFor('raport', { month: '2026-09' }), keyFor('raport', { month: '2026-10' }));
  assert.notEqual(keyFor('a', { x: 1 }), keyFor('b', { x: 1 }));
});

test('klucz rozróżnia wartości podobne po zamianie na tekst', () => {
  assert.notEqual(keyFor('k', { v: 1 }), keyFor('k', { v: '1' }));
  assert.notEqual(keyFor('k', { v: true }), keyFor('k', { v: 'true' }));
});

test('tagi obszarów mają rozłączne nazwy', () => {
  const names = [TAG.STOCK, TAG.DOCUMENTS, TAG.CATALOG, TAG.SETTINGS, TAG.PERIODS, TAG.USERS, TAG.HISTORY];
  assert.equal(new Set(names).size, names.length);
  assert.notEqual(TAG.warehouse('W1'), TAG.warehouse(null));
  assert.notEqual(TAG.catalog('products'), TAG.catalog('partners'));
  assert.notEqual(TAG.catalog('products'), TAG.CATALOG);
});

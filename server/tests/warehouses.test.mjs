/**
 * Testy dostępu do magazynów: przypisania, zakres widoczności, cykl życia placu.
 *
 * Sedno: użytkownik przypisany do jednego placu nie może ani zaksięgować na
 * cudzym, ani go zobaczyć. Kontrola musi działać na każdej drodze — przez
 * formularz, przez wskazanie klucza magazynu i przez sam brak wyboru
 * (podstawienie magazynu domyślnego).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareEnv, cleanupEnv, testContext, operationInput } from './helpers.mjs';

prepareEnv('warehouses');

const { default: db } = await import('../src/db/index.js');
const { bootstrap } = await import('../src/bootstrap.js');
const ops = await import('../src/modules/operations/operations.service.js');
const { currentStock } = await import('../src/modules/stock/stock.service.js');
const { warehouses } = await import('../src/modules/catalog/catalog.service.js');
const access = await import('../src/modules/catalog/warehouse-access.service.js');
const { createUser } = await import('../src/modules/users/users.service.js');
const { listAudit } = await import('../src/middleware/audit.js');

bootstrap();

const admin = db.get("SELECT id, email, full_name FROM users WHERE role = 'ADMIN' LIMIT 1");
const adminCtx = testContext({ userId: admin.id });

/**
 * Dokumenty magazyniera muszą mieścić się w oknie księgowania wstecz, więc
 * testy tej roli używają daty bieżącej — inaczej sprawdzałyby kontrolę daty
 * zamiast kontroli dostępu do magazynu.
 */
const dzis = new Date().toISOString().slice(0, 10);

const wh = (name) => db.get('SELECT id, name FROM warehouses WHERE name = :name', { name });
const zabrze = wh('RiC Zabrze');
const braszewice = wh('RiC Brąszewice');
const rokitki = wh('RiC Rokitki');

/** Magazynier przypisany wyłącznie do Rokitek. */
const rokitkiUser = createUser({
  email: 'rokitki@resinvest.local',
  fullName: 'Marek Rokitkowy',
  role: 'MAGAZYNIER',
  password: 'Rokitki2026!xY',
}, adminCtx);
access.setUserWarehouses(rokitkiUser.id, [rokitki.id], adminCtx);
const rokitkiCtx = testContext({ userId: rokitkiUser.id, role: 'MAGAZYNIER' });

test.after(cleanupEnv);

/* ------------------------------ Kartoteka ------------------------------- */

test('instalacja zakłada trzy place składowe RiC', () => {
  const names = db.all('SELECT name FROM warehouses WHERE is_active = 1 ORDER BY name').map((r) => r.name);
  assert.deepEqual(names, ['RiC Brąszewice', 'RiC Rokitki', 'RiC Zabrze']);
  assert.equal(db.value('SELECT COUNT(*) FROM warehouses WHERE is_default = 1'), 1,
    'dokładnie jeden magazyn domyślny');
});

/* ------------------------------- Zakres --------------------------------- */

test('brak przypisań oznacza dostęp do wszystkich magazynów', () => {
  const wolny = createUser({
    email: 'wolny@resinvest.local', fullName: 'Anna Wolna',
    role: 'MAGAZYNIER', password: 'Wolna2026!xY',
  }, adminCtx);
  assert.equal(access.warehouseScope({ id: wolny.id, role: 'MAGAZYNIER' }), null);
  assert.equal(access.warehousesForUser({ id: wolny.id, role: 'MAGAZYNIER' }).length, 3);
});

test('przypisanie zawęża zakres i listę do wyboru', () => {
  const scope = access.warehouseScope(rokitkiCtx.user);
  assert.deepEqual(scope, [rokitki.id]);
  const widoczne = access.warehousesForUser(rokitkiCtx.user).map((w) => w.name);
  assert.deepEqual(widoczne, ['RiC Rokitki']);
});

test('administrator widzi wszystkie magazyny mimo przypisania', () => {
  access.setUserWarehouses(admin.id, [zabrze.id], adminCtx);
  assert.equal(access.warehouseScope({ id: admin.id, role: 'ADMIN' }), null,
    'rola ADMIN nie daje się zamknąć w jednym placu');
  access.setUserWarehouses(admin.id, [], adminCtx);
});

/* ----------------------------- Księgowanie ------------------------------ */

test('księgowanie na cudzym magazynie jest odrzucane', () => {
  assert.throws(
    () => ops.createOperation(operationInput({
      operationDate: dzis, quantity: 10, warehouseTo: 'RiC Zabrze',
    }), rokitkiCtx),
    (err) => err.status === 403 && /nie masz dostępu/i.test(err.message),
  );
});

test('wskazanie cudzego magazynu kluczem też jest odrzucane', () => {
  assert.throws(
    () => ops.createOperation(operationInput({
      operationDate: dzis, quantity: 10, warehouseToId: braszewice.id,
    }), rokitkiCtx),
    (err) => err.status === 403,
  );
});

test('pominięcie magazynu nie podstawia domyślnego spoza zakresu', () => {
  // Magazynem domyślnym jest Zabrze. Użytkownik z Rokitek, który nie wypełni
  // pola, nie może wylądować na Zabrzu „przez przypadek”.
  assert.throws(
    () => ops.createOperation(operationInput({ operationDate: dzis, quantity: 10 }), rokitkiCtx),
    (err) => err.status === 403,
  );
});

test('księgowanie we własnym magazynie przechodzi', () => {
  const { operation } = ops.createOperation(operationInput({
    operationDate: dzis, quantity: 30, warehouseTo: 'RiC Rokitki', productName: 'Zrębka Rokitki',
  }), rokitkiCtx);
  assert.equal(operation.warehouseTo, 'RiC Rokitki');
});

/* ----------------------------- Widoczność ------------------------------- */

test('rejestr pokazuje wyłącznie dokumenty z własnych magazynów', () => {
  ops.createOperation(operationInput({
    operationDate: dzis, quantity: 44, warehouseTo: 'RiC Zabrze', productName: 'Zrębka Zabrze',
  }), adminCtx);

  const wszystkie = ops.listOperations({ limit: 100 }, { user: adminCtx.user });
  const moje = ops.listOperations({ limit: 100 }, { user: rokitkiCtx.user });

  assert.ok(wszystkie.page.total > moje.page.total, 'zakres faktycznie zawęża rejestr');
  assert.ok(moje.items.length > 0, 'własne dokumenty są widoczne');
  assert.ok(
    moje.items.every((o) => o.warehouseTo === 'RiC Rokitki' || o.warehouseFrom === 'RiC Rokitki'),
    'w wyniku nie ma dokumentu z cudzego placu',
  );
});

test('podgląd dokumentu z cudzego magazynu jest odmawiany', () => {
  const obcy = ops.listOperations({ limit: 100 }, { user: adminCtx.user })
    .items.find((o) => o.warehouseTo === 'RiC Zabrze');
  assert.ok(obcy, 'dokument kontrolny istnieje');

  assert.doesNotThrow(() => ops.getOperation(obcy.id, { user: adminCtx.user }));
  assert.throws(
    () => ops.getOperation(obcy.id, { user: rokitkiCtx.user }),
    (err) => err.status === 403,
  );
});

test('stan magazynowy jest zawężony do zakresu', () => {
  const wszystkie = currentStock({}, { user: adminCtx.user });
  const moje = currentStock({}, { user: rokitkiCtx.user });

  assert.ok(wszystkie.items.length > moje.items.length);
  assert.ok(moje.items.every((i) => i.warehouseName === 'RiC Rokitki'));
  assert.ok(
    moje.totals.qtyMp < wszystkie.totals.qtyMp,
    'suma zbiorcza też jest policzona w zakresie, nie dla całej firmy',
  );
});

test('pytanie o cudzy magazyn wprost kończy się odmową, nie pustą listą', () => {
  assert.throws(
    () => currentStock({ warehouseId: zabrze.id }, { user: rokitkiCtx.user }),
    (err) => err.status === 403,
  );
});

/* --------------------------- Cykl życia placu --------------------------- */

test('nie da się zamknąć magazynu z niezerowym stanem', () => {
  assert.throws(
    () => access.deactivateWarehouse(rokitki.id, adminCtx),
    (err) => err.status === 409 && /niezerowy stan/i.test(err.message),
  );
});

test('nie da się zamknąć magazynu domyślnego', () => {
  assert.throws(
    () => access.deactivateWarehouse(zabrze.id, adminCtx),
    (err) => err.status === 409 && /domyśln/i.test(err.message),
  );
});

test('pusty magazyn da się zamknąć i przywrócić', () => {
  const wynik = access.deactivateWarehouse(braszewice.id, adminCtx);
  assert.equal(wynik.isActive, false);
  assert.equal(warehouses.list().find((w) => w.id === braszewice.id), undefined,
    'zamknięty plac znika z listy aktywnych');

  access.activateWarehouse(braszewice.id, adminCtx);
  assert.ok(warehouses.list().some((w) => w.id === braszewice.id));
});

test('zamknięcie placu zdejmuje przypisania użytkowników', () => {
  const user = createUser({
    email: 'braszewice@resinvest.local', fullName: 'Piotr Brąszewicki',
    role: 'MAGAZYNIER', password: 'Brasz2026!xY',
  }, adminCtx);
  access.setUserWarehouses(user.id, [braszewice.id], adminCtx);
  assert.deepEqual(access.grantedWarehouseIds(user.id), [braszewice.id]);

  access.deactivateWarehouse(braszewice.id, adminCtx);
  assert.deepEqual(access.grantedWarehouseIds(user.id), [],
    'przypisanie do zamkniętego placu nie może zostawić użytkownika bez dostępu');
  assert.equal(access.warehouseScope({ id: user.id, role: 'MAGAZYNIER' }), null);

  access.activateWarehouse(braszewice.id, adminCtx);
});

test('edycja kartoteki nie może zamknąć placu bocznymi drzwiami', () => {
  // Zabezpieczenia dezaktywacji są warte tyle, ile najsłabsza droga do celu.
  // Zwykła aktualizacja nie zna pola „aktywny” i ma je zignorować.
  warehouses.update(rokitki.id, { name: 'RiC Rokitki', isActive: false });
  assert.equal(
    db.value('SELECT is_active FROM warehouses WHERE id = :id', { id: rokitki.id }), 1,
    'plac pozostaje aktywny mimo próby wyłączenia go edycją',
  );
});

test('ostatniego aktywnego magazynu nie da się zamknąć', () => {
  // Ten stan nie powstaje normalną pracą — magazynu domyślnego nie da się
  // zamknąć, a domyślny jest zawsze dokładnie jeden. Powstaje natomiast po
  // przywróceniu kopii albo po ręcznej korekcie bazy, i właśnie przed takim
  // wejściem broni ta kontrola. Stan przygotowujemy więc wprost w bazie.
  db.run('UPDATE warehouses SET is_active = 0 WHERE id <> :id', { id: rokitki.id });
  db.run('UPDATE warehouses SET is_default = 0, is_active = 1 WHERE id = :id', { id: rokitki.id });

  assert.equal(db.value('SELECT COUNT(*) FROM warehouses WHERE is_active = 1'), 1);
  assert.throws(
    () => access.deactivateWarehouse(rokitki.id, adminCtx),
    (err) => err.status === 409 && /jedyny aktywny/i.test(err.message),
  );

  db.run('UPDATE warehouses SET is_active = 1', {});
  db.run('UPDATE warehouses SET is_default = 1 WHERE id = :id', { id: zabrze.id });
});

/* ------------------------------- Audyt ---------------------------------- */

test('zmiana przypisania trafia do audytu z wartością przed i po', () => {
  access.setUserWarehouses(rokitkiUser.id, [rokitki.id, braszewice.id], adminCtx);

  const wpis = listAudit({ entity: 'user_warehouses', limit: 5 }).items[0];
  assert.equal(wpis.action, 'UPDATE');
  assert.equal(wpis.entityId, rokitkiUser.id);
  const magazyny = wpis.changes.find((c) => c.field === 'magazyny');
  assert.deepEqual(magazyny.before, ['RiC Rokitki']);
  assert.deepEqual(magazyny.after, ['RiC Brąszewice', 'RiC Rokitki']);
  assert.equal(magazyny.label, 'Magazyny konta', 'historia ma być czytelna bez znajomości kluczy API');
  assert.ok(wpis.timestamp, 'wpis ma znacznik czasu');
  assert.equal(wpis.user, adminCtx.user.email, 'wpis wskazuje, kto zmienił');

  access.setUserWarehouses(rokitkiUser.id, [rokitki.id], adminCtx);
});

test('zamknięcie placu trafia do audytu', () => {
  access.deactivateWarehouse(braszewice.id, adminCtx);
  const wpis = listAudit({ entity: 'warehouses', limit: 5 }).items[0];
  assert.equal(wpis.action, 'DEACTIVATE');
  assert.deepEqual(
    wpis.changes.find((c) => c.field === 'aktywny'),
    { field: 'aktywny', label: 'Aktywny', before: true, after: false },
  );
  assert.equal(wpis.detail.magazyn, 'RiC Brąszewice');
  access.activateWarehouse(braszewice.id, adminCtx);
});

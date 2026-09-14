/**
 * Dziennik audytu: kto, kiedy, co zmienił — i jaka była wartość przed i po.
 *
 * Sam fakt „ktoś edytował kartotekę o 14:32” nie wystarcza kontroli. Te testy
 * pilnują dwóch rzeczy naraz: że ślad w ogóle powstaje (kartoteki pojazdów
 * i nadleśnictw wypadły kiedyś z dziennika, bo zapis robiły trasy, a nie
 * warstwa serwisowa) oraz że niesie wartości sprzed i po zmianie.
 *
 * Osobno pilnowana jest granica: skrót hasła nie ma prawa trafić do dziennika,
 * bo czyta go więcej osób niż tabelę `users`, a wpisów się nie usuwa.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareEnv, cleanupEnv, testContext, operationInput } from './helpers.mjs';

prepareEnv('audit');

const { default: db } = await import('../src/db/index.js');
const { bootstrap } = await import('../src/bootstrap.js');
const { listAudit } = await import('../src/middleware/audit.js');
const { products, partners, vehicles, forest } = await import('../src/modules/catalog/catalog.service.js');
const { updateSettings } = await import('../src/modules/settings/settings.service.js');
const users = await import('../src/modules/users/users.service.js');
const ops = await import('../src/modules/operations/operations.service.js');

bootstrap();

const admin = db.get("SELECT id, email FROM users WHERE role = 'ADMIN' LIMIT 1");
const ctx = testContext({ userId: admin.id });
const dzis = new Date().toISOString().slice(0, 10);

/** Najnowszy wpis dziennika dla wskazanej encji (opcjonalnie: akcji). */
function ostatni(entity, action = null) {
  const { items } = listAudit({ entity, limit: 50 });
  return items.find((i) => !action || i.action === action) ?? null;
}

test.after(() => cleanupEnv());

/* ===================== Kartoteki przez fabrykę ========================= */

test('utworzenie pozycji kartoteki zapisuje stan początkowy', () => {
  const item = products.create({ name: 'Zrębka audytowa', category: 'ZREBKA' }, ctx);

  const wpis = ostatni('products', 'CREATE');
  assert.equal(wpis.entityId, item.id);
  assert.equal(wpis.user, ctx.user.email);
  assert.ok(wpis.timestamp, 'wpis musi mieć datę i godzinę');
  assert.equal(wpis.detail.pozycja, 'Zrębka audytowa');
  assert.deepEqual(wpis.detail.zmiany.name, { przed: null, po: 'Zrębka audytowa' });
  assert.deepEqual(wpis.detail.zmiany.category, { przed: null, po: 'ZREBKA' });
});

test('edycja zapisuje wyłącznie pola, które faktycznie się zmieniły', () => {
  const item = products.create({ name: 'Trociny audytowe', category: 'PRODUKT_UBOCZNY' }, ctx);
  products.update(item.id, { name: 'Trociny audytowe', notes: 'partia próbna' }, ctx);

  const { zmiany } = ostatni('products', 'UPDATE').detail;
  assert.deepEqual(zmiany, { notes: { przed: null, po: 'partia próbna' } },
    'nazwa przysłana bez zmiany nie może zaśmiecać dziennika');
});

test('edycja bez żadnej zmiany nie tworzy wpisu', () => {
  const item = products.create({ name: 'Produkt bez zmian', category: 'INNE' }, ctx);
  const przed = listAudit({ entity: 'products', entityId: item.id }).total;

  products.update(item.id, { name: 'Produkt bez zmian' }, ctx);

  assert.equal(listAudit({ entity: 'products', entityId: item.id }).total, przed);
});

test('wyłączenie produktu ma własną akcję i pokazuje przejście stanu', () => {
  const item = products.create({ name: 'Produkt do wyłączenia', category: 'INNE' }, ctx);
  products.deactivate(item.id, ctx);

  const wpis = ostatni('products', 'DEACTIVATE');
  assert.equal(wpis.entityId, item.id);
  assert.deepEqual(wpis.detail.zmiany.isActive, { przed: true, po: false });
});

test('pojazdy i nadleśnictwa też trafiają do dziennika', () => {
  // Obie kartoteki miały zapis wyłącznie w trasach — i obie go nie miały.
  const pojazd = vehicles.create({ plate: 'SZA 12345', carrierName: 'Przewozy Testowe' }, ctx);
  assert.equal(ostatni('vehicles', 'CREATE').entityId, pojazd.id);

  const nadlesnictwo = forest.createDistrict({ name: 'Nadleśnictwo Audytowe', region: 'RDLP Katowice' }, ctx);
  const wpis = ostatni('forest_districts', 'CREATE');
  assert.equal(wpis.entityId, nadlesnictwo.id);
  assert.deepEqual(wpis.detail.zmiany.region, { przed: null, po: 'RDLP Katowice' });

  forest.createRange({ districtId: nadlesnictwo.id, name: 'Leśnictwo Audytowe' }, ctx);
  assert.equal(ostatni('forest_ranges', 'CREATE').detail.pozycja, 'Leśnictwo Audytowe');
});

test('pozycja założona przy okazji dokumentu ma w dzienniku autora', () => {
  ops.createOperation(operationInput({
    operationDate: dzis,
    supplierName: 'Tartak Zupełnie Nowy',
    vehiclePlate: 'SZA 99999',
  }), ctx);

  const kontrahent = listAudit({ entity: 'partners', limit: 50 }).items
    .find((i) => i.detail?.pozycja === 'Tartak Zupełnie Nowy');
  assert.ok(kontrahent, 'kontrahent założony przy księgowaniu musi zostawić ślad');
  assert.equal(kontrahent.user, ctx.user.email);
  assert.equal(kontrahent.ip, '127.0.0.1');
});

/* ============================ Ustawienia ============================== */

test('zmiana ustawienia zapisuje wartość przed i po', () => {
  updateSettings({ 'units.m3_to_mp': 2.5 }, ctx);
  updateSettings({ 'units.m3_to_mp': 3.1 }, ctx);

  const { zmiany } = ostatni('settings', 'UPDATE').detail;
  assert.deepEqual(zmiany['units.m3_to_mp'], { przed: 2.5, po: 3.1 });
  assert.deepEqual(Object.keys(zmiany), ['units.m3_to_mp'],
    'zapis jednego klucza nie może zrzucać całej konfiguracji');
});

/* ============================== Konta ================================= */

test('edycja konta pokazuje zmianę roli, a nie samą listę pól', () => {
  const konto = users.createUser({
    email: 'audyt@resinvest.local',
    fullName: 'Anna Audytowa',
    role: 'MAGAZYNIER',
    password: 'Poczatkowe-Haslo-2026!',
  }, ctx);

  users.updateUser(konto.id, { role: 'KIEROWNIK' }, ctx);

  const wpis = ostatni('users', 'UPDATE');
  assert.equal(wpis.detail.konto, 'audyt@resinvest.local');
  assert.deepEqual(wpis.detail.zmiany.role, { przed: 'MAGAZYNIER', po: 'KIEROWNIK' });
  assert.ok(!('permissions' in wpis.detail.zmiany),
    'uprawnienia wynikają z roli — powielone zalałyby wpis');
});

test('zmiana hasła jest odnotowana, ale sam skrót nigdy nie trafia do dziennika', () => {
  const konto = users.createUser({
    email: 'haslo@resinvest.local',
    fullName: 'Piotr Hasłowy',
    role: 'MAGAZYNIER',
    password: 'Poczatkowe-Haslo-2026!',
  }, ctx);

  users.updateUser(konto.id, { password: 'Zupelnie-Inne-Haslo-2026!' }, ctx);

  const wpis = ostatni('users', 'UPDATE');
  // Reset hasła bywa jedyną zmianą w żądaniu — wpis nie może wtedy wypaść
  // jako „nic się nie zmieniło”.
  assert.deepEqual(wpis.detail.zmiany.haslo, { przed: 'poprzednie', po: 'nowe' });

  const hash = db.value('SELECT password_hash FROM users WHERE id = :id', { id: konto.id });
  const caly = JSON.stringify(listAudit({ entity: 'users', limit: 500 }).items);
  assert.ok(!caly.includes(hash), 'skrót hasła nie może przeciekać do dziennika');
  assert.ok(!caly.includes('Zupelnie-Inne-Haslo-2026!'), 'hasło jawne tym bardziej');
  assert.ok(!caly.includes('passwordHash') && !caly.includes('password_hash'));
});

test('dezaktywacja konta zostawia ślad z przejściem stanu', () => {
  const konto = users.createUser({
    email: 'wylaczone@resinvest.local',
    fullName: 'Karol Wyłączony',
    role: 'MAGAZYNIER',
    password: 'Poczatkowe-Haslo-2026!',
  }, ctx);

  users.updateUser(konto.id, { isActive: false }, ctx);

  const { zmiany } = ostatni('users', 'UPDATE').detail;
  assert.deepEqual(zmiany.isActive, { przed: true, po: false });
});

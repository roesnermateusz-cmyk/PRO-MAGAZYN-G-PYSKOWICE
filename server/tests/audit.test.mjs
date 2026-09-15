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
const { listAudit, auditFilters } = await import('../src/middleware/audit.js');
const { permissionsFor } = await import('../src/middleware/auth.js');
const { labelFor, labelsFor, registeredEntities } = await import('../src/domain/field-labels.js');
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

/** Zmiana pojedynczego pola jako `{przed, po}` — skrót dla asercji. */
function zmiana(wpis, pole) {
  const z = wpis.changes.find((c) => c.field === pole);
  return z ? { przed: z.before, po: z.after } : undefined;
}

/** Etykieta, pod jaką pole pokaże się w historii zmian. */
const etykieta = (wpis, pole) => wpis.changes.find((c) => c.field === pole)?.label;

test.after(() => cleanupEnv());

/* ===================== Kartoteki przez fabrykę ========================= */

test('utworzenie pozycji kartoteki zapisuje stan początkowy', () => {
  const item = products.create({ name: 'Zrębka audytowa', category: 'ZREBKA' }, ctx);

  const wpis = ostatni('products', 'CREATE');
  assert.equal(wpis.entityId, item.id);
  assert.equal(wpis.user, ctx.user.email);
  assert.ok(wpis.timestamp, 'wpis musi mieć datę i godzinę');
  assert.equal(wpis.detail.pozycja, 'Zrębka audytowa');
  assert.deepEqual(zmiana(wpis, 'name'), { przed: null, po: 'Zrębka audytowa' });
  assert.deepEqual(zmiana(wpis, 'category'), { przed: null, po: 'ZREBKA' });
  // Historia ma być czytelna dla kontroli, a nie dla programisty.
  assert.equal(etykieta(wpis, 'category'), 'Kategoria');
});

test('edycja zapisuje wyłącznie pola, które faktycznie się zmieniły', () => {
  const item = products.create({ name: 'Trociny audytowe', category: 'PRODUKT_UBOCZNY' }, ctx);
  products.update(item.id, { name: 'Trociny audytowe', notes: 'partia próbna' }, ctx);

  const wpis = ostatni('products', 'UPDATE');
  assert.deepEqual(wpis.changes, [
    { field: 'notes', label: 'Uwagi', before: null, after: 'partia próbna' },
  ], 'nazwa przysłana bez zmiany nie może zaśmiecać dziennika');
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
  assert.deepEqual(zmiana(wpis, 'isActive'), { przed: true, po: false });
});

test('pojazdy i nadleśnictwa też trafiają do dziennika', () => {
  // Obie kartoteki miały zapis wyłącznie w trasach — i obie go nie miały.
  const pojazd = vehicles.create({ plate: 'SZA 12345', carrierName: 'Przewozy Testowe' }, ctx);
  assert.equal(ostatni('vehicles', 'CREATE').entityId, pojazd.id);

  const nadlesnictwo = forest.createDistrict({ name: 'Nadleśnictwo Audytowe', region: 'RDLP Katowice' }, ctx);
  const wpis = ostatni('forest_districts', 'CREATE');
  assert.equal(wpis.entityId, nadlesnictwo.id);
  assert.deepEqual(zmiana(wpis, 'region'), { przed: null, po: 'RDLP Katowice' });
  assert.equal(etykieta(wpis, 'region'), 'RDLP');

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

  const wpis = ostatni('settings', 'UPDATE');
  assert.deepEqual(zmiana(wpis, 'units.m3_to_mp'), { przed: 2.5, po: 3.1 });
  assert.equal(etykieta(wpis, 'units.m3_to_mp'), 'Przelicznik m³ → MP');
  assert.equal(wpis.changes.length, 1,
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
  assert.deepEqual(zmiana(wpis, 'role'), { przed: 'MAGAZYNIER', po: 'KIEROWNIK' });
  assert.equal(etykieta(wpis, 'role'), 'Rola');
  assert.ok(!wpis.changes.some((c) => c.field === 'permissions'),
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
  assert.deepEqual(zmiana(wpis, 'haslo'), { przed: 'poprzednie', po: 'nowe' });
  assert.equal(etykieta(wpis, 'haslo'), 'Hasło');

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

  assert.deepEqual(zmiana(ostatni('users', 'UPDATE'), 'isActive'), { przed: true, po: false });
});

/* ==================== Widok historii: filtry i zakres ================== */

test('filtry historii zwracają tylko to, co w dzienniku faktycznie jest', () => {
  const f = auditFilters();
  assert.ok(f.users.includes(ctx.user.email));
  assert.ok(f.actions.includes('CREATE') && f.actions.includes('UPDATE'));
  assert.ok(f.entities.includes('products'));
  // Lista jest budowana z samego dziennika, więc nie wystawia encji,
  // których nikt nie ruszał — filtr ma pokazywać rzeczywistość, nie słownik.
  assert.ok(!f.entities.includes('encja_ktorej_nie_ma'));
});

test('zawężenie po zdarzeniu, użytkowniku i dacie', () => {
  const tylkoUtworzenia = listAudit({ action: 'CREATE', limit: 500 });
  assert.ok(tylkoUtworzenia.items.every((i) => i.action === 'CREATE'));

  const cudze = listAudit({ userEmail: 'nikt@resinvest.local' });
  assert.equal(cudze.total, 0, 'filtr po użytkowniku nie może przepuszczać cudzych wpisów');

  const przyszlosc = listAudit({ from: '2099-01-01' });
  assert.equal(przyszlosc.total, 0);
});

test('szukanie po treści zmiany, z metaznakami LIKE włącznie', () => {
  products.create({ name: 'Zrębka 100% sucha', category: 'ZREBKA' }, ctx);

  assert.ok(listAudit({ q: 'Zrębka 100% sucha' }).total >= 1,
    'znak procenta w szukanym tekście ma być traktowany dosłownie');
  // Gdyby `%` trafiało do wzorca surowo, to zapytanie pasowałoby do wszystkiego.
  assert.equal(listAudit({ q: 'Zrębka 100%%%% sucha' }).total, 0);
});

test('zdarzenie bez porównania stanów niesie własne szczegóły', () => {
  const wpis = ostatni('operations', 'CREATE');
  assert.deepEqual(wpis.changes, [], 'zaksięgowanie dokumentu nie jest zmianą pola');
  assert.ok(wpis.detail.docNo, 'ale numer dokumentu musi być widoczny w historii');
});

/* ======================= Uprawnienie audit:read ======================== */

test('audytor i księgowość mają dostęp do historii, magazynier nie', () => {
  // Rola AUDYTOR istnieje po to, żeby czytać historię zmian. Wcześniej
  // dziennik stał za uprawnieniem `users:read`, którego audytor nie ma.
  assert.ok(permissionsFor('AUDYTOR').includes('audit:read'));
  assert.ok(permissionsFor('KSIEGOWY').includes('audit:read'));
  assert.ok(permissionsFor('KIEROWNIK').includes('audit:read'));
  assert.ok(!permissionsFor('MAGAZYNIER').includes('audit:read'),
    'magazynier wprowadza dokumenty, nie kontroluje cudzych zmian');

  // Audytor nadal NIE widzi kartoteki kont — to osobne uprawnienie.
  assert.ok(!permissionsFor('AUDYTOR').includes('users:read'));
});

/* ==================== Rejestr etykiet pól ============================= */

test('etykiety pól biorą się ze schematów walidacji, nie z osobnej listy', () => {
  // Gdyby etykiety były przepisywane ręcznie, rozjechałyby się z formularzem.
  assert.equal(labelFor('products', 'mpToTonne'), 'Przelicznik MP → tona');
  assert.equal(labelFor('partners', 'nip'), 'NIP');
  assert.equal(labelFor('vehicles', 'plate'), 'Numer rejestracyjny');
  assert.equal(labelFor('settings', 'rules.backdate_days'), 'Dozwolone wstecz (dni)');

  // Pole bez etykiety pokazuje własny klucz — historia ma być mniej czytelna,
  // nigdy pusta.
  assert.equal(labelFor('products', 'poleKtoregoNieMa'), 'poleKtoregoNieMa');
  assert.equal(labelFor('encjaKtorejNieMa', 'cokolwiek'), 'cokolwiek');
});

/* ============ Kompletność etykiet: żaden klucz API nie wycieka ========= */

test('każde pole widoczne w historii ma polską etykietę', () => {
  // Kartoteki pojazdów i nadleśnictw wypadły kiedyś z dziennika przez
  // przeoczenie w trasie. Ten test pilnuje bliźniaczego przeoczenia: nowa
  // kartoteka trafia do dziennika, ale bez `registerLabels`, więc kontrola
  // ogląda `mpToTonne` zamiast „Przelicznik MP → tona”.
  const { items } = listAudit({ limit: 1000 });
  const surowe = new Map();

  for (const wpis of items) {
    for (const { field, label } of wpis.changes) {
      // `labelFor` zwraca sam klucz, gdy encja nie ogłosiła etykiet.
      if (label === field && !/^[A-ZŁŚŻŹĆÓĘĄŃ]/.test(field)) {
        surowe.set(`${wpis.entity}.${field}`, true);
      }
    }
  }

  assert.deepEqual([...surowe.keys()], [],
    'te pola pokażą się w historii jako klucz API — brakuje registerLabels albo `label` w schemacie');
});

test('rejestr etykiet obejmuje każdą encję, która trafia do dziennika', () => {
  const zarejestrowane = new Set(registeredEntities());
  const wDzienniku = listAudit({ limit: 1000 }).items
    // Encje bez porównania stanów (operacje, logowania) etykiet nie potrzebują.
    .filter((i) => i.changes.length > 0)
    .map((i) => i.entity);

  const bezEtykiet = [...new Set(wDzienniku)].filter((e) => !zarejestrowane.has(e));
  assert.deepEqual(bezEtykiet, [],
    'encja zapisuje zmiany pól, ale nie ogłosiła etykiet przez registerLabels');
});

test('etykiety encji są kompletne i po polsku', () => {
  for (const encja of registeredEntities()) {
    const etykiety = labelsFor(encja);
    assert.ok(Object.keys(etykiety).length > 0, `${encja}: pusty zestaw etykiet`);
    for (const [pole, etykieta] of Object.entries(etykiety)) {
      assert.notEqual(etykieta, pole, `${encja}.${pole}: etykieta powiela klucz API`);
      assert.ok(etykieta.trim().length > 1, `${encja}.${pole}: etykieta pusta`);
    }
  }
});

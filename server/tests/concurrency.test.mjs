/**
 * Praca wielu użytkowników naraz.
 *
 * System stoi na jednym procesie Node i synchronicznym sterowniku SQLite,
 * więc same zapytania nie wykonują się równolegle — kolejkuje je pętla zdarzeń.
 * Groźne jest co innego i to sprawdzają te testy:
 *
 *  • DWIE OSOBY W JEDNYM DOKUMENCIE. Formularz korekty pracuje na migawce
 *    pobranej przy otwarciu. Bez blokady optymistycznej zapis z nieświeżego
 *    formularza cofa cudzą poprawkę i wygląda w rejestrze korekt na świadomą
 *    decyzję zapisującego.
 *  • NUMERACJA. Dwa dokumenty z tym samym numerem to dwa dokumenty, których
 *    nie da się rozróżnić w segregatorze ani w kontroli.
 *  • MODEL ODCZYTU. Salda utrzymują wyzwalacze; po serii przeplecionych
 *    zapisów muszą zgadzać się z księgą ruchów co do grosza.
 *  • ZAKRESY MAGAZYNÓW. Dwóch magazynierów pracujących naraz nie może
 *    zobaczyć swoich dokumentów nawzajem — także przez pamięć podręczną,
 *    która liczy raz, a oddaje wielu.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareEnv, cleanupEnv, testContext, operationInput } from './helpers.mjs';

prepareEnv('concurrency');

const { default: db } = await import('../src/db/index.js');
const { bootstrap } = await import('../src/bootstrap.js');
const ops = await import('../src/modules/operations/operations.service.js');
const { createUser } = await import('../src/modules/users/users.service.js');
const access = await import('../src/modules/catalog/warehouse-access.service.js');
const { warehouses } = await import('../src/modules/catalog/catalog.service.js');
const { checkStockBalances } = await import('../src/db/health.js');
const { currentStock } = await import('../src/modules/stock/stock.service.js');

bootstrap();

const admin = db.get("SELECT id, email FROM users WHERE role = 'ADMIN' LIMIT 1");
const adminCtx = testContext({ userId: admin.id });
const dzis = new Date().toISOString().slice(0, 10);

test.after(() => cleanupEnv());

/* ==================== Dwie osoby w jednym dokumencie =================== */

test('zapis na nieświeżej rewizji jest odrzucany, a nie cicho przyjmowany', () => {
  const { operation } = ops.createOperation(
    operationInput({ operationDate: dzis, quantity: 100 }), adminCtx,
  );

  // Kierownik i magazynier otwierają ten sam dokument — obaj widzą tę samą rewizję.
  const rewizjaKierownika = operation.revision;
  const rewizjaMagazyniera = operation.revision;

  // Magazynier zapisuje pierwszy: poprawia ilość.
  ops.updateOperation(operation.id, {
    ...operationInput({ operationDate: dzis, quantity: 120 }),
    revision: rewizjaMagazyniera,
    correctionReason: 'Poprawka ilości po ponownym pomiarze',
  }, adminCtx);

  // Kierownik zapisuje drugi, na migawce sprzed tamtej zmiany.
  assert.throws(
    () => ops.updateOperation(operation.id, {
      ...operationInput({ operationDate: dzis, quantity: 100, pricePurchase: 95 }),
      revision: rewizjaKierownika,
      correctionReason: 'Poprawka ceny',
    }, adminCtx),
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /został w międzyczasie zmieniony/);
      return true;
    },
  );

  // Najważniejsze: poprawka magazyniera ma przetrwać.
  assert.equal(ops.getOperation(operation.id).quantity, 120,
    'zapis z nieświeżego formularza nie może cofnąć cudzej zmiany');
});

test('po odświeżeniu formularza ta sama poprawka przechodzi', () => {
  const { operation } = ops.createOperation(
    operationInput({ operationDate: dzis, quantity: 50 }), adminCtx,
  );
  ops.updateOperation(operation.id, {
    ...operationInput({ operationDate: dzis, quantity: 60 }),
    revision: operation.revision,
    correctionReason: 'Pierwsza poprawka',
  }, adminCtx);

  // Odczyt świeżego stanu — tak zachowuje się użytkownik po komunikacie o kolizji.
  const swiezy = ops.getOperation(operation.id);
  const wynik = ops.updateOperation(operation.id, {
    ...operationInput({ operationDate: dzis, quantity: 60, pricePurchase: 95 }),
    revision: swiezy.revision,
    correctionReason: 'Druga poprawka, na aktualnej wersji',
  }, adminCtx);

  assert.equal(wynik.operation.pricePurchase, 95);
  assert.equal(wynik.operation.quantity, 60, 'poprzednia poprawka zostaje nietknięta');
  assert.equal(wynik.operation.revision, swiezy.revision + 1);
});

test('komunikat kolizji mówi, kto zmienił dokument', () => {
  const kierownik = createUser({
    email: 'kolizja@resinvest.local',
    fullName: 'Anna Kolizyjna',
    role: 'KIEROWNIK',
    password: 'Haslo-Kolizyjne-2026!',
  }, adminCtx);
  const kierownikCtx = testContext({ userId: kierownik.id, role: 'KIEROWNIK' });

  const { operation } = ops.createOperation(
    operationInput({ operationDate: dzis, quantity: 10 }), adminCtx,
  );
  ops.updateOperation(operation.id, {
    ...operationInput({ operationDate: dzis, quantity: 11 }),
    revision: operation.revision,
    correctionReason: 'Zmiana przez kierownika',
  }, kierownikCtx);

  assert.throws(
    () => ops.updateOperation(operation.id, {
      ...operationInput({ operationDate: dzis, quantity: 12 }),
      revision: operation.revision,
      correctionReason: 'Zmiana na starej wersji',
    }, adminCtx),
    // Bez nazwiska komunikat zmusza do zgadywania, z kim uzgodnić poprawkę.
    /Anna Kolizyjna/,
  );
});

test('wywołanie bez rewizji nadal działa — to droga wewnętrzna, nie formularz', () => {
  // `restoreCorrection` czyta stan świeżo w tej samej transakcji, więc stałej
  // migawki nie ma i blokada nie ma czego pilnować.
  const { operation } = ops.createOperation(
    operationInput({ operationDate: dzis, quantity: 20 }), adminCtx,
  );
  const wynik = ops.updateOperation(operation.id, {
    ...operationInput({ operationDate: dzis, quantity: 25 }),
    correctionReason: 'Zapis wewnętrzny bez rewizji',
  }, adminCtx);
  assert.equal(wynik.operation.quantity, 25);
});

test('storno w międzyczasie zamyka edycję jednoznacznym komunikatem', () => {
  const { operation } = ops.createOperation(
    operationInput({ operationDate: dzis, quantity: 30 }), adminCtx,
  );
  ops.cancelOperation(operation.id, { reason: 'Pomyłka przy przyjęciu' }, adminCtx);

  assert.throws(
    () => ops.updateOperation(operation.id, {
      ...operationInput({ operationDate: dzis, quantity: 31 }),
      revision: operation.revision,
      correctionReason: 'Poprawka po stornie',
    }, adminCtx),
    /anulowany/,
    'edycja anulowanego dokumentu ma się nie udać, i to zrozumiale',
  );
});

/* ========================= Numeracja dokumentów ======================== */

test('seria dokumentów nie powtarza numeru przy zapisach jeden po drugim', () => {
  const numery = [];
  for (let i = 0; i < 40; i += 1) {
    numery.push(ops.createOperation(
      operationInput({ operationDate: dzis, quantity: 1 }), adminCtx,
    ).operation.docNo);
  }
  assert.equal(new Set(numery).size, numery.length, 'numery muszą być unikalne');

  // Licznik jest ciągły: dziura oznaczałaby zgubiony dokument, nadmiar — duplikat.
  const kolejne = numery.map((n) => Number(n.split('/').pop()));
  for (let i = 1; i < kolejne.length; i += 1) {
    assert.equal(kolejne[i], kolejne[i - 1] + 1, `przerwa w numeracji przy ${numery[i]}`);
  }
});

test('numeracja przeplatana między seriami nie miesza liczników', () => {
  const przed = db.all('SELECT series, year, last_number FROM document_counters ORDER BY series');

  const zakupy = [];
  const sprzedaze = [];
  for (let i = 0; i < 10; i += 1) {
    zakupy.push(ops.createOperation(
      operationInput({ operationDate: dzis, quantity: 5 }), adminCtx,
    ).operation.docNo);
    sprzedaze.push(ops.createOperation(operationInput({
      type: 'SPRZEDAZ', operationDate: dzis, quantity: 1, unit: 'MP',
      recipientName: 'Odbiorca Testowy', priceSale: 200, supplierName: undefined,
    }), adminCtx).operation.docNo);
  }

  assert.equal(new Set([...zakupy, ...sprzedaze]).size, 20);
  assert.ok(zakupy.every((n) => n.startsWith('PZ/')));
  assert.ok(sprzedaze.every((n) => n.startsWith('WZ/')));

  // Każda seria podniosła swój licznik dokładnie o dziesięć.
  const po = db.all('SELECT series, year, last_number FROM document_counters ORDER BY series');
  for (const seria of ['PZ', 'WZ']) {
    const a = przed.find((r) => r.series === seria)?.last_number ?? 0;
    const b = po.find((r) => r.series === seria).last_number;
    assert.equal(b - a, 10, `licznik serii ${seria}`);
  }
});

/* ===================== Spójność modelu odczytu ========================= */

test('salda zgadzają się z księgą ruchów po serii przeplecionych zapisów', () => {
  const doKorekty = [];
  for (let i = 0; i < 15; i += 1) {
    const { operation } = ops.createOperation(
      operationInput({ operationDate: dzis, quantity: 10 + i }), adminCtx,
    );
    doKorekty.push(operation);
  }
  // Przeplot: korekta, storno, korekta — każda ścieżka zapisu rusza ruchy inaczej.
  for (const [i, op] of doKorekty.entries()) {
    const swiezy = ops.getOperation(op.id);
    if (i % 3 === 0) {
      ops.cancelOperation(op.id, { reason: 'Storno kontrolne' }, adminCtx);
    } else {
      ops.updateOperation(op.id, {
        ...operationInput({ operationDate: dzis, quantity: 100 + i }),
        revision: swiezy.revision,
        correctionReason: 'Korekta kontrolna',
      }, adminCtx);
    }
  }

  const raport = checkStockBalances();
  assert.equal(raport.mismatches.length, 0,
    `model odczytu rozjechał się z księgą: ${JSON.stringify(raport.mismatches)}`);
});

/* ================== Dwóch magazynierów, dwa place ====================== */

test('jednoczesna praca na dwóch placach nie miesza dokumentów ani stanów', () => {
  const zabrze = db.get("SELECT id, name FROM warehouses WHERE name = 'RiC Zabrze'");
  const rokitki = db.get("SELECT id, name FROM warehouses WHERE name = 'RiC Rokitki'");
  assert.ok(zabrze && rokitki, 'magazyny startowe muszą istnieć');

  const zrob = (email, nazwa, magazyn) => {
    const u = createUser({
      email, fullName: nazwa, role: 'MAGAZYNIER', password: 'Haslo-Magazyn-2026!',
    }, adminCtx);
    access.setUserWarehouses(u.id, [magazyn.id], adminCtx);
    return testContext({ userId: u.id, role: 'MAGAZYNIER' });
  };
  const a = zrob('plac-a@resinvest.local', 'Magazynier Zabrze', zabrze);
  const b = zrob('plac-b@resinvest.local', 'Magazynier Rokitki', rokitki);

  // Zapisy na przemian — tak, jak wyglądałaby praca dwóch osób w tej samej chwili.
  const naszeA = [];
  const naszeB = [];
  for (let i = 0; i < 6; i += 1) {
    naszeA.push(ops.createOperation(operationInput({
      operationDate: dzis, quantity: 7, warehouseTo: zabrze.name,
    }), a).operation.docNo);
    naszeB.push(ops.createOperation(operationInput({
      operationDate: dzis, quantity: 9, warehouseTo: rokitki.name,
    }), b).operation.docNo);
  }

  // Rejestr każdego z nich pokazuje wyłącznie jego plac — także po tym, jak
  // pamięć podręczna zdążyła policzyć listę dla tego drugiego.
  const rejestrA = ops.listOperations({ limit: 200 }, { user: a.user });
  const rejestrB = ops.listOperations({ limit: 200 }, { user: b.user });
  const numeryA = rejestrA.items.map((o) => o.docNo);
  const numeryB = rejestrB.items.map((o) => o.docNo);

  assert.ok(naszeA.every((n) => numeryA.includes(n)));
  assert.ok(naszeB.every((n) => numeryB.includes(n)));
  assert.ok(!numeryA.some((n) => naszeB.includes(n)),
    'dokumenty cudzego placu nie mogą wejść do rejestru');
  assert.ok(!numeryB.some((n) => naszeA.includes(n)));

  // To samo dla stanów: suma placu A nie może zawierać ruchów placu B.
  const stanA = currentStock({}, { user: a.user });
  const stanB = currentStock({}, { user: b.user });
  assert.ok(stanA.items.every((i) => i.warehouseId === zabrze.id));
  assert.ok(stanB.items.every((i) => i.warehouseId === rokitki.id));
});

test('odebranie dostępu działa natychmiast, także gdy ktoś właśnie pracuje', () => {
  const braszewice = db.get("SELECT id, name FROM warehouses WHERE name = 'RiC Brąszewice'");
  const u = createUser({
    email: 'odebrany@resinvest.local',
    fullName: 'Magazynier Przenoszony',
    role: 'MAGAZYNIER',
    password: 'Haslo-Magazyn-2026!',
  }, adminCtx);
  access.setUserWarehouses(u.id, [braszewice.id], adminCtx);
  const ctx = testContext({ userId: u.id, role: 'MAGAZYNIER' });

  ops.createOperation(operationInput({
    operationDate: dzis, quantity: 4, warehouseTo: braszewice.name,
  }), ctx);

  // Administrator przepina konto na inny plac w trakcie jego pracy.
  const zabrze = db.get("SELECT id FROM warehouses WHERE name = 'RiC Zabrze'");
  access.setUserWarehouses(u.id, [zabrze.id], adminCtx);

  // Kolejny zapis na poprzednim placu musi się odbić — bez czekania na
  // wygaśnięcie czegokolwiek i bez ponownego logowania.
  assert.throws(() => ops.createOperation(operationInput({
    operationDate: dzis, quantity: 4, warehouseTo: braszewice.name,
  }), ctx), /dostęp|magazyn/i);
});

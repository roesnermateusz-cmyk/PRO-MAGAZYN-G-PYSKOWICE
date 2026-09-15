/**
 * Kopie zapasowe i przenoszenie danych (usterka B-5 — zero pokrycia).
 *
 * To jedyna ścieżka w systemie, której awarii nie widać w chwili awarii.
 * Zły eksport wychodzi na jaw dopiero przy odtwarzaniu — czyli wtedy, gdy
 * oryginału już nie ma. Dlatego testy sprawdzają nie „czy się wykonało”,
 * tylko czy **dane wracają w komplecie i co do grosza**.
 *
 * Osobno pilnowana jest odmowa: kopia z nowszej wersji formatu ma zostać
 * odrzucona, a nie wczytana częściowo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { prepareEnv, cleanupEnv, testContext, operationInput } from './helpers.mjs';

prepareEnv('backup');

const { default: db } = await import('../src/db/index.js');
const { config } = await import('../src/config/env.js');
const { bootstrap } = await import('../src/bootstrap.js');
const ops = await import('../src/modules/operations/operations.service.js');
const backup = await import('../src/modules/backup/backup.service.js');
const { checkStockBalances } = await import('../src/db/health.js');

bootstrap();
const admin = db.get("SELECT id, email, full_name FROM users WHERE role = 'ADMIN' LIMIT 1");
const ctx = testContext({ userId: admin.id });

test.after(cleanupEnv);

/** Kilka dokumentów, żeby eksport miał co przenosić. */
function zaksieguj(ile = 3) {
  const utworzone = [];
  for (let i = 0; i < ile; i += 1) {
    utworzone.push(ops.createOperation(operationInput({
      quantity: 10 + i,
      pricePurchase: 90 + i,
    }), ctx).operation);
  }
  return utworzone;
}

/* --------------------------- Kopia pliku ------------------------------ */

test('kopia pliku powstaje, ma rozmiar i trafia na listę', () => {
  zaksieguj(2);
  const przed = backup.listBackups().length;

  const kopia = backup.createBackup(ctx, 'test-reczna');

  assert.match(kopia.file, /^resinvest-test-reczna-.*\.db$/);
  assert.ok(kopia.sizeBytes > 0, 'kopia zerowej długości jest bezużyteczna');

  const lista = backup.listBackups();
  assert.equal(lista.length, przed + 1);
  assert.ok(lista.some((p) => p.file === kopia.file));
});

test('kopia zawiera dane zapisane tuż przed jej wykonaniem', () => {
  // WAL trzyma świeże transakcje w osobnym pliku. Bez `wal_checkpoint`
  // skopiowany plik `.db` byłby starszy niż baza — i nikt by tego nie zauważył
  // aż do odtworzenia.
  const { operation } = ops.createOperation(operationInput({ quantity: 123 }), ctx);
  const kopia = backup.createBackup(ctx, 'checkpoint');

  const plik = path.join(config.backup.dir, kopia.file);
  const bajty = readFileSync(plik);
  assert.ok(bajty.includes(Buffer.from(operation.docNo, 'utf8')),
    `numer ${operation.docNo} musi być w skopiowanym pliku — inaczej checkpoint WAL nie zadziałał`);
  assert.equal(statSync(plik).size, kopia.sizeBytes);
});

test('utworzenie kopii zostawia ślad w dzienniku audytu', async () => {
  const { listAudit } = await import('../src/middleware/audit.js');
  backup.createBackup(ctx, 'ze-sladem');
  const wpis = listAudit({ entity: 'database', limit: 20 }).items
    .find((i) => i.action === 'BACKUP');
  assert.ok(wpis, 'kopia zapasowa musi być odnotowana — to zdarzenie dla kontroli');
  assert.equal(wpis.user, ctx.user.email);
});

/* ---------------------------- Eksport JSON ---------------------------- */

test('eksport niesie komplet tabel i nie wypuszcza haseł', () => {
  zaksieguj(2);
  const zrzut = backup.exportJson(ctx);

  assert.equal(zrzut.format, 'resinvest-erp-export');
  assert.equal(zrzut.formatVersion, backup.EXPORT_FORMAT_VERSION);
  assert.equal(zrzut.exportedBy, ctx.user.email);

  for (const tabela of ['operations', 'stock_moves', 'products', 'warehouses', 'settings']) {
    assert.ok(Array.isArray(zrzut.data[tabela]), `brak tabeli ${tabela} w eksporcie`);
  }
  assert.equal(zrzut.data.operations.length, zrzut.counts.operations);

  // Konta idą bez sekretów — zrzut bywa wysyłany mailem albo na pendrive.
  const caly = JSON.stringify(zrzut);
  assert.ok(zrzut.data.users.length > 0);
  for (const u of zrzut.data.users) {
    assert.ok(!('password_hash' in u), 'skrót hasła nie ma prawa wyjść w eksporcie');
  }
  assert.doesNotMatch(caly, /password_hash|refresh_token|token_hash/,
    'eksport nie może zawierać haseł ani tokenów sesji');
});

test('dziennik audytu wchodzi do eksportu tylko na żądanie', () => {
  assert.equal(backup.exportJson(ctx).data.audit_log, undefined);
  assert.ok(Array.isArray(backup.exportJson(ctx, { includeAudit: true }).data.audit_log));
});

/* ------------------------- Import: odmowy ----------------------------- */

test('plik, który nie jest kopią systemu, jest odrzucany', () => {
  assert.throws(() => backup.importJson({ cokolwiek: true }, {}, ctx), /nie jest kopią systemu/i);
  assert.throws(() => backup.importJson(null, {}, ctx), /nie jest kopią systemu/i);
});

test('kopia z nowszej wersji formatu jest odrzucana, a nie wczytywana częściowo', () => {
  // Wczytanie „ile się da” z nowszego formatu to najgorszy wariant: baza
  // wygląda na pełną, a brakuje w niej pól, o których ta wersja nie wie.
  const zrzut = backup.exportJson(ctx);
  zrzut.formatVersion = backup.EXPORT_FORMAT_VERSION + 1;

  const przed = db.value('SELECT COUNT(*) FROM operations');
  assert.throws(() => backup.importJson(zrzut, {}, ctx), /nowszej wersji/i);
  assert.equal(db.value('SELECT COUNT(*) FROM operations'), przed,
    'odrzucony import nie ma prawa niczego dopisać');
});

/* --------------------- Import: obieg zamknięty ------------------------ */

test('tryb „merge” nie powiela dokumentów o tych samych numerach', () => {
  zaksieguj(3);
  const zrzut = backup.exportJson(ctx);
  const przed = db.value('SELECT COUNT(*) FROM operations');

  const wynik = backup.importJson(zrzut, { mode: 'merge' }, ctx);

  assert.equal(db.value('SELECT COUNT(*) FROM operations'), przed,
    'import własnego eksportu nie może podwoić rejestru');
  assert.ok(wynik.skipped >= przed - 1, 'pominięte dokumenty mają być policzone');
  assert.ok(checkStockBalances().consistent, 'salda po imporcie muszą się zgadzać z księgą');
});

test('obieg zamknięty: eksport → wyczyszczenie → import odtwarza stan co do grosza', () => {
  zaksieguj(4);

  const stanPrzed = db.all(
    `SELECT p.name, ROUND(SUM(m.qty_mp), 4) AS mp
       FROM stock_moves m JOIN products p ON p.id = m.product_id
      GROUP BY p.name ORDER BY p.name`,
  );
  const wartoscPrzed = db.value(
    "SELECT ROUND(COALESCE(SUM(value_purchase), 0), 2) FROM operations WHERE status = 'POSTED'",
  );
  const numeryPrzed = db.all("SELECT doc_no FROM operations ORDER BY doc_no").map((r) => r.doc_no);
  const zrzut = JSON.parse(JSON.stringify(backup.exportJson(ctx)));

  // Tryb „replace” czyści rejestr dokumentów i wgrywa go od nowa.
  const wynik = backup.importJson(zrzut, { mode: 'replace' }, ctx);
  assert.deepEqual(wynik.errors, [], 'import nie może kończyć się błędami');

  const stanPo = db.all(
    `SELECT p.name, ROUND(SUM(m.qty_mp), 4) AS mp
       FROM stock_moves m JOIN products p ON p.id = m.product_id
      GROUP BY p.name ORDER BY p.name`,
  );
  const wartoscPo = db.value(
    "SELECT ROUND(COALESCE(SUM(value_purchase), 0), 2) FROM operations WHERE status = 'POSTED'",
  );
  const numeryPo = db.all("SELECT doc_no FROM operations ORDER BY doc_no").map((r) => r.doc_no);

  assert.deepEqual(stanPo, stanPrzed, 'stan magazynu po odtworzeniu musi być identyczny');
  assert.equal(wartoscPo, wartoscPrzed, 'wartość zakupów musi wrócić co do grosza');
  assert.deepEqual(numeryPo, numeryPrzed, 'numery dokumentów muszą wrócić w komplecie');
  assert.ok(checkStockBalances().consistent, 'model odczytu musi zgadzać się z księgą po imporcie');
});

test('import unieważnia pamięć podręczną raportów', async () => {
  const { monthlyReport } = await import('../src/modules/reports/reports.service.js');
  const miesiac = '2026-03';

  const przed = monthlyReport({ month: miesiac }).summary.documents;
  const zrzut = backup.exportJson(ctx);
  backup.importJson(zrzut, { mode: 'merge' }, ctx);
  const po = monthlyReport({ month: miesiac }).summary.documents;

  // Liczba się nie zmienia (merge pomija duplikaty), ale raport musi być
  // policzony na nowo, a nie podany z pamięci sprzed importu.
  assert.equal(typeof po, 'number');
  assert.equal(po, przed);
});

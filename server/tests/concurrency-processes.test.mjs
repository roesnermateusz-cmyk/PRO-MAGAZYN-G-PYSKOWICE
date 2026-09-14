/**
 * Rywalizacja o bazę między OSOBNYMI PROCESAMI.
 *
 * Pozostałe testy współbieżności pracują w jednym procesie, więc sprawdzają
 * logikę, ale nie sam sterownik: `node:sqlite` jest synchroniczny, a pętla
 * zdarzeń i tak ustawia zapytania w kolejce. Tutaj piszą naprawdę równolegle
 * cztery procesy systemowe — SQLite musi sobie poradzić blokadami WAL.
 *
 * Co to realnie sprawdza:
 *
 *  • że `PRAGMA busy_timeout` jest ustawiony i wystarczający — bez niego
 *    drugi proces dostaje `SQLITE_BUSY` i księgowanie po prostu się wywala;
 *  • że licznik numeracji jest **atomowy**. `INSERT … ON CONFLICT DO UPDATE
 *    … RETURNING` wykonuje się jako jedna operacja; gdyby ktoś przepisał to
 *    na „odczytaj, dodaj jeden, zapisz”, dwa procesy nadałyby ten sam numer
 *    i w segregatorze leżałyby dwa różne dokumenty PZ/2026/000123;
 *  • że wyzwalacze sald wytrzymują zapisy spoza własnego procesu.
 *
 * Docelowe wdrożenie to jeden proces, więc scenariusz jest nietypowy —
 * ale zdarza się naprawdę: ktoś uruchamia drugą kopię programu „bo pierwsza
 * się zawiesiła”, albo skrypt konserwacyjny chodzi przy włączonym serwerze.
 * Wtedy ma nie powstać cicha niespójność, tylko poprawne dokumenty.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareEnv, cleanupEnv } from './helpers.mjs';

const uruchom = promisify(execFile);
const KATALOG = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(KATALOG, 'workers', 'post-documents.mjs');

const tempDir = prepareEnv('concurrency-processes');
const PLIK_BAZY = process.env.DB_FILE;

const { default: db } = await import('../src/db/index.js');
const { bootstrap } = await import('../src/bootstrap.js');
const { checkStockBalances } = await import('../src/db/health.js');

bootstrap();

test.after(() => cleanupEnv());

const PROCESOW = 4;
const NA_PROCES = 15;

test('cztery procesy piszące naraz nie powielają numeru dokumentu', async () => {
  const przedDokumentow = db.value('SELECT COUNT(*) FROM operations');

  // Zamknięcie własnego połączenia nie jest potrzebne — WAL dopuszcza wielu
  // piszących, byle każdy czekał na swoją kolej (stąd `busy_timeout`).
  const wyniki = await Promise.all(
    Array.from({ length: PROCESOW }, (_, i) => uruchom(
      process.execPath,
      ['--disable-warning=ExperimentalWarning', WORKER, PLIK_BAZY, String(NA_PROCES), `P${i + 1}`],
      { cwd: KATALOG, timeout: 120000 },
    )),
  );

  const numery = wyniki.flatMap((w) => JSON.parse(w.stdout).numery);
  assert.equal(numery.length, PROCESOW * NA_PROCES, 'każdy proces miał zaksięgować swoje');
  assert.equal(new Set(numery).size, numery.length,
    `powtórzone numery dokumentów: ${numery.filter((n, i) => numery.indexOf(n) !== i)}`);

  // Baza widzi dokładnie tyle dokumentów, ile procesy zgłosiły.
  const po = db.value('SELECT COUNT(*) FROM operations');
  assert.equal(po - przedDokumentow, PROCESOW * NA_PROCES);

  // I nie ma duplikatu numeru w samej tabeli — gdyby dwa procesy trafiły
  // w ten sam numer, w rejestrze leżałyby dwa nierozróżnialne dokumenty.
  const duplikaty = db.all(
    'SELECT doc_no, COUNT(*) AS ile FROM operations GROUP BY doc_no HAVING ile > 1',
  );
  assert.deepEqual(duplikaty, [], 'numer dokumentu musi być niepowtarzalny');
});

test('salda wytrzymują zapisy spoza własnego procesu', () => {
  // Wyzwalacze sald działają w bazie, nie w kodzie serwisu — właśnie po to,
  // żeby zapis z dowolnego procesu aktualizował model odczytu tak samo.
  const raport = checkStockBalances();
  assert.equal(raport.mismatches.length, 0,
    `model odczytu rozjechał się z księgą: ${JSON.stringify(raport.mismatches)}`);
});

test('licznik serii zgadza się z liczbą zaksięgowanych dokumentów', () => {
  const licznik = db.get(
    "SELECT last_number FROM document_counters WHERE series = 'PZ' AND year = :rok",
    { rok: new Date().getFullYear() },
  );
  const zaksiegowane = db.value("SELECT COUNT(*) FROM operations WHERE doc_no LIKE 'PZ/%'");
  assert.equal(licznik.last_number, zaksiegowane,
    'licznik nie może wyprzedzać ani zostawać w tyle za rejestrem');
});

test('katalog tymczasowy testu to naprawdę jedna baza dla wszystkich procesów', () => {
  // Zabezpieczenie przed testem, który niczego nie sprawdza: gdyby procesy
  // potomne pisały gdzie indziej, powyższe asercje przechodziłyby na pustej
  // bazie i nikt by się nie zorientował.
  assert.ok(PLIK_BAZY.startsWith(tempDir));
  assert.ok(db.value('SELECT COUNT(*) FROM operations') >= PROCESOW * NA_PROCES);
});

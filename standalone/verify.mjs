#!/usr/bin/env node
/**
 * Kontrola zgodności silników.
 *
 * Wersja jednoplikowa wykonuje ten sam kod serwera, ale na innym sterowniku
 * bazy (SQLite w WebAssembly zamiast `node:sqlite`). Ten skrypt sprawdza, że
 * różnica sterownika nie zmienia ani jednej liczby: generuje dane
 * demonstracyjne po stronie serwera, robi to samo w przeglądarce w pliku
 * jednoplikowym i porównuje podsumowania co do grosza.
 *
 * Generator danych jest powtarzalny w obrębie jednego dnia, więc obie strony
 * muszą wyjść z tego samego ziarna i tej samej daty — stąd jedno uruchomienie.
 *
 *   node standalone/verify.mjs
 *
 * Wymaga Playwright (dostępny w środowisku deweloperskim, nie w pakiecie).
 */
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HTML = path.join(ROOT, 'dist', 'ResInvestERP.html');

if (!existsSync(HTML)) {
  console.error('Brak dist/ResInvestERP.html — uruchom najpierw: npm run build:html');
  process.exit(2);
}

/* ------------------------- Strona serwerowa ---------------------------- */

const temp = mkdtempSync(path.join(tmpdir(), 'resinvest-verify-'));
process.env.NODE_ENV = 'test';
process.env.DB_FILE = path.join(temp, 'verify.db');
process.env.ATTACHMENTS_DIR = path.join(temp, 'zalaczniki');
process.env.BACKUP_DIR = path.join(temp, 'kopie');
process.env.LOG_LEVEL = 'error';
process.env.AUTH_SECRET = 'kontrola-zgodnosci-silnikow-minimum-32-znaki';

const { default: db } = await import('../server/src/db/index.js');
const { bootstrap } = await import('../server/src/bootstrap.js');
const { seedDatabase } = await import('../server/src/seed/demo-seed.js');
const { readFileSync } = await import('node:fs');

const round3 = (n) => Math.round(n * 1000) / 1000;

bootstrap();
const admin = db.get("SELECT id, email, full_name, role FROM users WHERE role = 'ADMIN' ORDER BY created_at LIMIT 1");
const seed = JSON.parse(readFileSync(path.join(ROOT, 'server/seed/demo-data.json'), 'utf8'));
seedDatabase(seed, {
  ctx: { user: { id: admin.id, email: admin.email, fullName: admin.full_name, role: admin.role }, ip: '127.0.0.1', userAgent: 'verify' },
});

const { dashboard, monthlyReport } = await import('../server/src/modules/reports/reports.service.js');
const serverSide = snapshot(dashboard({}), monthlyReport({ month: new Date().toISOString().slice(0, 7) }));

/** Zestaw liczb, które muszą się zgadzać po obu stronach. */
function snapshot(dash, monthly) {
  return {
    dokumenty: dash.turnover.documents,
    stanMp: dash.stock.totals.qtyMp,
    stanTony: dash.stock.totals.qtyTonne,
    stanGj: dash.stock.totals.energyGj,
    zakupy: dash.turnover.purchaseValue,
    sprzedaz: dash.turnover.saleValue,
    marza: dash.turnover.grossMargin,
    produkcjaMp: dash.turnover.productionMp,
    bilansBO: dash.balance.opening,
    bilansBZ: dash.balance.closing,
    trendPunkty: dash.trend.length,
    miesiacDokumenty: monthly.summary.documents,
    miesiacMarza: monthly.summary.grossMargin,
    miesiacKm: monthly.summary.distanceKm,
    miesiacBO: round3(monthly.products.reduce((a, p) => a + p.opening.qtyMp, 0)),
    miesiacBZ: round3(monthly.products.reduce((a, p) => a + p.closing.qtyMp, 0)),
    produkty: dash.stock.byProduct.map((p) => `${p.productName}=${p.qtyMp}`).sort().join('|'),
  };
}

/* ------------------------ Strona jednoplikowa --------------------------- */

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  // Projekt nie ma zależności produkcyjnych, więc Playwright zwykle mieszka
  // poza nim. `PLAYWRIGHT_PATH` wskazuje katalog `node_modules` z instalacją.
  if (process.env.PLAYWRIGHT_PATH) {
    try {
      const { createRequire } = await import('node:module');
      const requireFrom = createRequire(path.join(process.env.PLAYWRIGHT_PATH, 'wejscie.cjs'));
      ({ chromium } = requireFrom('playwright'));
    } catch (err) {
      console.error(`Nie udało się wczytać Playwright z PLAYWRIGHT_PATH: ${err.message}`);
      process.exit(2);
    }
  }
}
if (!chromium) {
  console.error(
    'Brak pakietu Playwright. Kontrola zgodności uruchamia prawdziwą przeglądarkę,\n'
    + 'więc wymaga go w środowisku deweloperskim (do pakietu instalacyjnego nie wchodzi):\n'
    + '  npm install --no-save playwright\n'
    + 'albo wskazanie istniejącej instalacji: NODE_PATH=<katalog>/node_modules node standalone/verify.mjs',
  );
  process.exit(2);
}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const context = await browser.newContext();
const page = await context.newPage();
const failures = [];
page.on('pageerror', (e) => failures.push(String(e)));

await page.goto(`file://${HTML}`);
await page.waitForSelector('[data-demo]', { timeout: 60000 });
await page.click('[data-demo]');
await page.waitForSelector('[data-operator]:not([disabled])', { timeout: 600000 });
// Wskazanie operatora jest warunkiem odpowiedzi API — kontrola uprawnień
// działa tu tak samo, jak w wersji sieciowej.
await page.click('[data-operator]');
await page.waitForSelector('.viz-hero, .empty', { timeout: 60000 });

const browserSide = await page.evaluate(async () => {
  const api = window.__resinvestApi;
  const month = new Date().toISOString().slice(0, 7);
  const dash = await api.get('/reports/dashboard');
  const monthly = await api.get('/reports/monthly', { month });
  return { dash, monthly };
});
await browser.close();
rmSync(temp, { recursive: true, force: true });

const clientSide = snapshot(browserSide.dash, browserSide.monthly);

/* ------------------------------ Porównanie ------------------------------ */

let bad = 0;
console.log('\n  pole                serwer                    jednoplikowa');
console.log('  ' + '─'.repeat(66));
for (const key of Object.keys(serverSide)) {
  const a = serverSide[key];
  const b = clientSide[key];
  const same = String(a) === String(b);
  if (!same) bad += 1;
  const show = (v) => (String(v).length > 24 ? `${String(v).slice(0, 21)}…` : String(v));
  console.log(`  ${same ? '✓' : '✗'} ${key.padEnd(16)} ${show(a).padEnd(25)} ${show(b)}`);
}
if (failures.length) {
  bad += failures.length;
  console.log('\n  Błędy w przeglądarce:');
  for (const f of failures.slice(0, 5)) console.log(`   ${f}`);
}
console.log(bad
  ? `\n✗ ${bad} niezgodności — silniki się rozjeżdżają.\n`
  : '\n✓ Oba silniki dają identyczne liczby.\n');
process.exit(bad ? 1 : 0);

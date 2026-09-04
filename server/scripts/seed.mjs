#!/usr/bin/env node
/**
 * Generator przykładowych danych testowych.
 *
 *   npm run seed          — dopisuje dane do istniejącej bazy
 *   npm run seed:reset    — czyści rejestr dokumentów i generuje od nowa
 *
 * Dane powstają przez normalną warstwę serwisową, więc przechodzą tę samą
 * walidację co ręczne wprowadzanie — seed jest jednocześnie testem dymnym
 * całej ścieżki księgowania.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import db from '../src/db/index.js';
import { bootstrap } from '../src/bootstrap.js';
import { createUser } from '../src/modules/users/users.service.js';
import { warehouses, partners, vehicles, forest, loadingPlaces, products } from '../src/modules/catalog/catalog.service.js';
import { createOperation } from '../src/modules/operations/operations.service.js';
import { createChain } from '../src/modules/operations/chain.service.js';

const SEED_FILE = path.join(fileURLToPath(new URL('../seed', import.meta.url)), 'demo-data.json');
const seed = JSON.parse(readFileSync(SEED_FILE, 'utf8'));
const reset = process.argv.includes('--reset');

/* Deterministyczny generator — ten sam seed daje ten sam zestaw danych. */
let rngState = 20260901;
const rnd = () => {
  rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
  return rngState / 0x7fffffff;
};
const between = (min, max, decimals = 0) => {
  const value = min + rnd() * (max - min);
  return Number(value.toFixed(decimals));
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

const dayString = (offsetDays) => {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return d.toISOString().slice(0, 10);
};

console.log('› Inicjalizacja bazy…');
bootstrap();

const admin = db.get("SELECT id, email, full_name, role FROM users WHERE role = 'ADMIN' ORDER BY created_at LIMIT 1");
const ctx = {
  user: { id: admin.id, email: admin.email, fullName: admin.full_name, role: admin.role },
  ip: '127.0.0.1',
  userAgent: 'seed-script',
};

if (reset) {
  console.log('› Czyszczenie rejestru dokumentów…');
  db.tx(() => {
    db.run('DELETE FROM stock_moves');
    db.run('DELETE FROM corrections');
    db.run('DELETE FROM attachments');
    db.run('DELETE FROM operations');
    db.run('DELETE FROM stock_snapshots');
    db.run('DELETE FROM periods');
    db.run('DELETE FROM document_counters');
  });
}

/* ----------------------------- Użytkownicy ---------------------------- */

console.log('› Konta użytkowników…');
const createdUsers = [];
for (const u of seed.uzytkownicy) {
  if (db.get('SELECT 1 AS x FROM users WHERE email = :email', { email: u.email })) continue;
  createUser({ ...u, isActive: true, mustChangePassword: true }, ctx);
  createdUsers.push(u);
}

/* ------------------------------ Kartoteki ----------------------------- */

console.log('› Kartoteki…');
for (const w of seed.magazyny) {
  if (!db.get('SELECT 1 AS x FROM warehouses WHERE name = :name', { name: w.name })) warehouses.create(w);
}
for (const p of seed.kontrahenci) {
  if (!partners.findByName(p.name)) partners.create(p);
}
for (const v of seed.pojazdy) {
  if (!db.get('SELECT 1 AS x FROM vehicles WHERE plate = :plate', { plate: v.plate })) vehicles.create(v);
}
for (const d of seed.nadlesnictwa) {
  const district = forest.createDistrict({ name: d.name, region: d.region });
  for (const range of d.lesnictwa) forest.createRange({ districtId: district.id, name: range });
}
for (const place of seed.miejscaZaladunku) loadingPlaces.ensure(place);

/* ------------------------------ Dokumenty ----------------------------- */

const scenarios = seed.scenariusze;
const signatures = ['Piotr Nowak', 'Anna Kowalczyk', 'Mateusz Roesner'];
const stats = { chains: 0, purchases: 0, sales: 0, documents: 0 };

const transport = () => {
  const carrier = pick(scenarios.przewoznicy);
  const km = between(25, 130);
  return {
    carrierName: carrier.nazwa,
    vehiclePlate: pick(carrier.pojazdy),
    distanceKm: km,
    transportCost: Number((km * carrier.stawkaZlKm).toFixed(2)),
  };
};

console.log('› Generowanie dokumentów za ostatnie 60 dni…');

for (let offset = 60; offset >= 0; offset -= 1) {
  const day = dayString(offset);
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  if (weekday === 0) continue;                       // niedziela — brak pracy
  if (weekday === 6 && rnd() > 0.35) continue;       // sobota — praca sporadyczna

  /* 1–3 łańcuchy terenowe dziennie: zakup → zużycie → produkcja (→ sprzedaż). */
  const chainCount = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < chainCount; i += 1) {
    const s = pick(scenarios.zakupySurowca);
    const production = pick(scenarios.produkcja);
    const sellDirectly = rnd() > 0.45;
    const sale = pick(scenarios.sprzedaz.filter((x) => x.produkt === production.produkt))
      ?? pick(scenarios.sprzedaz);
    const m3 = between(s.m3Min, s.m3Max, 1);
    const tr = transport();

    try {
      const result = createChain({
        purchase: {
          operationDate: day,
          loadingDate: day,
          productName: s.produkt,
          quantity: m3,
          unit: 'M3',
          grade: rnd() > 0.5 ? 'B' : 'A',
          supplierName: s.dostawca,
          forestDistrict: s.nadlesnictwo,
          forestRange: s.lesnictwo,
          haulageNoteNo: `KW/${day.replace(/-/g, '')}/${String(i + 1).padStart(2, '0')}`,
          loadingPlace: pick(seed.miejscaZaladunku),
          certificate: 'KZR',
          pricePurchase: between(s.cenaMin, s.cenaMax, 2),
          chippingMode: rnd() > 0.4 ? 'wynajęte' : 'własne',
          chippingPrice: between(production.kosztRabaniaMin, production.kosztRabaniaMax, 2),
          signature: pick(signatures),
          ...tr,
        },
        chain: {
          produceChips: true,
          sellDirectly,
          chipProductName: production.produkt,
          chipQuantityMp: Number((m3 * 4 * production.uzysk).toFixed(2)),
          saleRecipient: sellDirectly ? sale.odbiorca : undefined,
          salePrice: sellDirectly ? between(sale.cenaMin, sale.cenaMax, 2) : undefined,
          saleUnit: 'MP',
        },
      }, ctx);
      stats.chains += 1;
      stats.documents += result.operations.length;
    } catch (err) {
      console.warn(`  ! ${day}: ${err.message}`);
    }
  }

  /* Zakup produktów ubocznych z tartaku — co kilka dni. */
  if (rnd() > 0.7) {
    const s = pick(scenarios.zakupyPozostale);
    const tr = transport();
    try {
      createOperation({
        type: 'ZAKUP',
        operationDate: day,
        productName: s.produkt,
        quantity: between(s.iloscMin, s.iloscMax, 1),
        unit: s.jednostka,
        supplierName: s.dostawca,
        loadingPlace: 'Tartak Gliwice — rampa nr 2',
        certificate: 'SURE',
        pricePurchase: between(s.cenaMin, s.cenaMax, 2),
        signature: pick(signatures),
        ...tr,
      }, ctx);
      stats.purchases += 1;
      stats.documents += 1;
    } catch (err) {
      console.warn(`  ! ${day}: ${err.message}`);
    }
  }

  /* Sprzedaż z placu — co kilka dni, o ile jest z czego. */
  if (rnd() > 0.6) {
    const sale = pick(scenarios.sprzedaz);
    const product = products.findByName(sale.produkt);
    const onHand = product
      ? db.value('SELECT COALESCE(SUM(qty_mp), 0) FROM stock_moves WHERE product_id = :id', { id: product.id })
      : 0;
    if (onHand > 60) {
      const tr = transport();
      try {
        createOperation({
          type: 'SPRZEDAZ',
          operationDate: day,
          productName: sale.produkt,
          quantity: Number(Math.min(onHand * 0.6, between(60, 220, 1)).toFixed(2)),
          unit: 'MP',
          recipientName: sale.odbiorca,
          certificate: 'KZR',
          priceSale: between(sale.cenaMin, sale.cenaMax, 2),
          haulageNoteNo: `WZ/${day.replace(/-/g, '')}`,
          signature: pick(signatures),
          ...tr,
        }, ctx);
        stats.sales += 1;
        stats.documents += 1;
      } catch (err) {
        console.warn(`  ! ${day}: ${err.message}`);
      }
    }
  }
}

/* ------------------------------ Podsumowanie -------------------------- */

const summary = db.get(`
  SELECT COUNT(*) AS documents,
         ROUND(SUM(value_purchase), 2) AS purchase,
         ROUND(SUM(value_sale), 2)     AS sale,
         ROUND(SUM(transport_cost), 2) AS transport
    FROM operations WHERE status = 'POSTED'`);
const stock = db.all('SELECT product_name, ROUND(qty_mp, 2) AS mp FROM v_stock_current WHERE ABS(qty_mp) > 0.01 ORDER BY qty_mp DESC');

console.log('\n╭─ Dane testowe wygenerowane ────────────────────────────────╮');
console.log(`│  Łańcuchy terenowe   : ${stats.chains}`);
console.log(`│  Dokumenty łącznie   : ${summary.documents}`);
console.log(`│  Wartość zakupów     : ${summary.purchase ?? 0} zł`);
console.log(`│  Wartość sprzedaży   : ${summary.sale ?? 0} zł`);
console.log(`│  Koszty transportu   : ${summary.transport ?? 0} zł`);
console.log('├─ Stan magazynowy ──────────────────────────────────────────┤');
for (const s of stock) console.log(`│  ${s.product_name.padEnd(38)} ${String(s.mp).padStart(10)} MP`);
if (createdUsers.length) {
  console.log('├─ Konta testowe (hasło do zmiany przy 1. logowaniu) ────────┤');
  for (const u of createdUsers) console.log(`│  ${u.role.padEnd(11)} ${u.email.padEnd(28)} ${u.password}`);
}
console.log('╰────────────────────────────────────────────────────────────╯\n');

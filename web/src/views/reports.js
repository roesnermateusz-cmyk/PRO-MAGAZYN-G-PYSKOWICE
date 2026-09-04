/**
 * Raporty: miesięczny, transportowy, kontrahenci i zestawienie certyfikacyjne.
 * Wszystkie zakładki są przygotowane do wydruku (styl `@media print`).
 */
import api from '../core/api.js';
import { esc, on } from '../core/dom.js';
import { qty, qty2, int, money, moneyShort, date, monthLabel, currentMonth, firstOfMonth, lastOfMonth } from '../core/format.js';
import { pageHead, kpi, empty, loading, toast, toastError, alertBox } from '../core/ui.js';
import { ICONS } from '../components/icons.js';
import { downloadHandler } from './_shared.js';

const TABS = [
  { id: 'miesiac', label: 'Raport miesięczny' },
  { id: 'transport', label: 'Transport' },
  { id: 'kontrahenci', label: 'Kontrahenci' },
  { id: 'certyfikacja', label: 'Certyfikacja KZR/SURE' },
];

const state = {
  tab: 'miesiac',
  month: currentMonth(),
  from: firstOfMonth(),
  to: lastOfMonth(),
};

export async function renderReports(view, params = {}) {
  if (params.tab && TABS.some((t) => t.id === params.tab)) state.tab = params.tab;
  view.innerHTML = loading('Przygotowywanie raportu…');
  await refresh(view);
}

async function refresh(view) {
  const head = pageHead('Raporty', 'Zestawienia okresowe i kontrolne',
    `<button class="btn" data-act="print">${ICONS.print} Drukuj</button>
     ${state.tab === 'miesiac' ? `<button class="btn" data-act="csv">${ICONS.download} CSV</button>` : ''}`)
    + `<div class="chips">${TABS.map((t) =>
        `<button data-tab="${t.id}" class="${state.tab === t.id ? 'on' : ''}">${esc(t.label)}</button>`).join('')}</div>`;

  view.innerHTML = head + loading();

  let body;
  try {
    if (state.tab === 'miesiac') body = await monthlyTab();
    else if (state.tab === 'transport') body = await transportTab();
    else if (state.tab === 'kontrahenci') body = await partnersTab();
    else body = await certificationTab();
  } catch (err) {
    toastError(err);
    body = empty('Nie udało się wczytać raportu', err.message);
  }

  view.innerHTML = head + body;
  bind(view);
}

function bind(view) {
  on(view, 'click', '[data-tab]', (el) => { state.tab = el.dataset.tab; refresh(view); });
  view.querySelector('[data-act="print"]')?.addEventListener('click', () => window.print());
  view.querySelector('[data-act="csv"]')?.addEventListener('click', downloadHandler(
    '/reports/monthly/export.csv', () => ({ month: state.month }),
    `raport-${state.month}.csv`, 'Plik CSV został pobrany',
  ));
  view.querySelector('#rMonth')?.addEventListener('change', (e) => {
    state.month = e.target.value;
    state.from = firstOfMonth(state.month);
    state.to = lastOfMonth(state.month);
    refresh(view);
  });
  view.querySelector('#rFrom')?.addEventListener('change', (e) => { state.from = e.target.value; refresh(view); });
  view.querySelector('#rTo')?.addEventListener('change', (e) => { state.to = e.target.value; refresh(view); });
}

const rangeToolbar = () => `<div class="toolbar">
  <input type="date" id="rFrom" value="${esc(state.from)}" aria-label="Data od">
  <input type="date" id="rTo" value="${esc(state.to)}" aria-label="Data do">
  <span class="count-pill">${date(state.from)} – ${date(state.to)}</span>
</div>`;

/* ------------------------- Raport miesięczny --------------------------- */

async function monthlyTab() {
  const r = await api.get('/reports/monthly', { month: state.month });
  const s = r.summary;

  return `<div class="toolbar">
      <input type="month" id="rMonth" value="${esc(state.month)}" aria-label="Miesiąc">
      <span class="count-pill">${esc(r.monthLabel)} · okres ${r.status === 'CLOSED' ? 'zamknięty' : 'otwarty'}</span>
    </div>`
    + (r.status === 'CLOSED'
      ? alertBox('success', 'Okres zamknięty — dane są utrwalone i nie zmienią się bez świadomego otwarcia miesiąca.')
      : alertBox('info', 'Okres otwarty — wartości mogą się jeszcze zmienić. Zamknij miesiąc po zakończeniu księgowania.'))
    + `<div class="kpi-grid">
        ${kpi({ label: 'Dokumenty', value: int(s.documents), icon: 'list' })}
        ${kpi({ label: 'Zakupy', value: moneyShort(s.purchaseValue), icon: 'download' })}
        ${kpi({ label: 'Sprzedaż', value: moneyShort(s.saleValue), icon: 'upload', variant: 'gold' })}
        ${kpi({ label: 'Koszty rąbania', value: moneyShort(s.chippingCost), icon: 'factory' })}
        ${kpi({ label: 'Transport', value: moneyShort(s.transportCost), icon: 'truck', delta: `${qty(s.distanceKm)} km` })}
        ${kpi({
          label: 'Marża brutto', icon: 'chart', variant: 'accent',
          value: moneyShort(s.grossMargin),
          delta: `sprzedaż − zakupy − rąbanie − transport`,
        })}
      </div>

      <div class="card">
        <div class="card-h">
          <h2>Obroty magazynowe — ${esc(r.monthLabel)}</h2>
          <span class="sub">BO + przyjęcia − wydania = BZ (w metrach przestrzennych)</span>
        </div>
        <div class="card-b flush"><div class="tbl-wrap"><table class="tbl">
          <thead><tr>
            <th>Produkt</th><th class="num">BO</th><th class="num">Zakup</th><th class="num">Produkcja</th>
            <th class="num">Zużycie</th><th class="num">Sprzedaż</th><th class="num">BZ</th>
            <th class="num">BZ [t]</th><th class="num">Wart. zakupu</th><th class="num">Wart. sprzedaży</th>
          </tr></thead>
          <tbody>${r.products.map((p) => `<tr>
            <td><b>${esc(p.productName)}</b><br><span style="font-size:11px;color:var(--ink-3)">${esc(p.category)}</span></td>
            <td class="num">${qty(p.opening.qtyMp)}</td>
            <td class="num pos-v">${p.purchase.qtyMp ? '+' + qty(p.purchase.qtyMp) : '—'}</td>
            <td class="num pos-v">${p.production.qtyMp ? '+' + qty(p.production.qtyMp) : '—'}</td>
            <td class="num neg-v">${p.consumption.qtyMp ? '−' + qty(p.consumption.qtyMp) : '—'}</td>
            <td class="num neg-v">${p.sale.qtyMp ? '−' + qty(p.sale.qtyMp) : '—'}</td>
            <td class="num"><b>${qty(p.closing.qtyMp)}</b></td>
            <td class="num">${qty2(p.closing.qtyTonne)}</td>
            <td class="num">${p.purchase.valuePurchase ? moneyShort(p.purchase.valuePurchase) : '—'}</td>
            <td class="num">${p.sale.valueSale ? moneyShort(p.sale.valueSale) : '—'}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        ${r.products.length ? '' : empty('Brak obrotów w tym miesiącu')}
        </div>
      </div>

      <div class="grid-2" style="margin-top:16px">
        ${partnerTable('Dostawcy', r.suppliers, 'Wartość zakupu')}
        ${partnerTable('Odbiorcy', r.recipients, 'Wartość sprzedaży')}
      </div>

      ${(s.corrections || s.cancelled) ? alertBox('info',
        `W tym miesiącu zarejestrowano ${s.corrections} korekt(y) i ${s.cancelled} storno. `
        + 'Szczegóły znajdziesz w widoku „Korekty”.') : ''}`;
}

const partnerTable = (title, rows, valueLabel) => `<div class="card">
  <div class="card-h"><h2>${esc(title)}</h2><span class="sub">${rows.length} pozycji</span></div>
  <div class="card-b flush"><div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Nazwa</th><th class="num">Dok.</th><th class="num">MP</th><th class="num">${esc(valueLabel)}</th></tr></thead>
    <tbody>${rows.map((p) => `<tr>
      <td class="ellip">${esc(p.name)}</td>
      <td class="num">${int(p.documents)}</td>
      <td class="num">${qty(p.qtyMp)}</td>
      <td class="num">${moneyShort(p.value)}</td>
    </tr>`).join('')}</tbody>
  </table></div>${rows.length ? '' : empty('Brak danych')}</div>
</div>`;

/* ---------------------------- Transport -------------------------------- */

async function transportTab() {
  const r = await api.get('/reports/transport', { dateFrom: state.from, dateTo: state.to });
  return rangeToolbar()
    + `<div class="kpi-grid">
        ${kpi({ label: 'Kursy', value: int(r.totals.trips), icon: 'truck' })}
        ${kpi({ label: 'Kilometry', value: qty(r.totals.distanceKm), unit: 'km', icon: 'truck' })}
        ${kpi({ label: 'Koszt frachtów', value: moneyShort(r.totals.cost), icon: 'chart', variant: 'gold' })}
        ${kpi({
          label: 'Stawka średnia', icon: 'chart', variant: 'accent',
          value: r.totals.costPerKm ? qty2(r.totals.costPerKm) : '—', unit: 'zł/km',
          delta: r.totals.costPerTonne ? `${qty2(r.totals.costPerTonne)} zł/t` : '',
        })}
      </div>
      <div class="card">
        <div class="card-h"><h2>Zestawienie przewoźników i pojazdów</h2></div>
        <div class="card-b flush"><div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Przewoźnik</th><th>Nr rej.</th><th class="num">Kursy</th><th class="num">Km</th>
            <th class="num">Tony</th><th class="num">Koszt</th><th class="num">zł/km</th><th class="num">zł/t</th></tr></thead>
          <tbody>${r.items.map((t) => `<tr>
            <td class="ellip">${esc(t.carrier)}</td>
            <td style="font-family:var(--font-mono);font-size:12px">${esc(t.plate)}</td>
            <td class="num">${int(t.trips)}</td>
            <td class="num">${qty(t.distanceKm)}</td>
            <td class="num">${qty2(t.tonnes)}</td>
            <td class="num">${money(t.cost)}</td>
            <td class="num">${t.costPerKm ? qty2(t.costPerKm) : '—'}</td>
            <td class="num">${t.costPerTonne ? qty2(t.costPerTonne) : '—'}</td>
          </tr>`).join('')}</tbody>
        </table></div>${r.items.length ? '' : empty('Brak przewozów w tym okresie')}</div>
      </div>`;
}

/* --------------------------- Kontrahenci ------------------------------- */

async function partnersTab() {
  const r = await api.get('/reports/partners', { dateFrom: state.from, dateTo: state.to });
  const total = r.items.reduce((a, p) => a + p.turnover, 0);
  return rangeToolbar()
    + `<div class="card">
        <div class="card-h">
          <h2>Obroty według kontrahentów</h2>
          <span class="sub">Łącznie ${moneyShort(total)}</span>
        </div>
        <div class="card-b flush"><div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Kontrahent</th><th class="num">Dokumenty</th><th class="num">Zakup [MP]</th>
            <th class="num">Sprzedaż [MP]</th><th class="num">Wart. zakupu</th><th class="num">Wart. sprzedaży</th>
            <th class="num">Obrót</th></tr></thead>
          <tbody>${r.items.map((p) => `<tr>
            <td class="ellip">${esc(p.name)}</td>
            <td class="num">${int(p.documents)}</td>
            <td class="num">${p.purchaseMp ? qty(p.purchaseMp) : '—'}</td>
            <td class="num">${p.saleMp ? qty(p.saleMp) : '—'}</td>
            <td class="num">${p.purchaseValue ? moneyShort(p.purchaseValue) : '—'}</td>
            <td class="num">${p.saleValue ? moneyShort(p.saleValue) : '—'}</td>
            <td class="num"><b>${moneyShort(p.turnover)}</b></td>
          </tr>`).join('')}</tbody>
        </table></div>${r.items.length ? '' : empty('Brak obrotów w tym okresie')}</div>
      </div>`;
}

/* --------------------------- Certyfikacja ------------------------------ */

async function certificationTab() {
  const r = await api.get('/reports/certification', { dateFrom: state.from, dateTo: state.to });
  return rangeToolbar()
    + (r.incomplete.length
      ? alertBox('warning', `${r.incomplete.length} dokument(ów) przyjęcia bez nadleśnictwa lub kwitu wywozowego — `
        + 'uzupełnij je przed audytem certyfikacyjnym.')
      : alertBox('success', 'Wszystkie dokumenty przyjęcia mają wskazane pochodzenie i kwit wywozowy.'))
    + `<div class="card">
        <div class="card-h">
          <h2>Pochodzenie surowca</h2>
          <span class="sub">Zestawienie wymagane przy audycie KZR INiG / SURE</span>
        </div>
        <div class="card-b flush"><div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Nadleśnictwo</th><th>Leśnictwo</th><th>Certyfikat</th>
            <th class="num">Dokumenty</th><th class="num">m³</th><th class="num">MP</th><th class="num">Tony</th></tr></thead>
          <tbody>${r.origins.map((o) => `<tr>
            <td>${esc(o.district)}</td>
            <td>${esc(o.range)}</td>
            <td><span class="tag ${o.certificate === 'BRAK' ? 'CANCELLED' : 'OPEN'}">${esc(o.certificate)}</span></td>
            <td class="num">${int(o.documents)}</td>
            <td class="num">${qty(o.qtyM3)}</td>
            <td class="num">${qty(o.qtyMp)}</td>
            <td class="num">${qty2(o.qtyTonne)}</td>
          </tr>`).join('')}</tbody>
        </table></div>${r.origins.length ? '' : empty('Brak przyjęć w tym okresie')}</div>
      </div>

      ${r.incomplete.length ? `<div class="card" style="margin-top:16px">
        <div class="card-h"><h2>Dokumenty do uzupełnienia</h2><span class="sub">${r.incomplete.length} pozycji</span></div>
        <div class="card-b flush"><div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Data</th><th>Dokument</th><th>Produkt</th><th>Dostawca</th><th></th></tr></thead>
          <tbody>${r.incomplete.map((i) => `<tr>
            <td>${date(i.date)}</td>
            <td><a href="#/operacje/${esc(i.id)}">${esc(i.docNo)}</a></td>
            <td>${esc(i.productName)}</td>
            <td class="ellip">${esc(i.supplier || '—')}</td>
            <td><a class="btn btn-sm" href="#/nowa?id=${esc(i.id)}">Uzupełnij</a></td>
          </tr>`).join('')}</tbody>
        </table></div></div>
      </div>` : ''}`;
}

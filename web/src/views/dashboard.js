/**
 * Pulpit — jeden ekran, na którym widać stan placu, wynik miesiąca i to,
 * co wymaga reakcji.
 *
 * UKŁAD (od góry, w kolejności czytania)
 *  1. pasek filtrów — miesiąc i długość szeregu; zakres jeden dla całego ekranu,
 *  2. sygnały — tylko jeśli są; nic nie udaje pustego miejsca,
 *  3. liczba wiodąca + rząd kafli — stan i sześć wskaźników miesiąca,
 *  4. przebiegi — obrót magazynowy i wynik miesiąca obok siebie,
 *  5. bilans miesiąca — kaskada od BO do BZ,
 *  6. struktura zapasu i ostatnie dokumenty.
 *
 * PRZERYSOWANIE
 * Zmiana filtra nie przebudowuje strony. Pasek filtrów i nagłówek są zbudowane
 * raz; odświeżana jest wyłącznie zawartość pod nimi, a na czas pobierania
 * poprzedni rysunek zostaje przygaszony. Bez tego każda zmiana miesiąca gubiłaby
 * ognisko klawiatury i przesuwała stronę pod kursorem.
 */
import api from '../core/api.js';
import { esc, on } from '../core/dom.js';
import { qty, qty2, int, money, moneyShort, monthLabel, date, currentMonth } from '../core/format.js';
import { pageHead, empty, alertBox, docStamp, typeTag, loading } from '../core/ui.js';
import { iconRef } from '../components/icons.js';
import { can } from '../core/store.js';
import {
  createLineChart, createColumnChart, createWaterfallChart, createBarChart,
  sparkline, statTile, heroFigure, delta, compact,
} from '../ui/charts/index.js';

/** Dostępne długości szeregu — jeden zestaw dla wszystkich przebiegów. */
const RANGES = [
  { value: 6, label: '6 m-cy' },
  { value: 12, label: '12 m-cy' },
  { value: 24, label: '24 m-ce' },
];

/** Skróty kroków bilansu — wersja na wąski ekran, gdzie pełna nazwa nie mieści się pod słupkiem. */
const SHORT_STEP = {
  purchase: 'Zakup', production: 'Prod.', consumption: 'Zużycie', sale: 'Sprzed.', other: 'Korekty',
};

/** Instancje wykresów bieżącego widoku — odpinane przy każdym odświeżeniu. */
let mounted = [];
let detach = [];

const destroyCharts = () => { mounted.forEach((c) => c.destroy()); mounted = []; };

/* ----------------------------- Pomocnicze ------------------------------ */

/** Zmiana wskaźnika między dwoma ostatnimi punktami szeregu. */
function change(trend, key, { upIsGood = true, format = (v) => compact(v) } = {}) {
  if (!trend || trend.length < 2) return '';
  const cur = trend[trend.length - 1][key];
  const prev = trend[trend.length - 2][key];
  const diff = cur - prev;
  const pct = Math.abs(prev) > 0.0005 ? (diff / Math.abs(prev)) * 100 : null;
  const text = pct === null
    ? format(diff)
    : `${diff >= 0 ? '+' : '−'}${Math.abs(pct).toLocaleString('pl-PL', { maximumFractionDigits: 0 })}%`;
  return delta({
    value: diff,
    text,
    upIsGood,
    since: `wobec ${trend[trend.length - 2].short}`,
  });
}

const seriesOf = (trend, key) => trend.map((t) => t[key]);

/* -------------------------------- Widok -------------------------------- */

export async function renderDashboard(view, params = {}) {
  const state = {
    month: /^\d{4}-\d{2}$/.test(params.month || '') ? params.month : currentMonth(),
    months: Number.parseInt(params.zakres, 10) || 12,
  };

  destroyCharts();
  detach.forEach((off) => off());
  detach = [];

  view.innerHTML = pageHead('Pulpit', 'Przegląd zarządczy', `
    ${can('operations:write') ? `<a href="#/nowa" class="btn btn-primary">${iconRef('plus')} Nowa operacja</a>` : ''}
    <button class="btn" data-act="print">${iconRef('print')} Drukuj</button>`)
    + `<div class="dash">
        <div class="filterbar">
          <div class="fb-group">
            <label for="dashMonth">Miesiąc</label>
            <input type="month" id="dashMonth" value="${esc(state.month)}" max="${esc(currentMonth())}">
          </div>
          <div class="fb-group">
            <label id="dashRangeLab">Szereg czasowy</label>
            <div class="fb-presets" role="group" aria-labelledby="dashRangeLab">
              ${RANGES.map((r) => `<button type="button" data-range="${r.value}"
                 aria-pressed="${r.value === state.months}">${esc(r.label)}</button>`).join('')}
            </div>
          </div>
          <span class="fb-spacer"></span>
          <span class="fb-status" data-dash-status aria-live="polite"></span>
        </div>
        <div data-dash-body>${loading('Wczytywanie pulpitu…')}</div>
      </div>`;

  const body = view.querySelector('[data-dash-body]');
  const status = view.querySelector('[data-dash-status]');
  let token = 0;

  async function refresh(first = false) {
    const mine = ++token;
    if (!first) {
      body.querySelectorAll('.viz-card').forEach((c) => c.setAttribute('aria-busy', 'true'));
      status.textContent = 'Przeliczanie…';
    }
    const data = await api.get('/reports/dashboard', { month: state.month, months: state.months });
    if (mine !== token) return;
    destroyCharts();
    paint(body, data);
    status.textContent = `${data.monthLabel} · okres ${data.periodStatus === 'CLOSED' ? 'zamknięty' : 'otwarty'}`;
    // Adres odzwierciedla filtr, żeby dało się wysłać link do konkretnego miesiąca.
    // `replaceState` zamiast przypisania do `location.hash` — inaczej router
    // przeładowałby cały widok i zabrał ognisko z paska filtrów.
    const query = new URLSearchParams({ month: state.month, zakres: String(state.months) });
    history.replaceState(null, '', `#/pulpit?${query}`);
  }

  detach.push(on(view, 'change', '#dashMonth', (el) => {
    if (/^\d{4}-\d{2}$/.test(el.value)) { state.month = el.value; refresh(); }
  }));
  detach.push(on(view, 'click', '[data-range]', (el) => {
    state.months = Number(el.dataset.range);
    view.querySelectorAll('[data-range]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.range) === state.months)));
    refresh();
  }));
  detach.push(on(view, 'click', '[data-act="print"]', () => window.print()));

  await refresh(true);
}

/* ------------------------------ Zawartość ------------------------------ */

function paint(body, data) {
  const { stock: s, turnover: t, trend } = data;

  body.innerHTML = (data.alerts.length ? data.alerts.map((a) => alertBox(a.level, a.message)).join('') : '')
    + `<div class="dash-lead">
        ${heroFigure({
          eyebrow: 'Zapas ogółem na dzień dzisiejszy',
          value: qty(s.totals.qtyMp),
          unit: 'MP',
          delta: change(trend, 'closingMp', { format: (v) => `${v >= 0 ? '+' : '−'}${qty(Math.abs(v))} MP` }),
          spark: sparkline(seriesOf(trend, 'closingMp'), { width: 320, height: 44, accent: '#8FC49B' }),
          foot: `${qty2(s.totals.qtyTonne)} t · ${int(s.totals.energyGj)} GJ · ${int(s.byProduct.length)} pozycji asortymentowych`,
        })}
        <div class="dash-tiles">
          ${statTile({
            label: 'Surowiec na stanie', icon: 'tree',
            value: qty(s.rawMaterialM3), unit: 'm³',
            delta: `<span class="viz-delta">${esc(qty(s.rawMaterialMp))} MP</span>`,
          })}
          ${statTile({
            label: 'Zrębka na stanie', icon: 'factory',
            value: qty(s.chipsMp), unit: 'MP',
            delta: `<span class="viz-delta">${esc(qty2(s.chipsTonne))} t · ${esc(int(s.chipsGj))} GJ</span>`,
          })}
          ${statTile({
            label: 'Produkcja miesiąca', icon: 'factory',
            value: qty(t.productionMp), unit: 'MP',
            delta: change(trend, 'productionMp'),
            spark: sparkline(seriesOf(trend, 'productionMp'), { accent: 'var(--viz-s3)' }),
          })}
          ${statTile({
            label: 'Zakupy miesiąca', icon: 'download',
            value: moneyShort(t.purchaseValue),
            delta: change(trend, 'purchaseValue', { upIsGood: false }),
            spark: sparkline(seriesOf(trend, 'purchaseValue'), { accent: 'var(--viz-s1)' }),
          })}
          ${statTile({
            label: 'Sprzedaż miesiąca', icon: 'upload',
            value: moneyShort(t.saleValue),
            delta: change(trend, 'saleValue'),
            spark: sparkline(seriesOf(trend, 'saleValue'), { accent: 'var(--viz-s2)' }),
          })}
          ${statTile({
            label: 'Marża brutto', icon: 'chart',
            value: moneyShort(t.grossMargin),
            delta: change(trend, 'grossMargin'),
            spark: sparkline(seriesOf(trend, 'grossMargin'), { accent: 'var(--viz-s6)' }),
            href: '#/raporty',
          })}
        </div>
      </div>
      <div class="dash-charts">
        <div data-slot="obrot"></div>
        <div data-slot="marza"></div>
      </div>
      <div class="dash-wide"><div data-slot="bilans"></div></div>
      <div class="dash-rail">
        <div data-slot="zapas"></div>
        ${recentCard(data.recent)}
      </div>
      ${data.production ? productionCard(data.production) : ''}`;

  mountCharts(body, data);
}

function mountCharts(body, data) {
  const { trend, balance, stock: s } = data;
  const span = trend.length
    ? `${trend[0].label} – ${trend[trend.length - 1].label}`
    : 'brak danych';

  const obrot = createLineChart({
    title: 'Obrót magazynowy',
    subtitle: `${span} · masa przestrzenna [MP]`,
    caption: 'Zakup, produkcja i sprzedaż w metrach przestrzennych, miesiąc po miesiącu.',
    note: 'Zakup to przyjęcie surowca, produkcja to wytworzona zrębka, sprzedaż to wydanie na zewnątrz.',
    unit: 'MP',
    points: trend,
    series: [
      { key: 'zakup', label: 'Zakup', color: 'var(--viz-s1)', values: seriesOf(trend, 'purchaseMp') },
      { key: 'produkcja', label: 'Produkcja', color: 'var(--viz-s3)', values: seriesOf(trend, 'productionMp') },
      { key: 'sprzedaz', label: 'Sprzedaż', color: 'var(--viz-s2)', values: seriesOf(trend, 'saleMp') },
    ],
    tipFormat: (v) => `${qty(v)} MP`,
  });

  const marza = createColumnChart({
    title: 'Wynik miesiąca',
    subtitle: `${span} · marża brutto [zł]`,
    caption: 'Marża brutto miesiąca: sprzedaż pomniejszona o zakup, rąbanie i fracht.',
    note: 'Kolor niesie znak wyniku razem z kierunkiem słupka i podpisaną wartością.',
    unit: 'zł',
    points: trend,
    values: seriesOf(trend, 'grossMargin'),
    valueLabel: 'Marża brutto',
    positiveLabel: 'Miesiąc na plusie',
    negativeLabel: 'Miesiąc na minusie',
    tipFormat: money,
  });

  const bilans = createWaterfallChart({
    title: 'Bilans miesiąca',
    subtitle: `${monthLabel(data.month)} · od stanu otwarcia do stanu zamknięcia [MP]`,
    caption: 'Kaskada: stan otwarcia, przychody, rozchody i stan zamknięcia w MP.',
    note: '„Korekty i przesunięcia” domykają równanie — mieszczą się w nich storna, dokumenty BO i przesunięcia międzymagazynowe.',
    unit: 'MP',
    opening: balance.opening,
    closing: balance.closing,
    steps: balance.steps.map((step) => ({ ...step, short: SHORT_STEP[step.key] ?? step.label })),
    tipFormat: (v) => `${qty(v)} MP`,
  });

  const zapas = createBarChart({
    title: 'Struktura zapasu',
    subtitle: 'Stan według produktu · masa przestrzenna [MP]',
    caption: 'Stan magazynowy w rozbiciu na produkty.',
    note: 'Stan ujemny oznacza brakujący dokument przyjęcia — pozycja jest wyróżniona kolorem i podpisem.',
    unit: 'MP',
    valueLabel: 'Stan',
    headerActions: '<a class="btn btn-ghost btn-sm" href="#/magazyn">Kartoteka</a>',
    rows: [...s.byProduct]
      .sort((a, b) => Math.abs(b.qtyMp) - Math.abs(a.qtyMp))
      .slice(0, 8)
      .map((p) => ({
        label: p.productName,
        value: p.qtyMp,
        alert: p.qtyMp < 0,
        detailLabel: p.qtyMp < 0 ? 'Uwaga' : 'Przelicznik',
        detail: p.qtyMp < 0
          ? 'Stan ujemny — sprawdź brakujące przyjęcie'
          : `${qty2(p.qtyTonne)} t · ${int(p.energyGj)} GJ`,
      })),
    tipFormat: (v) => `${qty(v)} MP`,
  });

  mounted = [obrot, marza, bilans, zapas];
  obrot.mount(body.querySelector('[data-slot="obrot"]'));
  marza.mount(body.querySelector('[data-slot="marza"]'));
  bilans.mount(body.querySelector('[data-slot="bilans"]'));
  zapas.mount(body.querySelector('[data-slot="zapas"]'));
}

/* -------------------------------- Karty -------------------------------- */

function recentCard(recent) {
  return `<div class="card">
    <div class="card-h">
      <h2>Ostatnie dokumenty</h2>
      <a class="btn btn-ghost btn-sm" href="#/operacje">Wszystkie</a>
    </div>
    <div class="card-b flush">
      ${recent.length ? recent.map((r) => `
        <a href="#/operacje/${esc(r.id)}" class="recent-row">
          <span class="rr-head">${typeTag(r.type)}${docStamp(r.docNo)}</span>
          <span class="rr-name">${esc(r.productName)}</span>
          <span class="rr-qty">${esc(qty(r.qtyMp))} MP</span>
          <span class="rr-date">${esc(date(r.operationDate))}</span>
        </a>`).join('')
        : empty('Brak dokumentów', 'Rejestr jest jeszcze pusty.')}
    </div>
  </div>`;
}

/** Kwit produkcji dnia — skrót na pulpicie. */
function productionCard(p) {
  return `<div class="card" style="border-left:4px solid var(--amber)">
    <div class="card-h">
      <div>
        <h2>Kwit produkcji dnia — ${esc(date(p.date))}</h2>
        <div class="sub">${esc(p.count)} dokument(ów) produkcyjnych${p.yieldRatio ? ` · uzysk ${esc(qty(p.yieldRatio))} MP zrębki z 1 MP surowca` : ''}</div>
      </div>
      <a class="btn btn-ghost btn-sm" href="#/produkcja?date=${esc(p.date)}">Pełny raport</a>
    </div>
    <div class="card-b">
      <div class="dash-tiles" style="margin-bottom:12px">
        ${statTile({ label: 'Wyprodukowano', value: qty(p.totals.qtyMp), unit: 'MP', icon: 'factory' })}
        ${statTile({ label: 'Objętość', value: qty(p.totals.qtyM3), unit: 'm³', icon: 'tree' })}
        ${statTile({ label: 'Masa', value: qty2(p.totals.qtyTonne), unit: 't', icon: 'chart' })}
      </div>
      ${p.byProduct.length ? `<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Produkt</th><th class="num">MP</th><th class="num">Tony</th><th>Pochodzenie</th></tr></thead>
        <tbody>${p.byProduct.map((x) => `<tr>
          <td>${esc(x.productName)}</td>
          <td class="num">${esc(qty(x.qtyMp))}</td>
          <td class="num">${esc(qty2(x.qtyTonne))}</td>
          <td style="font-size:12px;color:var(--ink-2)">${esc(x.sources.join(' · ') || '—')}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : ''}
    </div>
  </div>`;
}

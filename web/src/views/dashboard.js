/** Pulpit — stan magazynu, obroty miesiąca, produkcja i sygnały do reakcji. */
import api from '../core/api.js';
import { esc } from '../core/dom.js';
import { qty, qty2, int, moneyShort, monthLabel, date, currentMonth } from '../core/format.js';
import { pageHead, kpi, empty, alertBox, docStamp, typeTag, pileGauge, loading } from '../core/ui.js';
import { ICONS } from '../components/icons.js';
import { can } from '../core/store.js';

export async function renderDashboard(view, { month } = {}) {
  view.innerHTML = loading('Wczytywanie pulpitu…');
  const data = await api.get('/reports/dashboard', { month: month || currentMonth() });

  const t = data.turnover;
  const s = data.stock;
  const maxMp = Math.max(1, ...s.byProduct.map((p) => Math.abs(p.qtyMp)));

  view.innerHTML = pageHead(
    'Pulpit',
    `${esc(data.monthLabel)} · okres ${data.periodStatus === 'CLOSED' ? 'zamknięty' : 'otwarty'}`,
    `${can('operations:write') ? `<a href="#/nowa" class="btn btn-primary">${ICONS.plus} Nowa operacja</a>` : ''}
     <button class="btn" data-act="print">${ICONS.print} Drukuj</button>`,
  )
  + (data.alerts.length ? data.alerts.map((a) => alertBox(a.level, a.message)).join('') : '')
  + `<div class="kpi-grid">
      ${kpi({
        label: 'Surowiec na stanie', icon: 'tree', variant: 'accent',
        value: qty(s.rawMaterialM3), unit: 'm³',
        delta: `${qty(s.rawMaterialMp)} MP · drewno do przerobu`,
      })}
      ${kpi({
        label: 'Zrębka na stanie', icon: 'factory', variant: 'gold',
        value: qty(s.chipsMp), unit: 'MP',
        delta: `${qty2(s.chipsTonne)} t · ${int(s.chipsGj)} GJ`,
      })}
      ${kpi({
        label: 'Produkcja miesiąca', icon: 'factory',
        value: qty(t.productionMp), unit: 'MP',
        delta: `${qty2(t.productionTonne)} t wyprodukowanej zrębki`,
      })}
      ${kpi({
        label: 'Transporty', icon: 'truck',
        value: `${int(data.transports.inbound)} / ${int(data.transports.outbound)}`,
        delta: `przyjęcia / wydania · fracht ${moneyShort(t.transportCost)}`,
      })}
      ${kpi({
        label: 'Zakupy miesiąca', icon: 'download',
        value: moneyShort(t.purchaseValue),
        delta: `${qty(t.purchaseMp)} MP · rąbanie ${moneyShort(t.chippingCost)}`,
      })}
      ${kpi({
        label: 'Sprzedaż miesiąca', icon: 'upload',
        value: moneyShort(t.saleValue),
        delta: `marża brutto: <span class="${t.grossMargin >= 0 ? 'pos-v' : 'neg-v'}">${moneyShort(t.grossMargin)}</span>`,
      })}
    </div>`

  + (data.production ? productionCard(data.production) : '')

  + `<div class="grid-2">
      <div class="card">
        <div class="card-h">
          <h2>Pryzmy — stan według produktu</h2>
          <a class="btn btn-ghost btn-sm" href="#/magazyn">Szczegóły</a>
        </div>
        <div class="card-b">
          ${s.byProduct.length ? `<div class="piles">${s.byProduct.map((p) => `
            <div class="pile ${p.qtyMp < 0 ? 'neg' : ''}">
              <div class="p-name">${esc(p.productName)}</div>
              <div class="p-gauge">${pileGauge(Math.abs(p.qtyMp) / maxMp, p.qtyMp < 0)}</div>
              <div class="p-mp">${qty(p.qtyMp)} <small>MP</small></div>
              <div class="p-t">${qty2(p.qtyTonne)} t · ${int(p.energyGj)} GJ</div>
            </div>`).join('')}</div>`
            : empty('Magazyn jest pusty', 'Zaksięguj pierwszy dokument przyjęcia.')}
        </div>
      </div>

      <div class="card">
        <div class="card-h">
          <h2>Ostatnie dokumenty</h2>
          <a class="btn btn-ghost btn-sm" href="#/operacje">Wszystkie</a>
        </div>
        <div class="card-b flush">
          ${data.recent.length ? data.recent.map((r) => `
            <a href="#/operacje/${esc(r.id)}" class="recent-row">
              <span class="rr-head">${typeTag(r.type)}${docStamp(r.docNo)}</span>
              <span class="rr-name">${esc(r.productName)}</span>
              <span class="rr-qty">${qty(r.qtyMp)} MP</span>
              <span class="rr-date">${date(r.operationDate)}</span>
            </a>`).join('')
            : empty('Brak dokumentów', 'Rejestr jest jeszcze pusty.')}
        </div>
      </div>
    </div>`;

  view.querySelector('[data-act="print"]')?.addEventListener('click', () => window.print());
}

/** Kwit produkcji dnia — skrót na pulpicie. */
function productionCard(p) {
  return `<div class="card" style="margin-bottom:16px;border-left:4px solid var(--amber)">
    <div class="card-h">
      <div>
        <h2>Kwit produkcji dnia — ${date(p.date)}</h2>
        <div class="sub">${p.count} dokument(ów) produkcyjnych${p.yieldRatio ? ` · uzysk ${qty(p.yieldRatio)} MP zrębki z 1 MP surowca` : ''}</div>
      </div>
      <a class="btn btn-ghost btn-sm" href="#/produkcja?date=${esc(p.date)}">Pełny raport</a>
    </div>
    <div class="card-b">
      <div class="kpi-grid" style="margin-bottom:12px">
        ${kpi({ label: 'Wyprodukowano', value: qty(p.totals.qtyMp), unit: 'MP', icon: 'factory' })}
        ${kpi({ label: 'Objętość', value: qty(p.totals.qtyM3), unit: 'm³', icon: 'tree' })}
        ${kpi({ label: 'Masa', value: qty2(p.totals.qtyTonne), unit: 't', icon: 'chart' })}
        ${kpi({ label: 'Energia', value: int(p.totals.energyGj), unit: 'GJ', icon: 'chart' })}
      </div>
      ${p.byProduct.length ? `<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Produkt</th><th class="num">MP</th><th class="num">Tony</th><th>Pochodzenie</th></tr></thead>
        <tbody>${p.byProduct.map((x) => `<tr>
          <td>${esc(x.productName)}</td>
          <td class="num">${qty(x.qtyMp)}</td>
          <td class="num">${qty2(x.qtyTonne)}</td>
          <td style="font-size:12px;color:var(--ink-2)">${esc(x.sources.join(' · ') || '—')}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : ''}
    </div>
  </div>`;
}

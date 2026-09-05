/** Kwit produkcji dnia — zestawienie zużycia surowca i uzysku zrębki. */
import api from '../core/api.js';
import { esc } from '../core/dom.js';
import { qty, qty2, int, money, date, today } from '../core/format.js';
import { pageHead, kpi, empty, loading, docStamp, alertBox } from '../core/ui.js';
import { ICONS } from '../components/icons.js';
import { store } from '../core/store.js';

export async function renderProduction(view, params = {}) {
  view.innerHTML = loading('Wczytywanie danych produkcji…');

  const days = (await api.get('/reports/production-days', { limit: 90 })).items;
  const selected = params.date || days[0]?.date || today();
  const report = await api.get('/reports/production-day', { date: selected });

  view.innerHTML = pageHead(
    'Produkcja dnia',
    `Kwit produkcyjny · ${date(selected)}`,
    `<button class="btn" data-act="print">${ICONS.print} Drukuj kwit</button>`,
  )
  + `<div class="toolbar">
      <select id="dayPick" aria-label="Dzień produkcji">
        ${days.length
          ? days.map((d) => `<option value="${esc(d.date)}"${d.date === selected ? ' selected' : ''}>
              ${date(d.date)} — ${qty(d.qtyMp)} MP (${d.documents} dok.)</option>`).join('')
          : `<option value="${esc(selected)}">${date(selected)}</option>`}
      </select>
      <input type="date" id="dayInput" value="${esc(selected)}" max="${today()}" aria-label="Wybierz datę">
      <span class="count-pill">${report.count} dokument(ów) PW</span>
    </div>`

  + (report.count === 0
    ? empty('Brak produkcji w tym dniu', 'Wybierz inny dzień lub zaksięguj dokument produkcji.')
    : `<div class="kpi-grid">
        ${kpi({ label: 'Wyprodukowano', value: qty(report.totals.qtyMp), unit: 'MP', icon: 'factory', variant: 'accent' })}
        ${kpi({ label: 'Objętość', value: qty(report.totals.qtyM3), unit: 'm³', icon: 'tree' })}
        ${kpi({ label: 'Masa', value: qty2(report.totals.qtyTonne), unit: 't', icon: 'chart' })}
        ${kpi({ label: 'Energia', value: int(report.totals.energyGj), unit: 'GJ', icon: 'chart' })}
        ${kpi({ label: 'Koszt rąbania', value: money(report.totals.chippingCost), icon: 'settings' })}
        ${kpi({
          label: 'Uzysk', icon: 'refresh', variant: 'gold',
          value: report.yieldRatio ? qty(report.yieldRatio) : '—', unit: report.yieldRatio ? 'MP/MP' : '',
          delta: 'MP zrębki z 1 MP surowca',
        })}
      </div>

      <div class="card">
        <div class="card-h">
          <h2>Kwit Produkcji Dnia — ${date(selected)}</h2>
          <span class="sub">${esc(store.meta?.company?.name ?? '')}</span>
        </div>
        <div class="card-b">
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
            ${report.documents.map((d) => docStamp(d)).join(' ')}
          </div>

          <h3 style="font-size:13px;font-weight:700;margin-bottom:8px">Wyprodukowano</h3>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>Produkt</th><th class="num">MP</th><th class="num">m³</th>
              <th class="num">Tony</th><th class="num">GJ</th><th>Pochodzenie surowca</th></tr></thead>
            <tbody>${report.byProduct.map((p) => `<tr>
              <td><b>${esc(p.productName)}</b></td>
              <td class="num">${qty(p.qtyMp)}</td>
              <td class="num">${qty(p.qtyM3)}</td>
              <td class="num">${qty2(p.qtyTonne)}</td>
              <td class="num">${int(p.energyGj)}</td>
              <td style="font-size:12px;color:var(--ink-2)">${esc(p.sources.join(' · ') || '—')}</td>
            </tr>`).join('')}</tbody>
            <tfoot><tr>
              <td>Razem</td>
              <td class="num">${qty(report.totals.qtyMp)}</td>
              <td class="num">${qty(report.totals.qtyM3)}</td>
              <td class="num">${qty2(report.totals.qtyTonne)}</td>
              <td class="num">${int(report.totals.energyGj)}</td>
              <td></td>
            </tr></tfoot>
          </table></div>

          ${report.consumption.length ? `
            <h3 style="font-size:13px;font-weight:700;margin:20px 0 8px">Zużyty surowiec</h3>
            <div class="tbl-wrap"><table class="tbl">
              <thead><tr><th>Dokument</th><th>Produkt</th><th class="num">MP</th><th class="num">m³</th><th>Źródło</th></tr></thead>
              <tbody>${report.consumption.map((c) => `<tr>
                <td>${docStamp(c.docNo)}</td>
                <td>${esc(c.productName)}</td>
                <td class="num">${qty(c.qtyMp)}</td>
                <td class="num">${qty(c.qtyM3)}</td>
                <td style="font-size:12px;color:var(--ink-2)">${esc(c.source || '—')}</td>
              </tr>`).join('')}</tbody>
            </table></div>` : ''}

          ${report.dispatch.length ? `
            <h3 style="font-size:13px;font-weight:700;margin:20px 0 8px">Wywóz do odbiorców</h3>
            <div class="tbl-wrap"><table class="tbl">
              <thead><tr><th>Dokument</th><th>Odbiorca</th><th>Produkt</th>
                <th class="num">MP</th><th class="num">Tony</th><th class="num">Wartość</th><th>Nr rej.</th></tr></thead>
              <tbody>${report.dispatch.map((s) => `<tr>
                <td>${docStamp(s.docNo)}</td>
                <td>${esc(s.recipient || '—')}</td>
                <td>${esc(s.productName)}</td>
                <td class="num">${qty(s.qtyMp)}</td>
                <td class="num">${qty2(s.qtyTonne)}</td>
                <td class="num">${money(s.value)}</td>
                <td style="font-family:var(--font-mono);font-size:12px">${esc(s.vehiclePlate || '—')}</td>
              </tr>`).join('')}</tbody>
            </table></div>` : ''}

          <div class="grid-2" style="margin-top:20px">
            <div>
              <div class="crumb" style="margin-bottom:6px">Kwity wywozowe</div>
              <div>${report.haulageNotes.length ? report.haulageNotes.map((k) => `<span class="stamp">${esc(k)}</span>`).join(' ') : '<span style="color:var(--ink-3)">—</span>'}</div>
            </div>
            <div>
              <div class="crumb" style="margin-bottom:6px">Lasy / pochodzenie</div>
              <div style="font-size:13px">${esc(report.forests.join(' · ') || '—')}</div>
            </div>
          </div>
        </div>
      </div>`);

  view.querySelector('[data-act="print"]')?.addEventListener('click', () => window.print());
  const go = (value) => { window.location.hash = `#/produkcja?date=${value}`; };
  view.querySelector('#dayPick')?.addEventListener('change', (e) => go(e.target.value));
  view.querySelector('#dayInput')?.addEventListener('change', (e) => go(e.target.value));
}

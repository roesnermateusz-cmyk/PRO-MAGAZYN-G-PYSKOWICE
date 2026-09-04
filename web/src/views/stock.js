/** Stany magazynowe i kartoteka ruchów produktu. */
import api from '../core/api.js';
import { esc, on, options } from '../core/dom.js';
import { qty, qty2, int, date, today } from '../core/format.js';
import { pageHead, empty, loading, toast, toastError, docStamp, typeTag, alertBox, pileGauge } from '../core/ui.js';
import { ICONS } from '../components/icons.js';
import { loadCatalog } from '../core/store.js';

const state = { warehouseId: '', date: '', productId: '' };

export async function renderStock(view) {
  view.innerHTML = loading('Obliczanie stanów magazynowych…');
  const catalog = await loadCatalog();
  await refresh(view, catalog);
}

async function refresh(view, catalog) {
  const data = await api.get('/stock', {
    warehouseId: state.warehouseId,
    date: state.date,
    includeZero: 'false',
  });
  const negative = data.items.filter((i) => i.qtyMp < -0.001);
  const maxMp = Math.max(1, ...data.byProduct.map((p) => Math.abs(p.qtyMp)));

  view.innerHTML = pageHead(
    'Stan magazynowy',
    `Bilans ruchów: przyjęcia − wydania ${state.date ? `· na dzień ${date(state.date)}` : '· stan bieżący'}`,
    `<button class="btn" data-act="csv">${ICONS.download} CSV</button>
     <button class="btn" data-act="print">${ICONS.print} Drukuj</button>`,
  )
  + (negative.length ? alertBox('warning',
      `Stany ujemne (${negative.length}): ${negative.map((n) => `${n.productName} ${qty(n.qtyMp)} MP`).join(', ')}. `
      + 'Sprawdź, czy nie brakuje dokumentu przyjęcia.') : '')
  + `<div class="toolbar">
      <select id="fmag">${options(catalog.warehouses, state.warehouseId, { placeholder: 'Wszystkie magazyny' })}</select>
      <input type="date" id="fdate" value="${esc(state.date)}" max="${today()}" aria-label="Stan na dzień">
      <button class="btn btn-sm" data-act="now">Stan bieżący</button>
      <span class="count-pill">${data.items.length} pozycji · ${qty(data.totals.qtyMp)} MP</span>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-h"><h2>Pryzmy</h2><span class="sub">Wysokość słupka proporcjonalna do stanu</span></div>
      <div class="card-b">
        ${data.byProduct.length ? `<div class="piles">${data.byProduct.map((p) => `
          <div class="pile ${p.qtyMp < 0 ? 'neg' : ''}" data-prod="${esc(p.productId)}" style="cursor:pointer">
            <div class="p-name">${esc(p.productName)}</div>
            <div class="p-gauge">${pileGauge(Math.abs(p.qtyMp) / maxMp, p.qtyMp < 0)}</div>
            <div class="p-mp">${qty(p.qtyMp)} <small>MP</small></div>
            <div class="p-t">${qty2(p.qtyTonne)} t · ${int(p.energyGj)} GJ</div>
          </div>`).join('')}</div>`
          : empty('Magazyn jest pusty', 'Zaksięguj dokument przyjęcia (PZ lub BO).')}
      </div>
    </div>

    <div class="card">
      <div class="card-h"><h2>Zestawienie szczegółowe</h2><span class="sub">Kliknij wiersz, aby otworzyć kartotekę produktu</span></div>
      <div class="card-b flush"><div class="tbl-wrap"><table class="tbl">
        <thead><tr>
          <th>Magazyn</th><th>Produkt</th><th>Kategoria</th>
          <th class="num">MP</th><th class="num">m³</th><th class="num">Tony</th><th class="num">GJ</th><th>Ostatni ruch</th>
        </tr></thead>
        <tbody>${data.items.map((i) => `<tr data-prod="${esc(i.productId)}" style="cursor:pointer">
          <td>${esc(i.warehouseName)}</td>
          <td>${esc(i.productName)}</td>
          <td style="font-size:12px;color:var(--ink-2)">${esc(i.category)}</td>
          <td class="num ${i.qtyMp < 0 ? 'neg-v' : ''}">${qty(i.qtyMp)}</td>
          <td class="num">${qty(i.qtyM3)}</td>
          <td class="num">${qty2(i.qtyTonne)}</td>
          <td class="num">${int(i.energyGj)}</td>
          <td style="font-size:12px;color:var(--ink-2)">${date(i.lastMoveDate)}</td>
        </tr>`).join('')}</tbody>
        ${data.items.length ? `<tfoot><tr>
          <td colspan="3">Razem</td>
          <td class="num">${qty(data.totals.qtyMp)}</td>
          <td class="num">${qty(data.totals.qtyM3)}</td>
          <td class="num">${qty2(data.totals.qtyTonne)}</td>
          <td class="num">${int(data.totals.energyGj)}</td>
          <td></td>
        </tr></tfoot>` : ''}
      </table></div>
      ${data.items.length ? '' : empty('Brak pozycji na stanie')}
      </div>
    </div>

    <div id="ledgerBox"></div>`;

  const reload = () => refresh(view, catalog);
  view.querySelector('#fmag').addEventListener('change', (e) => { state.warehouseId = e.target.value; reload(); });
  view.querySelector('#fdate').addEventListener('change', (e) => { state.date = e.target.value; reload(); });
  view.querySelector('[data-act="now"]').addEventListener('click', () => { state.date = ''; reload(); });
  view.querySelector('[data-act="print"]').addEventListener('click', () => window.print());
  view.querySelector('[data-act="csv"]').addEventListener('click', async () => {
    try {
      await api.download('/stock/export.csv', { warehouseId: state.warehouseId, date: state.date }, 'stany.csv');
      toast('Plik CSV został pobrany');
    } catch (err) { toastError(err); }
  });

  on(view, 'click', '[data-prod]', (el) => showLedger(view, el.dataset.prod, catalog));
  if (state.productId) showLedger(view, state.productId, catalog);
}

/** Kartoteka magazynowa produktu — ruchy ze stanem narastającym. */
async function showLedger(view, productId, catalog) {
  state.productId = productId;
  const box = view.querySelector('#ledgerBox');
  box.innerHTML = loading('Wczytywanie kartoteki…');
  try {
    const data = await api.get('/stock/ledger', { productId, warehouseId: state.warehouseId, limit: 300 });
    const product = catalog.products.find((p) => p.id === productId);
    box.innerHTML = `<div class="card" id="ledgerCard">
      <div class="card-h">
        <div>
          <h2>Kartoteka magazynowa — ${esc(product?.name ?? '')}</h2>
          <div class="sub">Bilans otwarcia ${qty(data.opening)} MP · stan końcowy ${qty(data.closing)} MP</div>
        </div>
        <button class="icon-btn" data-act="close-ledger" aria-label="Zamknij">${ICONS.close}</button>
      </div>
      <div class="card-b flush"><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Data</th><th>Dokument</th><th>Typ</th><th>Magazyn</th><th>Kontrahent</th>
          <th class="num">Zmiana MP</th><th class="num">Saldo MP</th></tr></thead>
        <tbody>${data.items.map((m) => `<tr>
          <td style="white-space:nowrap">${date(m.date)}</td>
          <td><a href="#/operacje/${esc(m.operationId)}">${docStamp(m.docNo)}</a></td>
          <td>${typeTag(m.type)}</td>
          <td style="font-size:12px">${esc(m.warehouseName)}</td>
          <td class="ellip">${esc(m.counterparty || '—')}</td>
          <td class="num ${m.qtyMp < 0 ? 'neg-v' : 'pos-v'}">${m.qtyMp > 0 ? '+' : ''}${qty(m.qtyMp)}</td>
          <td class="num">${qty(m.balanceMp)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      ${data.items.length ? '' : empty('Brak ruchów w tym okresie')}
      </div>
    </div>`;
    box.querySelector('[data-act="close-ledger"]').addEventListener('click', () => {
      state.productId = '';
      box.innerHTML = '';
    });
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    box.innerHTML = '';
    toastError(err);
  }
}

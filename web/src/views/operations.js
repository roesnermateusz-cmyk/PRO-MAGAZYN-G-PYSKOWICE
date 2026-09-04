/** Rejestr operacji: filtrowanie, lista (tabela / karty), podgląd i storno dokumentu. */
import api from '../core/api.js';
import { esc, on, options } from '../core/dom.js';
import { qty, qty2, money, moneyShort, date, dateTime, monthLabel } from '../core/format.js';
import {
  pageHead, empty, loading, docStamp, typeTag, pager,
  openModal, closeModal, confirmDialog, toast, toastError, showLightbox, alertBox,
} from '../core/ui.js';
import { ICONS } from '../components/icons.js';
import { can, loadCatalog } from '../core/store.js';
import { navigate } from '../core/router.js';
import { downloadHandler, unitLabel } from './_shared.js';

/** Filtry są modułowe, żeby przetrwały powrót z podglądu dokumentu. */
const filters = {
  q: '', type: '', productId: '', warehouseId: '', month: '', chainRef: '',
  status: 'POSTED', limit: 50, offset: 0,
};

export async function renderOperations(view, params = {}) {
  if (params.id) return renderOperationDetail(view, params.id);

  // Wejście z podglądu dokumentu: `#/operacje?chain=PZ/2026/000123`
  // pokazuje komplet ogniw jednego łańcucha terenowego.
  filters.chainRef = params.chain ?? '';
  if (filters.chainRef) { filters.offset = 0; filters.status = 'ALL'; }

  view.innerHTML = loading('Wczytywanie rejestru…');
  const catalog = await loadCatalog();
  await refresh(view, catalog);
}

async function refresh(view, catalog) {
  const data = await api.get('/operations', filters);

  view.innerHTML = pageHead(
    'Rejestr operacji',
    'Dokumenty PZ · WZ · PW · RW · MM · BO',
    `<button class="btn" data-act="csv">${ICONS.download} Eksport CSV</button>
     ${can('operations:write') ? `<a href="#/nowa" class="btn btn-primary">${ICONS.plus} Dodaj</a>` : ''}`,
  )
  + (filters.chainRef
    ? alertBox('info', `Widok ograniczony do łańcucha ${filters.chainRef}. `
      + 'Aby wrócić do pełnego rejestru, wybierz „Wszystkie" w filtrze typu.')
    : '')
  + `<div class="chips">
      ${['', 'ZAKUP', 'SPRZEDAZ', 'PRODUKCJA', 'ZUZYCIE', 'MM', 'BO'].map((t) =>
        `<button data-type="${esc(t)}" class="${filters.type === t ? 'on' : ''}">${esc(t || 'Wszystkie')}</button>`).join('')}
    </div>
    <div class="toolbar">
      <input type="search" id="fq" placeholder="Szukaj: dokument, kontrahent, rejestracja, kwit…" value="${esc(filters.q)}">
      <select id="fprod">${options(catalog.products, filters.productId, { placeholder: 'Produkt: wszystkie' })}</select>
      <select id="fmag">${options(catalog.warehouses, filters.warehouseId, { placeholder: 'Magazyn: wszystkie' })}</select>
      <input type="month" id="fmonth" value="${esc(filters.month)}" aria-label="Miesiąc">
      <select id="fstatus">
        <option value="POSTED"${filters.status === 'POSTED' ? ' selected' : ''}>Zaksięgowane</option>
        <option value="CANCELLED"${filters.status === 'CANCELLED' ? ' selected' : ''}>Anulowane</option>
        <option value="ALL"${filters.status === 'ALL' ? ' selected' : ''}>Wszystkie</option>
      </select>
      <span class="count-pill">${data.page.total} dokument(ów)</span>
    </div>`

  + `<div class="card tbl-desktop">
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr>
          <th>Data</th><th>Typ</th><th>Dokument</th><th>Produkt</th><th>Kontrahent</th>
          <th class="num">Wolumen</th><th class="num">MP</th><th class="num">Tony</th><th class="num">Wartość</th>
          <th>Przewoźnik</th><th>Nr rej.</th><th class="num">Koszt tr.</th><th></th>
        </tr></thead>
        <tbody>${data.items.map(rowHtml).join('')}</tbody>
        ${data.items.length ? `<tfoot><tr>
          <td colspan="6">Razem (po filtrach)</td>
          <td class="num">${qty(data.totals.qtyMp)}</td>
          <td class="num">${qty2(data.totals.qtyTonne)}</td>
          <td class="num">${moneyShort(data.totals.valueSale || data.totals.valuePurchase)}</td>
          <td colspan="2"></td>
          <td class="num">${moneyShort(data.totals.transportCost)}</td>
          <td></td>
        </tr></tfoot>` : ''}
      </table></div>
      ${data.items.length ? '' : empty('Nic nie znaleziono', 'Zmień filtry albo dodaj nowy dokument.')}
      ${pager(data.page)}
    </div>

    <div class="op-cards">
      ${data.items.map(cardHtml).join('') || empty('Nic nie znaleziono', 'Zmień filtry.')}
      ${pager(data.page)}
    </div>`;

  bind(view, catalog);
}

const counterparty = (r) => (
  ['SPRZEDAZ', 'MM'].includes(r.type) ? r.recipientName : (r.supplierName || r.originPlace)
) || '—';

function rowHtml(r) {
  const value = r.valueSale || r.valuePurchase;
  return `<tr class="${r.status === 'CANCELLED' ? 'cancelled' : ''}">
    <td style="white-space:nowrap">${date(r.operationDate)}</td>
    <td>${typeTag(r.type)}</td>
    <td>${docStamp(r.docNo)}</td>
    <td class="ellip">${esc(r.productName)}</td>
    <td class="ellip">${esc(counterparty(r))}</td>
    <td class="num">${qty(r.quantity)} ${esc(unitLabel(r.unit))}</td>
    <td class="num">${qty(r.qtyMp)}</td>
    <td class="num">${qty2(r.qtyTonne)}</td>
    <td class="num">${value ? moneyShort(value) : '—'}</td>
    <td class="ellip" style="font-size:12px">${esc(r.carrierName || '—')}</td>
    <td style="font-family:var(--font-mono);font-size:12px;white-space:nowrap">${esc(r.vehiclePlate || '—')}</td>
    <td class="num">${r.transportCost ? moneyShort(r.transportCost) : '—'}</td>
    <td style="white-space:nowrap">
      <button class="icon-btn" data-view="${esc(r.id)}" title="Podgląd">${ICONS.eye}</button>
      ${can('operations:write') && r.status === 'POSTED'
        ? `<button class="icon-btn" data-edit="${esc(r.id)}" title="Edytuj">${ICONS.edit}</button>
           <button class="icon-btn" data-dup="${esc(r.id)}" title="Duplikuj">${ICONS.copy}</button>` : ''}
      ${can('operations:cancel') && r.status === 'POSTED'
        ? `<button class="icon-btn danger" data-cancel="${esc(r.id)}" title="Storno">${ICONS.trash}</button>` : ''}
    </td>
  </tr>`;
}

function cardHtml(r) {
  return `<div class="op-card" ${r.status === 'CANCELLED' ? 'style="opacity:.6"' : ''}>
    <div class="r1">
      ${typeTag(r.type)}${docStamp(r.docNo)}
      <span style="margin-left:auto;font-size:12px;color:var(--ink-2)">${date(r.operationDate)}</span>
    </div>
    <div class="r2">${esc(r.productName)}</div>
    <div class="r3">${esc(counterparty(r))}${r.vehiclePlate ? ` · ${esc(r.vehiclePlate)}` : ''}${r.transportCost ? ` · ${moneyShort(r.transportCost)}` : ''}</div>
    <div class="r4">
      <span class="vol">${qty(r.qtyMp)} <small style="font-size:11px;color:var(--ink-2)">MP · ${qty2(r.qtyTonne)} t</small></span>
      <span>
        <button class="icon-btn" data-view="${esc(r.id)}">${ICONS.eye}</button>
        ${can('operations:write') && r.status === 'POSTED' ? `<button class="icon-btn" data-edit="${esc(r.id)}">${ICONS.edit}</button>` : ''}
      </span>
    </div>
  </div>`;
}

function bind(view, catalog) {
  const reload = () => refresh(view, catalog);
  const setFilter = (patch) => { Object.assign(filters, patch, { offset: 0 }); reload(); };

  on(view, 'click', '[data-type]', (el) => setFilter({ type: el.dataset.type, chainRef: '' }));
  view.querySelector('#fq').addEventListener('change', (e) => setFilter({ q: e.target.value.trim() }));
  view.querySelector('#fq').addEventListener('search', (e) => setFilter({ q: e.target.value.trim() }));
  view.querySelector('#fprod').addEventListener('change', (e) => setFilter({ productId: e.target.value }));
  view.querySelector('#fmag').addEventListener('change', (e) => setFilter({ warehouseId: e.target.value }));
  view.querySelector('#fmonth').addEventListener('change', (e) => setFilter({ month: e.target.value }));
  view.querySelector('#fstatus').addEventListener('change', (e) => setFilter({ status: e.target.value }));

  on(view, 'click', '[data-page]', (el) => {
    filters.offset = Math.max(0, filters.offset + (el.dataset.page === 'next' ? filters.limit : -filters.limit));
    reload();
  });

  on(view, 'click', '[data-view]', (el) => navigate(`/operacje/${el.dataset.view}`));
  on(view, 'click', '[data-edit]', (el) => navigate(`/nowa?id=${el.dataset.edit}`));
  on(view, 'click', '[data-dup]', (el) => navigate(`/nowa?copy=${el.dataset.dup}`));
  on(view, 'click', '[data-cancel]', (el) => cancelOperation(el.dataset.cancel, reload));

  view.querySelector('[data-act="csv"]').addEventListener('click',
    downloadHandler('/operations/export.csv', () => filters, 'rejestr-operacji.csv', 'Plik CSV został pobrany'));
}

/** Storno dokumentu — zawsze z uzasadnieniem trafiającym do audytu. */
export async function cancelOperation(id, onDone) {
  const reason = await confirmDialog({
    title: 'Storno dokumentu',
    message: 'Dokument pozostanie w rejestrze ze statusem „anulowany”, a jego ruchy magazynowe zostaną wycofane.',
    confirmLabel: 'Wykonaj storno',
    danger: true,
    reasonLabel: 'Przyczyna storna (wymagana, min. 5 znaków)',
  });
  if (reason === null) return;
  try {
    await api.post(`/operations/${id}/cancel`, { reason });
    toast('Dokument anulowany');
    onDone?.();
  } catch (err) {
    toastError(err);
  }
}

/* ------------------------- Podgląd dokumentu -------------------------- */

export async function renderOperationDetail(view, id) {
  view.innerHTML = loading('Wczytywanie dokumentu…');
  const op = await api.get(`/operations/${id}`);

  const row = (label, value) => (value === null || value === undefined || value === '' || value === '—'
    ? '' : `<dt>${esc(label)}</dt><dd>${value}</dd>`);

  view.innerHTML = pageHead(
    `Dokument ${op.docNo}`,
    `${op.type} · ${op.status === 'CANCELLED' ? 'ANULOWANY' : 'zaksięgowany'} · rewizja ${op.revision}`,
    `<button class="btn" data-act="print">${ICONS.print} Drukuj</button>
     ${can('operations:write') && op.status === 'POSTED' ? `<a class="btn" href="#/nowa?id=${esc(op.id)}">${ICONS.edit} Edytuj</a>` : ''}
     ${can('operations:cancel') && op.status === 'POSTED' ? '<button class="btn btn-danger" data-act="cancel">Storno</button>' : ''}
     <a class="btn btn-ghost" href="#/operacje">Powrót</a>`,
  )
  + (op.status === 'CANCELLED' ? alertBox('danger', `Dokument anulowany ${dateTime(op.cancelledAt)} — ${op.cancelReason || 'bez podanej przyczyny'}`) : '')
  + `<div class="calc-strip">
      <div class="ci"><div class="l">Metry przestrzenne</div><div class="v">${qty(op.qtyMp)} <small>MP</small></div></div>
      <div class="ci"><div class="l">Objętość</div><div class="v">${qty(op.qtyM3)} <small>m³</small></div></div>
      <div class="ci"><div class="l">Masa</div><div class="v">${qty2(op.qtyTonne)} <small>t</small></div></div>
      <div class="ci"><div class="l">Energia</div><div class="v">${qty2(op.energyGj)} <small>GJ</small></div></div>
      ${op.valuePurchase ? `<div class="ci"><div class="l">Wartość zakupu</div><div class="v">${moneyShort(op.valuePurchase)}</div></div>` : ''}
      ${op.valueSale ? `<div class="ci"><div class="l">Wartość sprzedaży</div><div class="v">${moneyShort(op.valueSale)}</div></div>` : ''}
      ${op.chippingCost ? `<div class="ci"><div class="l">Koszt rąbania</div><div class="v">${moneyShort(op.chippingCost)}</div></div>` : ''}
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-h"><h2>Dokument</h2></div>
        <div class="card-b"><dl class="kv">
          ${row('Numer', docStamp(op.docNo))}
          ${row('Typ operacji', typeTag(op.type))}
          ${row('Data operacji', date(op.operationDate))}
          ${row('Data załadunku', op.loadingDate ? date(op.loadingDate) : '')}
          ${row('Produkt', esc(op.productName))}
          ${row('Rodzaj', esc(op.grade))}
          ${row('Wolumen wprowadzony', `${qty(op.quantity)} ${esc(op.unit)}`)}
          ${row('Przeliczniki', `m³→MP ${op.factors.m3ToMp} · MP→t ${op.factors.mpToTonne} · t→GJ ${op.factors.tonneToGj}`)}
          ${row('Magazyn źródłowy', esc(op.warehouseFrom))}
          ${row('Magazyn docelowy', esc(op.warehouseTo))}
          ${row('Magazynowane', op.isStored ? 'TAK' : 'NIE')}
          ${row('Certyfikat', esc(op.certificate))}
          ${op.chainRef ? row('Łańcuch', `<a href="#/operacje?chain=${esc(op.chainRef)}">${esc(op.chainRef)}</a>`) : ''}
        </dl></div>
      </div>

      <div class="card">
        <div class="card-h"><h2>Strony, pochodzenie i transport</h2></div>
        <div class="card-b"><dl class="kv">
          ${row('Dostawca / źródło', esc(op.supplierName))}
          ${row('Odbiorca / cel', esc(op.recipientName))}
          ${row('Nadleśnictwo', esc(op.forestDistrict))}
          ${row('Leśnictwo', esc(op.forestRange))}
          ${row('Nr kwitu wywozowego', esc(op.haulageNoteNo))}
          ${row('Miejsce załadunku', esc(op.loadingPlace))}
          ${row('Miejsce pochodzenia', esc(op.originPlace))}
          ${row('Przewoźnik', esc(op.carrierName))}
          ${row('Nr rejestracyjny', esc(op.vehiclePlate))}
          ${row('Odległość', op.distanceKm ? `${qty(op.distanceKm)} km` : '')}
          ${row('Koszt transportu', op.transportCost ? money(op.transportCost) : '')}
          ${row('Rąbanie', esc(op.chippingMode))}
          ${row('Cena zakupu', op.pricePurchase ? money(op.pricePurchase) : '')}
          ${row('Cena sprzedaży', op.priceSale ? money(op.priceSale) : '')}
        </dl></div>
      </div>
    </div>

    ${op.chain?.length ? `<div class="card">
      <div class="card-h"><h2>Łańcuch dokumentów ${esc(op.chainRef)}</h2></div>
      <div class="card-b flush"><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Dokument</th><th>Typ</th><th>Produkt</th><th class="num">MP</th><th>Status</th></tr></thead>
        <tbody>${op.chain.map((c) => `<tr>
          <td><a href="#/operacje/${esc(c.id)}">${docStamp(c.docNo)}</a></td>
          <td>${typeTag(c.type)}</td>
          <td>${esc(c.productName)}</td>
          <td class="num">${qty(c.qtyMp)}</td>
          <td>${c.status === 'CANCELLED' ? '<span class="tag CANCELLED">ANULOWANY</span>' : '<span class="tag OPEN">OK</span>'}</td>
        </tr>`).join('')}</tbody>
      </table></div></div>
    </div>` : ''}

    <div class="card">
      <div class="card-h">
        <h2>Załączniki i metryka</h2>
        <span class="sub">${op.attachments.length} plik(ów) · ${op.corrections} korekt(y)</span>
      </div>
      <div class="card-b">
        ${op.attachments.length ? `<div class="thumbs" style="margin-bottom:14px">
          ${op.attachments.map((a) => `<div class="thumb" data-att="${esc(a.id)}" data-mime="${esc(a.mimeType)}" title="${esc(a.filename)}">
            ${a.mimeType === 'application/pdf' ? '<div class="pdf">PDF</div>' : `<img data-src="${esc(a.id)}" alt="${esc(a.filename)}">`}
          </div>`).join('')}
        </div>` : '<p style="color:var(--ink-3);font-size:13px;margin-bottom:14px">Brak załączonych skanów.</p>'}
        <dl class="kv">
          ${row('Podpis zatwierdzającego', esc(op.signature))}
          ${row('Uwagi', esc(op.notes))}
          ${row('Wprowadził', `${esc(op.createdBy)} · ${dateTime(op.createdAt)}`)}
          ${op.updatedAt ? row('Ostatnia zmiana', dateTime(op.updatedAt)) : ''}
        </dl>
        ${op.corrections > 0 ? `<a class="btn btn-sm" style="margin-top:14px" href="#/korekty?op=${esc(op.id)}">${ICONS.edit} Historia korekt (${op.corrections})</a>` : ''}
      </div>
    </div>`;

  view.querySelector('[data-act="print"]')?.addEventListener('click', () => window.print());
  view.querySelector('[data-act="cancel"]')?.addEventListener('click',
    () => cancelOperation(op.id, () => navigate('/operacje')));

  // Miniatury ładowane po zalogowaniu (żądanie z nagłówkiem Authorization).
  for (const img of view.querySelectorAll('img[data-src]')) {
    api.attachmentUrl(img.dataset.src).then((url) => { img.src = url; }).catch(() => {});
  }
  on(view, 'click', '[data-att]', async (el) => {
    try {
      const url = await api.attachmentUrl(el.dataset.att);
      if (el.dataset.mime === 'application/pdf') window.open(url, '_blank');
      else showLightbox(url);
    } catch (err) {
      toastError(err);
    }
  });
}

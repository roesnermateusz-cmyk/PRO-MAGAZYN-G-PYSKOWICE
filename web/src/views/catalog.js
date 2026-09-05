/** Kartoteki: produkty, kontrahenci, magazyny, pojazdy, nadleśnictwa. */
import api from '../core/api.js';
import { esc, on, options, formValues, markFieldErrors } from '../core/dom.js';
import { qty } from '../core/format.js';
import {
  pageHead, empty, loading, openModal, closeModal, toast, toastError, confirmDialog, alertBox,
} from '../core/ui.js';
import { ICONS } from '../components/icons.js';
import { can, invalidateCatalog } from '../core/store.js';

const TABS = [
  { id: 'produkty', label: 'Produkty' },
  { id: 'kontrahenci', label: 'Kontrahenci' },
  { id: 'magazyny', label: 'Magazyny' },
  { id: 'pojazdy', label: 'Pojazdy' },
  { id: 'lasy', label: 'Nadleśnictwa' },
];

const state = { tab: 'produkty', includeInactive: false };

export async function renderCatalog(view, params = {}) {
  if (params.tab && TABS.some((t) => t.id === params.tab)) state.tab = params.tab;
  view.innerHTML = loading('Wczytywanie kartotek…');
  await refresh(view);
}

async function refresh(view) {
  const editable = can('catalog:write');
  const head = pageHead('Kartoteki', 'Słowniki systemu — produkty, kontrahenci, magazyny',
    editable ? `<button class="btn btn-primary" data-act="add">${ICONS.plus} Dodaj pozycję</button>` : '')
    + `<div class="chips">${TABS.map((t) =>
        `<button data-tab="${t.id}" class="${state.tab === t.id ? 'on' : ''}">${esc(t.label)}</button>`).join('')}
      </div>
      <div class="toolbar">
        <label class="check" style="align-items:center">
          <input type="checkbox" id="inactive" ${state.includeInactive ? 'checked' : ''}>
          <span>Pokaż także pozycje wyłączone</span>
        </label>
      </div>`;

  view.innerHTML = head + loading();
  let body;
  try {
    body = await renderTab(state.tab, editable);
  } catch (err) {
    toastError(err);
    body = empty('Nie udało się wczytać kartoteki', err.message);
  }
  view.innerHTML = head + body;

  on(view, 'click', '[data-tab]', (el) => { state.tab = el.dataset.tab; refresh(view); });
  view.querySelector('#inactive').addEventListener('change', (e) => {
    state.includeInactive = e.target.checked;
    refresh(view);
  });
  view.querySelector('[data-act="add"]')?.addEventListener('click', () => openForm(view, null));
  on(view, 'click', '[data-edit]', async (el) => {
    const item = JSON.parse(el.dataset.item);
    openForm(view, item);
  });
  on(view, 'click', '[data-deactivate]', (el) => deactivate(view, el.dataset.deactivate));
}

async function renderTab(tab, editable) {
  const params = { includeInactive: String(state.includeInactive) };

  if (tab === 'produkty') {
    const { items } = await api.get('/products', params);
    return table(
      ['Kod', 'Nazwa', 'Kategoria', 'Jedn.', 'm³→MP', 'MP→t', 't→GJ', 'Status', ''],
      items.map((p) => `<tr${p.isActive ? '' : ' style="opacity:.55"'}>
        <td style="font-family:var(--font-mono);font-size:12px">${esc(p.code)}</td>
        <td><b>${esc(p.name)}</b></td>
        <td>${esc(p.category)}</td>
        <td>${esc(p.defaultUnit)}</td>
        <td class="num">${p.m3ToMp ?? '<span style="color:var(--ink-3)">globalny</span>'}</td>
        <td class="num">${p.mpToTonne ?? '<span style="color:var(--ink-3)">globalny</span>'}</td>
        <td class="num">${p.tonneToGj ?? '<span style="color:var(--ink-3)">globalny</span>'}</td>
        <td>${statusTag(p.isActive)}</td>
        <td>${editable ? actionButtons(p, p.isActive) : ''}</td>
      </tr>`),
      items.length,
    );
  }

  if (tab === 'kontrahenci') {
    const { items } = await api.get('/partners', params);
    return table(
      ['Kod', 'Nazwa', 'Rodzaj', 'NIP', 'Kontakt', 'Status', ''],
      items.map((p) => `<tr${p.isActive ? '' : ' style="opacity:.55"'}>
        <td style="font-family:var(--font-mono);font-size:12px">${esc(p.code)}</td>
        <td><b>${esc(p.name)}</b>${p.address ? `<br><span style="font-size:11px;color:var(--ink-3)">${esc(p.address)}</span>` : ''}</td>
        <td>${esc(p.kind)}</td>
        <td style="font-family:var(--font-mono);font-size:12px">${esc(p.nip || '—')}</td>
        <td style="font-size:12px">${esc([p.phone, p.email].filter(Boolean).join(' · ') || '—')}</td>
        <td>${statusTag(p.isActive)}</td>
        <td>${editable ? actionButtons(p, false) : ''}</td>
      </tr>`),
      items.length,
    );
  }

  if (tab === 'magazyny') {
    const { items } = await api.get('/warehouses', params);
    return table(
      ['Kod', 'Nazwa', 'Adres', 'Domyślny', 'Status', ''],
      items.map((w) => `<tr${w.isActive ? '' : ' style="opacity:.55"'}>
        <td style="font-family:var(--font-mono);font-size:12px">${esc(w.code)}</td>
        <td><b>${esc(w.name)}</b></td>
        <td style="font-size:12px">${esc(w.address || '—')}</td>
        <td>${w.isDefault ? '<span class="tag OPEN">domyślny</span>' : ''}</td>
        <td>${statusTag(w.isActive)}</td>
        <td>${editable ? actionButtons(w, false) : ''}</td>
      </tr>`),
      items.length,
    );
  }

  if (tab === 'pojazdy') {
    const { items } = await api.get('/vehicles', params);
    return table(
      ['Nr rejestracyjny', 'Przewoźnik', 'Opis', 'Status', ''],
      items.map((v) => `<tr${v.isActive ? '' : ' style="opacity:.55"'}>
        <td style="font-family:var(--font-mono);font-weight:700">${esc(v.plate)}</td>
        <td>${esc(v.carrierName || '—')}</td>
        <td style="font-size:12px">${esc(v.description || '—')}</td>
        <td>${statusTag(v.isActive)}</td>
        <td>${editable ? actionButtons(v, false) : ''}</td>
      </tr>`),
      items.length,
    );
  }

  const districts = (await api.get('/forest/districts')).items;
  const ranges = (await api.get('/forest/ranges')).items;
  return `<div class="grid-2">
    <div class="card">
      <div class="card-h"><h2>Nadleśnictwa</h2><span class="sub">${districts.length}</span></div>
      <div class="card-b flush"><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Nazwa</th><th>RDLP</th></tr></thead>
        <tbody>${districts.map((d) => `<tr><td><b>${esc(d.name)}</b></td><td>${esc(d.region || '—')}</td></tr>`).join('')}</tbody>
      </table></div>${districts.length ? '' : empty('Brak nadleśnictw', 'Dodają się automatycznie przy wprowadzaniu dokumentów.')}</div>
    </div>
    <div class="card">
      <div class="card-h"><h2>Leśnictwa</h2><span class="sub">${ranges.length}</span></div>
      <div class="card-b flush"><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Leśnictwo</th><th>Nadleśnictwo</th></tr></thead>
        <tbody>${ranges.map((r) => `<tr><td><b>${esc(r.name)}</b></td><td>${esc(r.districtName)}</td></tr>`).join('')}</tbody>
      </table></div>${ranges.length ? '' : empty('Brak leśnictw')}</div>
    </div>
  </div>`;
}

const statusTag = (active) => (active
  ? '<span class="tag OPEN">aktywny</span>'
  : '<span class="tag CLOSED">wyłączony</span>');

const actionButtons = (item, canDeactivate) => `
  <button class="icon-btn" data-edit="1" data-item='${esc(JSON.stringify(item))}' title="Edytuj">${ICONS.edit}</button>
  ${canDeactivate ? `<button class="icon-btn danger" data-deactivate="${esc(item.id)}" title="Wyłącz">${ICONS.trash}</button>` : ''}`;

const table = (headers, rows, count) => `<div class="card"><div class="card-b flush">
  <div class="tbl-wrap"><table class="tbl">
    <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table></div>
  ${count ? '' : empty('Brak pozycji', 'Dodaj pierwszą pozycję przyciskiem u góry.')}
</div></div>`;

/* ------------------------------ Formularze ----------------------------- */

const FORMS = {
  produkty: {
    endpoint: '/products',
    title: 'Produkt',
    fields: (d = {}) => `
      <div class="form-grid">
        <div class="fld wide"><label for="name">Nazwa *</label>
          <input type="text" id="name" name="name" value="${esc(d.name ?? '')}" required></div>
        <div class="fld"><label for="category">Kategoria</label>
          <select id="category" name="category">${options(
            ['SUROWIEC', 'ZREBKA', 'PRODUKT_UBOCZNY', 'INNE'], d.category ?? 'INNE')}</select></div>
        <div class="fld"><label for="defaultUnit">Jednostka domyślna</label>
          <select id="defaultUnit" name="defaultUnit">${options(['M3', 'MP', 'TONA'], d.defaultUnit ?? 'MP')}</select></div>
        <div class="fld"><label for="m3ToMp">Przelicznik m³ → MP</label>
          <input type="number" id="m3ToMp" name="m3ToMp" value="${esc(d.m3ToMp ?? '')}" step="0.001" min="0.001" placeholder="puste = globalny"></div>
        <div class="fld"><label for="mpToTonne">Przelicznik MP → tona</label>
          <input type="number" id="mpToTonne" name="mpToTonne" value="${esc(d.mpToTonne ?? '')}" step="0.001" min="0.001" placeholder="puste = globalny"></div>
        <div class="fld"><label for="tonneToGj">Przelicznik tona → GJ</label>
          <input type="number" id="tonneToGj" name="tonneToGj" value="${esc(d.tonneToGj ?? '')}" step="0.001" min="0.001" placeholder="puste = globalny"></div>
        <div class="fld wide"><label for="notes">Uwagi</label>
          <textarea id="notes" name="notes" rows="2">${esc(d.notes ?? '')}</textarea></div>
        <div class="fld wide"><label class="check">
          <input type="checkbox" name="isActive" ${d.isActive === false ? '' : 'checked'}><span>Pozycja aktywna</span></label></div>
      </div>`,
  },
  kontrahenci: {
    endpoint: '/partners',
    title: 'Kontrahent',
    fields: (d = {}) => `
      <div class="form-grid">
        <div class="fld wide"><label for="name">Nazwa *</label>
          <input type="text" id="name" name="name" value="${esc(d.name ?? '')}" required></div>
        <div class="fld"><label for="kind">Rodzaj</label>
          <select id="kind" name="kind">${options(['DOSTAWCA', 'ODBIORCA', 'OBA', 'PRZEWOZNIK'], d.kind ?? 'OBA')}</select></div>
        <div class="fld"><label for="nip">NIP</label>
          <input type="text" id="nip" name="nip" value="${esc(d.nip ?? '')}"></div>
        <div class="fld wide"><label for="address">Adres</label>
          <input type="text" id="address" name="address" value="${esc(d.address ?? '')}"></div>
        <div class="fld"><label for="email">E-mail</label>
          <input type="text" id="email" name="email" value="${esc(d.email ?? '')}"></div>
        <div class="fld"><label for="phone">Telefon</label>
          <input type="text" id="phone" name="phone" value="${esc(d.phone ?? '')}"></div>
        <div class="fld wide"><label class="check">
          <input type="checkbox" name="isActive" ${d.isActive === false ? '' : 'checked'}><span>Pozycja aktywna</span></label></div>
      </div>`,
  },
  magazyny: {
    endpoint: '/warehouses',
    title: 'Magazyn',
    fields: (d = {}) => `
      <div class="form-grid">
        <div class="fld wide"><label for="name">Nazwa *</label>
          <input type="text" id="name" name="name" value="${esc(d.name ?? '')}" required></div>
        <div class="fld wide"><label for="address">Adres</label>
          <input type="text" id="address" name="address" value="${esc(d.address ?? '')}"></div>
        <div class="fld"><label class="check">
          <input type="checkbox" name="isDefault" ${d.isDefault ? 'checked' : ''}><span>Magazyn domyślny</span></label></div>
        <div class="fld"><label class="check">
          <input type="checkbox" name="isActive" ${d.isActive === false ? '' : 'checked'}><span>Magazyn aktywny</span></label></div>
      </div>`,
  },
  pojazdy: {
    endpoint: '/vehicles',
    title: 'Pojazd',
    fields: (d = {}) => `
      <div class="form-grid">
        <div class="fld"><label for="plate">Nr rejestracyjny *</label>
          <input type="text" id="plate" name="plate" value="${esc(d.plate ?? '')}" required style="text-transform:uppercase"></div>
        <div class="fld"><label for="carrierName">Przewoźnik / kierowca</label>
          <input type="text" id="carrierName" name="carrierName" value="${esc(d.carrierName ?? '')}"></div>
        <div class="fld wide"><label for="description">Opis</label>
          <input type="text" id="description" name="description" value="${esc(d.description ?? '')}"></div>
        <div class="fld wide"><label class="check">
          <input type="checkbox" name="isActive" ${d.isActive === false ? '' : 'checked'}><span>Pojazd aktywny</span></label></div>
      </div>`,
  },
};

function openForm(view, item) {
  const config = FORMS[state.tab];
  if (!config) {
    toast('Nadleśnictwa i leśnictwa dopisują się automatycznie przy wprowadzaniu dokumentów.');
    return;
  }

  openModal({
    title: `${config.title} — ${item ? 'edycja' : 'nowa pozycja'}`,
    body: `<form id="catForm">${config.fields(item ?? {})}</form>`,
    footer: `<button class="btn" data-modal-close>Anuluj</button>
             <button class="btn btn-primary" data-cat-save>Zapisz</button>`,
    onMount(box) {
      const form = box.querySelector('#catForm');
      box.querySelector('[data-cat-save]').onclick = async () => {
        const values = formValues(form);
        // Puste przeliczniki oznaczają „użyj wartości globalnej”.
        for (const key of ['m3ToMp', 'mpToTonne', 'tonneToGj']) {
          if (values[key] === undefined || values[key] === '') delete values[key];
        }
        try {
          if (item) await api.patch(`${config.endpoint}/${item.id}`, values);
          else await api.post(config.endpoint, values);
          toast(item ? 'Zapisano zmiany' : 'Dodano pozycję');
          invalidateCatalog();
          closeModal();
          refresh(view);
        } catch (err) {
          if (err.isValidation) markFieldErrors(form, err.details);
          else toastError(err);
        }
      };
    },
  });
}

async function deactivate(view, productId) {
  const confirmed = await confirmDialog({
    title: 'Wyłączenie produktu',
    message: 'Produkt zniknie z list wyboru, ale pozostanie w dokumentach historycznych. '
      + 'Wyłączenie jest możliwe tylko przy zerowym stanie magazynowym.',
    confirmLabel: 'Wyłącz',
    danger: true,
  });
  if (confirmed === null) return;
  try {
    await api.post(`/products/${productId}/deactivate`, {});
    toast('Produkt wyłączony');
    invalidateCatalog();
    refresh(view);
  } catch (err) {
    toastError(err);
  }
}

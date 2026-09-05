/**
 * Rejestr operacji: filtrowanie, lista, podgląd i storno dokumentu.
 *
 * Ekran listy jest złożony z komponentów warstwy `ui/`: pasek filtrów, lista
 * i stronicowanie budują się raz, a zmiana filtra podmienia wyłącznie wiersze.
 * Kolumny opisane są w jednym miejscu i obsługują oba układy — tabelę na
 * komputerze i kartę na telefonie — bez drugiego szablonu.
 */
import api from '../core/api.js';
import { esc } from '../core/dom.js';
import { qty, qty2, money, moneyShort, date, dateTime, monthLabel } from '../core/format.js';
import {
  pageHead, loading, docStamp, typeTag,
  openModal, closeModal, confirmDialog, toast, toastError, showLightbox, alertBox,
} from '../core/ui.js';
import { ICONS } from '../components/icons.js';
import { can, loadCatalog } from '../core/store.js';
import { navigate } from '../core/router.js';
import { downloadHandler, unitLabel } from './_shared.js';
import { createDataTable } from '../ui/DataTable.js';
import { createListScreen } from '../ui/ListScreen.js';

/** Filtry są modułowe, żeby przetrwały powrót z podglądu dokumentu. */
const filters = {
  q: '', type: '', productId: '', warehouseId: '', month: '', chainRef: '',
  status: 'POSTED', limit: 50, offset: 0,
};

/** Ekran listy — trzymany między wejściami, żeby dało się go posprzątać. */
let screen = null;

const counterparty = (r) => (
  ['SPRZEDAZ', 'MM'].includes(r.type) ? r.recipientName : (r.supplierName || r.originPlace)
) || '—';

const documentValue = (r) => r.valueSale || r.valuePurchase;

/**
 * Kolumny rejestru — jedno źródło dla tabeli i dla karty mobilnej.
 *
 * Pole `card` decyduje, co trafia na kartę: na telefonie mieści się kilka
 * najważniejszych wartości, nie trzynaście kolumn. Kolumny bez tego pola
 * są widoczne wyłącznie w układzie szerokim.
 */
const COLUMNS = [
  { key: 'operationDate', label: 'Data', nowrap: true, card: 'meta',
    cell: (r) => date(r.operationDate) },
  { key: 'type', label: 'Typ', card: 'title',
    cell: (r) => typeTag(r.type) },
  { key: 'docNo', label: 'Dokument', card: 'title',
    cell: (r) => docStamp(r.docNo) },
  { key: 'productName', label: 'Produkt', cls: 'ellip', card: 'body',
    cell: (r) => esc(r.productName) },
  { key: 'counterparty', label: 'Kontrahent', cls: 'ellip', card: 'body',
    cell: (r) => esc(counterparty(r)) },
  { key: 'quantity', label: 'Wolumen', align: 'num', card: 'foot', cardLabel: 'Wolumen',
    cell: (r) => `${qty(r.quantity)} ${esc(unitLabel(r.unit))}` },
  { key: 'qtyMp', label: 'MP', align: 'num',
    cell: (r) => qty(r.qtyMp) },
  { key: 'qtyTonne', label: 'Tony', align: 'num',
    cell: (r) => qty2(r.qtyTonne) },
  { key: 'value', label: 'Wartość', align: 'num', card: 'foot', cardLabel: 'Wartość',
    cell: (r) => (documentValue(r) ? moneyShort(documentValue(r)) : '—') },
  { key: 'carrierName', label: 'Przewoźnik', cls: 'ellip',
    cell: (r) => esc(r.carrierName || '—') },
  { key: 'vehiclePlate', label: 'Nr rej.', nowrap: true, cls: 'plate', card: 'body',
    cell: (r) => esc(r.vehiclePlate || '—') },
  { key: 'transportCost', label: 'Koszt tr.', align: 'num',
    cell: (r) => (r.transportCost ? moneyShort(r.transportCost) : '—') },
];

/** Przyciski wiersza — zależne od uprawnień i statusu dokumentu. */
function rowActions(r) {
  const editable = can('operations:write') && r.status === 'POSTED';
  return [
    { act: 'view', icon: 'eye', label: `Podgląd dokumentu ${r.docNo}` },
    editable && { act: 'edit', icon: 'edit', label: `Edytuj dokument ${r.docNo}` },
    editable && { act: 'dup', icon: 'copy', label: `Duplikuj dokument ${r.docNo}` },
    can('operations:cancel') && r.status === 'POSTED'
      && { act: 'cancel', icon: 'trash', label: `Storno dokumentu ${r.docNo}`, danger: true },
  ];
}

/**
 * Wiersz podsumowania — liczby pochodzą z serwera, nie są sumowane w przeglądarce.
 * Rozkład komórek musi się zgadzać z `COLUMNS` plus kolumna akcji: sześć
 * pierwszych zajmuje opis, dalej wartości liczbowe.
 */
function summaryRow(rows, totals) {
  if (!totals) return '';
  return `<td colspan="6">Razem (po filtrach)</td>
    <td class="num">${qty(totals.qtyMp)}</td>
    <td class="num">${qty2(totals.qtyTonne)}</td>
    <td class="num">${moneyShort(totals.valueSale || totals.valuePurchase)}</td>
    <td colspan="2"></td>
    <td class="num">${moneyShort(totals.transportCost)}</td>
    <td></td>`;
}

export async function renderOperations(view, params = {}) {
  if (params.id) return renderOperationDetail(view, params.id);

  // Wejście z podglądu dokumentu: `#/operacje?chain=PZ/2026/000123`
  // pokazuje komplet ogniw jednego łańcucha terenowego.
  filters.chainRef = params.chain ?? '';
  if (filters.chainRef) { filters.offset = 0; filters.status = 'ALL'; }

  view.innerHTML = loading('Wczytywanie rejestru…');
  const catalog = await loadCatalog();

  screen?.destroy();

  const table = createDataTable({
    caption: 'Rejestr dokumentów magazynowych',
    columns: COLUMNS,
    actions: rowActions,
    rowClass: (r) => (r.status === 'CANCELLED' ? 'cancelled' : ''),
    footer: (rows, totals) => summaryRow(rows, totals),
    empty: { title: 'Nic nie znaleziono', hint: 'Zmień filtry albo dodaj nowy dokument.' },
    onAction: (act, row) => {
      if (act === 'view') navigate(`/operacje/${row.id}`);
      if (act === 'edit') navigate(`/nowa?id=${row.id}`);
      if (act === 'dup') navigate(`/nowa?copy=${row.id}`);
      if (act === 'cancel') cancelOperation(row.id, () => screen.reload());
    },
  });

  screen = createListScreen({
    title: 'Rejestr operacji',
    subtitle: 'Dokumenty PZ · WZ · PW · RW · MM · BO',
    headerActions: `<button class="btn" data-act="csv">${ICONS.download} Eksport CSV</button>`
      + (can('operations:write') ? `<a href="#/nowa" class="btn btn-primary">${ICONS.plus} Dodaj</a>` : ''),
    filters,
    fields: [
      { type: 'chips', name: 'type', label: 'Typ dokumentu',
        options: [
          { value: '', label: 'Wszystkie' }, { value: 'ZAKUP', label: 'ZAKUP' },
          { value: 'SPRZEDAZ', label: 'SPRZEDAZ' }, { value: 'PRODUKCJA', label: 'PRODUKCJA' },
          { value: 'ZUZYCIE', label: 'ZUZYCIE' }, { value: 'MM', label: 'MM' },
          { value: 'BO', label: 'BO' },
        ] },
      { type: 'search', name: 'q', label: 'Szukaj w rejestrze',
        placeholder: 'Szukaj: dokument, kontrahent, rejestracja, kwit…' },
      { type: 'select', name: 'productId', label: 'Produkt',
        options: catalog.products, placeholder: 'Produkt: wszystkie' },
      { type: 'select', name: 'warehouseId', label: 'Magazyn',
        options: catalog.warehouses, placeholder: 'Magazyn: wszystkie' },
      { type: 'month', name: 'month', label: 'Miesiąc' },
      { type: 'select', name: 'status', label: 'Status dokumentu',
        options: [
          { id: 'POSTED', name: 'Zaksięgowane' },
          { id: 'CANCELLED', name: 'Anulowane' },
          { id: 'ALL', name: 'Wszystkie' },
        ] },
    ],
    table,
    load: (f) => api.get('/operations', f),
    select: (data) => ({
      rows: data.items,
      page: data.page,
      status: `${data.page.total} dokument(ów)`,
      extra: data.totals,
    }),
    onMount: (root) => {
      root.querySelector('[data-act="csv"]').addEventListener('click', downloadHandler(
        '/operations/export.csv', () => filters, 'rejestr-operacji.csv', 'Plik CSV został pobrany',
      ));
      if (filters.chainRef) {
        root.querySelector('[data-ls-filters]').insertAdjacentHTML('beforebegin', alertBox('info',
          `Widok ograniczony do łańcucha ${filters.chainRef}. `
          + 'Aby wrócić do pełnego rejestru, wybierz „Wszystkie” w filtrze typu.'));
      }
    },
  });

  await screen.mount(view);
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

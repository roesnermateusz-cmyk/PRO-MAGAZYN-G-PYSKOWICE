/**
 * Szkielet aplikacji: sidebar (desktop), pasek zakładek (telefon),
 * narzędzia globalne i kontener widoku.
 */
import { esc } from '../core/dom.js';
import { ICONS, iconSprite } from './icons.js';
import { store, can } from '../core/store.js';
import { initials } from '../core/format.js';
import { availableWarehouses, activeWarehouseId } from '../core/warehouse.js';

/**
 * Definicja nawigacji.
 * `tab: true` — pozycja widoczna w dolnym pasku na telefonie.
 * `perm`      — wymagane uprawnienie; pozycje bez uprawnienia są ukrywane.
 *
 * Ta lista zasila trzy miejsca naraz: sidebar (desktop), dolny pasek zakładek
 * i panel „Więcej” (telefon). Dolny pasek mieści pięć pozycji, a system ma ich
 * dwanaście — bez panelu „Więcej” okresy, korekty, kartoteki, użytkownicy
 * i ustawienia były na telefonie nieosiągalne inaczej niż przez ręczne wpisanie
 * adresu. Nowa pozycja dopisana tutaj pojawia się we wszystkich trzech.
 */
export const NAV = [
  { id: 'pulpit', label: 'Pulpit', icon: 'dashboard', perm: 'reports:read', tab: true },
  { id: 'operacje', label: 'Operacje', icon: 'list', perm: 'operations:read', tab: true },
  { id: 'nowa', label: 'Nowa operacja', icon: 'plus', perm: 'operations:write', tab: 'add' },
  { id: 'magazyn', label: 'Magazyn', icon: 'warehouse', perm: 'stock:read', tab: true },
  { id: 'produkcja', label: 'Produkcja dnia', icon: 'factory', perm: 'reports:read' },
  { id: 'raporty', label: 'Raporty', icon: 'chart', perm: 'reports:read', tab: true },
  { group: 'Kartoteki i kontrola' },
  { id: 'kartoteki', label: 'Kartoteki', icon: 'book', perm: 'catalog:read' },
  { id: 'korekty', label: 'Korekty', icon: 'edit', perm: 'corrections:read' },
  { id: 'historia', label: 'Historia zmian', icon: 'history', perm: 'audit:read' },
  { id: 'okresy', label: 'Okresy', icon: 'calendar', perm: 'periods:read' },
  { group: 'System' },
  { id: 'uzytkownicy', label: 'Użytkownicy', icon: 'users', perm: 'users:read' },
  { id: 'ustawienia', label: 'Ustawienia', icon: 'settings', perm: 'settings:read' },
];

const visible = () => NAV.filter((item) => item.group || can(item.perm));

/** Renderuje szkielet aplikacji w kontenerze `#root`. */
export function renderLayout(root) {
  const items = visible();
  const company = store.meta?.company?.name ?? 'ResInvest Commodities';

  root.innerHTML = `
    ${iconSprite()}
    <div class="app-tools">
      <button class="app-tool" data-tool="home" title="Pulpit" aria-label="Pulpit">${ICONS.home}</button>
      <button class="app-tool" data-tool="print" title="Drukuj bieżący widok" aria-label="Drukuj">${ICONS.print}</button>
      <button class="app-tool" data-tool="logout" title="Wyloguj" aria-label="Wyloguj">${ICONS.logout}</button>
    </div>

    <div class="mobile-top">
      <div>
        <div class="logo">ResInvest <em>ERP</em></div>
        <div class="m-sub">Magazyn biomasy</div>
      </div>
      <div class="m-context">
        <span class="m-wh">${esc(activeWarehouseLabel())}</span>
        <span class="m-role">${esc(store.user?.role ?? '')}</span>
      </div>
    </div>

    <div class="app">
      <aside class="sidebar">
        <div class="brand">
          <div class="logo">ResInvest <em>Commodities</em></div>
          <div class="sub">ERP · Magazyn biomasy</div>
        </div>
        ${warehousePicker()}
        <nav class="menu" id="menu">
          ${items.map((item) => (item.group
            ? `<div class="menu-sep">${esc(item.group)}</div>`
            : `<a href="#/${item.id}" data-nav="${item.id}">${ICONS[item.icon]}<span>${esc(item.label)}</span></a>`)).join('')}
        </nav>
        <div class="side-foot">
          <div class="side-user">
            <div class="avatar">${esc(initials(store.user?.fullName))}</div>
            <div class="who">
              <b>${esc(store.user?.fullName ?? '')}</b>
              <span>${esc(store.user?.role ?? '')}</span>
            </div>
          </div>
          <b>${esc(company)}</b><br>
          ${esc(store.meta?.company?.address ?? '')}
        </div>
      </aside>

      <main id="view"><div class="loading">Wczytywanie…</div></main>
    </div>

    <nav class="tabbar" id="tabbar">
      ${items.filter((i) => i.tab).map((item) => (item.tab === 'add'
        ? `<a href="#/${item.id}" data-nav="${item.id}" class="tab-add"><span class="tab-plus">${ICONS.plus}</span><span>Dodaj</span></a>`
        : `<a href="#/${item.id}" data-nav="${item.id}">${ICONS[item.icon]}<span>${esc(item.label)}</span></a>`)).join('')}
      <button type="button" class="tab-more" data-tool="more" aria-expanded="false" aria-controls="moresheet">
        ${ICONS.more}<span>Więcej</span>
      </button>
    </nav>

    <div class="sheet-back" id="moreback" hidden></div>
    <nav class="sheet" id="moresheet" hidden aria-label="Pozostałe sekcje">
      <div class="sheet-grip"></div>
      <div class="sheet-h">
        <b>Wszystkie sekcje</b>
        <button type="button" class="icon-btn" data-tool="more-close" aria-label="Zamknij">${ICONS.close}</button>
      </div>
      <div class="sheet-b">
        ${items.map((item) => (item.group
          ? `<div class="menu-sep">${esc(item.group)}</div>`
          : `<a href="#/${item.id}" data-nav="${item.id}">${ICONS[item.icon]}<span>${esc(item.label)}</span></a>`)).join('')}
      </div>
    </nav>

    ${can('operations:write') ? `<a href="#/nowa" class="fab" title="Nowa operacja" aria-label="Nowa operacja">${ICONS.plus}</a>` : ''}
  `;
}

/** Podświetla aktywną pozycję nawigacji. */
export function setActiveNav(routeId) {
  document.querySelectorAll('[data-nav]').forEach((el) => {
    el.classList.toggle('active', el.dataset.nav === routeId);
  });
}


/* --------------------------- Kontekst pracy ---------------------------- */

/** Nazwa aktywnego magazynu — skrót pokazywany na telefonie. */
function activeWarehouseLabel() {
  const lista = availableWarehouses();
  const aktywny = lista.find((w) => w.id === activeWarehouseId());
  if (aktywny) return aktywny.name;
  return lista.length > 1 ? 'Wszystkie magazyny' : (lista[0]?.name ?? '');
}

/**
 * Przełącznik magazynu.
 *
 * Przy jednym dostępnym placu nie ma czego przełączać — pokazujemy samą nazwę,
 * żeby użytkownik wiedział, gdzie księguje, ale bez pola wyboru udającego
 * decyzję, której nie ma.
 */
function warehousePicker() {
  const lista = availableWarehouses();
  if (!lista.length) return '';

  if (lista.length === 1) {
    return `<div class="wh-picker single">
      <span class="wh-label">Magazyn</span>
      <b class="wh-name">${esc(lista[0].name)}</b>
    </div>`;
  }

  const aktywny = activeWarehouseId() ?? '';
  return `<div class="wh-picker">
    <label class="wh-label" for="whPick">Magazyn</label>
    <select id="whPick" data-tool="warehouse" aria-label="Wybierz magazyn">
      <option value=""${aktywny === '' ? ' selected' : ''}>Wszystkie magazyny</option>
      ${lista.map((w) => `<option value="${esc(w.id)}"${w.id === aktywny ? ' selected' : ''}>${esc(w.name)}</option>`).join('')}
    </select>
  </div>`;
}

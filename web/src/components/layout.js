/**
 * Szkielet aplikacji: sidebar (desktop), pasek zakładek (telefon),
 * narzędzia globalne i kontener widoku.
 */
import { esc } from '../core/dom.js';
import { ICONS } from './icons.js';
import { store, can } from '../core/store.js';
import { initials } from '../core/format.js';

/**
 * Definicja nawigacji.
 * `tab: true` — pozycja widoczna w dolnym pasku na telefonie.
 * `perm`      — wymagane uprawnienie; pozycje bez uprawnienia są ukrywane.
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
      <div style="font-family:var(--font-mono);font-size:11px;color:#A9CFB6">${esc(store.user?.role ?? '')}</div>
    </div>

    <div class="app">
      <aside class="sidebar">
        <div class="brand">
          <div class="logo">ResInvest <em>Commodities</em></div>
          <div class="sub">ERP · Magazyn biomasy</div>
        </div>
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

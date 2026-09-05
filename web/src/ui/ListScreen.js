/**
 * ListScreen — złożenie ekranu listowego z gotowych części.
 *
 * Wszystkie ekrany listowe systemu mają ten sam kształt: nagłówek, pasek
 * filtrów, lista, stronicowanie. Różnią się wyłącznie deklaracją kolumn
 * i adresem, spod którego biorą dane. Ten moduł zapisuje ten kształt raz.
 *
 * CO ZAŁATWIA POZA SKŁADANIEM
 *
 * 1. Aktualizację częściową. Nagłówek i pasek filtrów powstają jeden raz,
 *    przy wejściu na ekran. Zmiana filtra podmienia tylko wiersze listy.
 *
 * 2. Porzucanie nieaktualnych odpowiedzi. Filtry zmienia się szybciej, niż
 *    serwer odpowiada — dwa kliknięcia pod rząd potrafią wrócić w odwrotnej
 *    kolejności i wtedy na ekranie zostaje wynik STARSZEGO zapytania, mimo
 *    że filtr pokazuje nowszy. Każde żądanie dostaje numer; odpowiedź
 *    z numerem innym niż ostatnio wysłany jest wyrzucana.
 *
 * 3. Stan wczytywania i błędu. Lista przygasa zamiast znikać, więc ekran nie
 *    skacze, a użytkownik nie traci kontekstu.
 */
import { esc } from '../core/dom.js';
import { toastError } from '../core/ui.js';
import { createToolbar } from './Toolbar.js';
import { createPager } from './Pager.js';

/**
 * @param {object} spec
 * @param {string} spec.title
 * @param {string} [spec.subtitle]
 * @param {string} [spec.headerActions] HTML przycisków w nagłówku
 * @param {object} spec.filters          obiekt filtrów (mutowany na miejscu)
 * @param {Array} [spec.fields]          pola paska filtrów
 * @param {object} spec.table            komponent listy (`createDataTable`)
 * @param {(filters:object)=>Promise} spec.load   pobranie danych
 * @param {(data:any)=>{rows:any[], page?:object, status?:string, extra?:any}} spec.select
 *        wyciąga z odpowiedzi to, czego potrzebują komponenty
 * @param {(view:HTMLElement)=>void} [spec.onMount] dodatkowe podpięcia
 */
export function createListScreen(spec) {
  const {
    title, subtitle = '', headerActions = '', filters, fields = [],
    table, load, select, onMount = null,
  } = spec;

  let toolbar = null;
  let pager = null;
  let token = 0;
  let host = null;

  /** Pobranie danych i podmiana wyłącznie tego, co się zmieniło. */
  async function refresh() {
    const mine = ++token;
    table.setBusy(true);
    try {
      const data = await load(filters);
      // Odpowiedź na porzucone żądanie — filtr zdążył się zmienić.
      if (mine !== token) return;

      const { rows, page, status, extra } = select(data);
      table.setRows(rows, extra);
      if (status !== undefined) toolbar?.setStatus(status);
      if (page) pager?.update(page);
    } catch (err) {
      if (mine !== token) return;
      table.setRows([]);
      toastError(err);
    } finally {
      if (mine === token) table.setBusy(false);
    }
  }

  const api = {
    /** Buduje ekran raz i wykonuje pierwsze pobranie. */
    async mount(view) {
      host = view;
      view.innerHTML = `
        <div class="page-head">
          <div>
            <div class="crumb">${esc(subtitle)}</div>
            <h1>${esc(title)}</h1>
          </div>
          ${headerActions ? `<div class="page-actions">${headerActions}</div>` : ''}
        </div>
        <div data-ls-filters></div>
        <div class="card" data-ls-list></div>`;

      if (fields.length) {
        toolbar = createToolbar({
          fields,
          value: filters,
          onChange: (patch) => {
            Object.assign(filters, patch, { offset: 0 });
            refresh();
          },
        }).mount(view.querySelector('[data-ls-filters]'));
      }

      const listBox = view.querySelector('[data-ls-list]');
      table.mount(listBox);
      pager = createPager({
        onPage: (direction) => {
          const step = direction === 'next' ? filters.limit : -filters.limit;
          filters.offset = Math.max(0, (filters.offset ?? 0) + step);
          refresh();
        },
      }).mount(listBox);

      onMount?.(view);
      await refresh();
      return api;
    },

    /** Ponowne pobranie po zapisie, stornie albo imporcie. */
    reload: refresh,

    destroy() {
      token += 1;                      // unieważnia odpowiedzi w locie
      toolbar?.destroy();
      pager?.destroy();
      table.destroy();
      toolbar = null;
      pager = null;
      host = null;
    },

    get element() { return host; },
  };

  return api;
}

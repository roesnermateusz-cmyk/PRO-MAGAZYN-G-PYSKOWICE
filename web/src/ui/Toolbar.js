/**
 * Toolbar — pasek filtrów budowany raz, z deklaracji.
 *
 * PROBLEM, KTÓRY TO ROZWIĄZUJE
 * Widoki przebudowywały cały ekran przy każdej zmianie filtra, razem z paskiem
 * filtrów. Skutki były dwa, oba dokuczliwe w codziennej pracy:
 *
 *  • Fokus i kursor znikały. Magazynier wpisywał frazę, naciskał Enter — pole
 *    wyszukiwania było w tym momencie zastępowane nowym, pustym elementem,
 *    więc kursor lądował poza formularzem, a dopisanie litery wymagało
 *    ponownego kliknięcia w pole.
 *  • Listy rozwijane produktów i magazynów były serializowane od nowa przy
 *    każdym kliknięciu w filtr, choć kartoteka się nie zmieniła.
 *
 * ZASADA
 * Pasek powstaje raz przy wejściu na ekran. Zmiana filtra nie dotyka jego
 * struktury — aktualizuje się wyłącznie licznik wyników (`setStatus`).
 * Wartości pól są źródłem prawdy dla filtrów, więc nie trzeba ich odtwarzać.
 *
 * DOSTĘPNOŚĆ
 *  • każde pole ma etykietę (`aria-label` tam, gdzie etykieta wizualna byłaby
 *    szumem — pasek filtrów jest gęsty),
 *  • grupa „chipów” to `role="group"` z `aria-pressed` na przyciskach,
 *    dzięki czemu czytnik mówi, który filtr jest włączony,
 *  • licznik wyników jest `aria-live="polite"` — zmiana liczby dokumentów
 *    po przefiltrowaniu jest ogłaszana bez przerywania pracy.
 */
import { esc, on, options } from '../core/dom.js';

/**
 * @typedef {object} Field
 * @property {'search'|'select'|'month'|'date'|'chips'} type
 * @property {string} name          klucz filtra
 * @property {string} label         etykieta dla czytnika ekranu
 * @property {string} [placeholder]
 * @property {Array} [options]      dla `select` i `chips`
 * @property {string} [valueKey]    domyślnie `id`
 * @property {string} [labelKey]    domyślnie `name`
 */

/**
 * @param {object} spec
 * @param {Field[]} spec.fields
 * @param {object} spec.value              bieżące wartości filtrów
 * @param {(patch:object)=>void} spec.onChange
 * @param {string} [spec.status]           tekst licznika wyników
 */
export function createToolbar({ fields, value, onChange, status = '' }) {
  let root = null;
  let detach = [];

  const fieldHtml = (f) => {
    const id = `f-${f.name}`;
    const current = value[f.name] ?? '';

    switch (f.type) {
      case 'search':
        return `<input type="search" id="${id}" data-tb="${esc(f.name)}"
                       placeholder="${esc(f.placeholder ?? '')}" aria-label="${esc(f.label)}"
                       value="${esc(current)}">`;
      case 'select':
        return `<select id="${id}" data-tb="${esc(f.name)}" aria-label="${esc(f.label)}">${
          options(f.options ?? [], current, {
            valueKey: f.valueKey ?? 'id',
            labelKey: f.labelKey ?? 'name',
            placeholder: f.placeholder ?? '',
          })}</select>`;
      case 'month':
      case 'date':
        return `<input type="${f.type}" id="${id}" data-tb="${esc(f.name)}"
                       aria-label="${esc(f.label)}" value="${esc(current)}">`;
      default:
        return '';
    }
  };

  const chipsHtml = (f) => `<div class="chips" role="group" aria-label="${esc(f.label)}">${
    (f.options ?? []).map((o) => {
      const val = typeof o === 'string' ? o : o.value;
      const text = typeof o === 'string' ? (o || 'Wszystkie') : o.label;
      const on_ = String(value[f.name] ?? '') === String(val ?? '');
      return `<button type="button" data-tb-chip="${esc(f.name)}" data-tb-value="${esc(val ?? '')}"
                      class="${on_ ? 'on' : ''}" aria-pressed="${on_}">${esc(text)}</button>`;
    }).join('')}</div>`;

  const api = {
    mount(container) {
      root = document.createElement('div');
      root.className = 'tb';

      const chips = fields.filter((f) => f.type === 'chips');
      const inputs = fields.filter((f) => f.type !== 'chips');

      root.innerHTML = chips.map(chipsHtml).join('')
        + `<div class="toolbar">${inputs.map(fieldHtml).join('')}`
        + `<span class="count-pill" data-tb-status aria-live="polite">${esc(status)}</span></div>`;
      container.appendChild(root);

      // `change` zamiast `input`: filtrowanie po każdej literze wywołałoby
      // żądanie na znak. Pole wyszukiwania reaguje też na Enter (`search`).
      detach.push(on(root, 'change', '[data-tb]', (el) => {
        onChange({ [el.dataset.tb]: el.value.trim() });
      }));
      detach.push(on(root, 'search', '[data-tb]', (el) => {
        onChange({ [el.dataset.tb]: el.value.trim() });
      }));
      detach.push(on(root, 'click', '[data-tb-chip]', (el) => {
        const name = el.dataset.tbChip;
        const next = el.dataset.tbValue;
        root.querySelectorAll(`[data-tb-chip="${name}"]`).forEach((b) => {
          const active = b === el;
          b.classList.toggle('on', active);
          b.setAttribute('aria-pressed', String(active));
        });
        onChange({ [name]: next });
      }));

      return api;
    },

    /** Aktualizuje licznik wyników — jedyna zmiana paska po zmianie filtra. */
    setStatus(text) {
      const el = root?.querySelector('[data-tb-status]');
      if (el) el.textContent = text;
      return api;
    },

    /** Ustawia wartość pola bez wywoływania `onChange` (np. reset filtrów). */
    setValue(name, next) {
      value[name] = next;
      const el = root?.querySelector(`[data-tb="${name}"]`);
      if (el) el.value = next ?? '';
      root?.querySelectorAll(`[data-tb-chip="${name}"]`).forEach((b) => {
        const active = String(b.dataset.tbValue) === String(next ?? '');
        b.classList.toggle('on', active);
        b.setAttribute('aria-pressed', String(active));
      });
      return api;
    },

    destroy() {
      detach.forEach((off) => off());
      detach = [];
      root?.remove();
      root = null;
    },
  };

  return api;
}

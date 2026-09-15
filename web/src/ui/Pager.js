/**
 * Pager — przewijanie stron wyników.
 *
 * Osobny komponent, bo stronicowanie zmienia się przy każdym filtrze, a lista
 * i pasek filtrów nie muszą przez to przechodzić przebudowy. Aktualizuje
 * wyłącznie własne trzy elementy: dwa przyciski i opis zakresu.
 *
 * DOSTĘPNOŚĆ
 *  • `<nav>` z etykietą — czytnik zapowiada obszar nawigacji po wynikach,
 *  • zakres („51–100 z 304”) jako `aria-live="polite"`: po przejściu strony
 *    użytkownik niewidomy słyszy, gdzie się znalazł,
 *  • przyciski wyłączane atrybutem `disabled`, nie samym stylem — inaczej
 *    fokus wędrowałby na element, który nic nie robi.
 */
import { esc } from '../core/dom.js';

/**
 * @param {object} spec
 * @param {(direction:'prev'|'next')=>void} spec.onPage
 * @param {string} [spec.label] opis obszaru dla czytnika ekranu
 */
export function createPager({ onPage, label = 'Strony wyników' }) {
  let root = null;
  let handler = null;

  const api = {
    mount(container) {
      root = document.createElement('nav');
      root.className = 'pager';
      root.setAttribute('aria-label', esc(label));
      root.hidden = true;
      root.innerHTML = `
        <button type="button" class="btn btn-sm" data-pg="prev">← Poprzednie</button>
        <span data-pg-range aria-live="polite"></span>
        <button type="button" class="btn btn-sm" data-pg="next">Następne →</button>`;
      container.appendChild(root);

      handler = (ev) => {
        const button = ev.target.closest('[data-pg]');
        if (button && !button.disabled) onPage(button.dataset.pg);
      };
      root.addEventListener('click', handler);
      return api;
    },

    /** @param {{total:number, limit:number, offset:number}} page */
    update(page) {
      if (!root) return api;
      const { total = 0, limit = 50, offset = 0 } = page ?? {};
      if (!total || total <= limit) {
        root.hidden = true;
        return api;
      }
      const from = offset + 1;
      const to = Math.min(offset + limit, total);
      root.hidden = false;
      root.querySelector('[data-pg-range]').textContent = `${from}–${to} z ${total}`;
      root.querySelector('[data-pg="prev"]').disabled = offset === 0;
      root.querySelector('[data-pg="next"]').disabled = to >= total;
      return api;
    },

    destroy() {
      if (root && handler) root.removeEventListener('click', handler);
      root?.remove();
      root = null;
    },
  };

  return api;
}

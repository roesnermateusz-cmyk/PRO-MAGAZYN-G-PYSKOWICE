/**
 * Narzędzia DOM — minimalna warstwa zamiast frameworka.
 *
 * Widoki budują HTML jako tekst (szybko i czytelnie), a interaktywność
 * podpinamy delegacją zdarzeń po atrybutach `data-*`. Dane wstawiane do
 * szablonu ZAWSZE przechodzą przez `esc()`.
 */

/** Ucieczka HTML — jedyny dozwolony sposób wstawiania danych do szablonu. */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** Ucieczka do atrybutu — skrót czytelniejszy w szablonach. */
export const attr = esc;

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Ustawia zawartość kontenera. */
export function render(container, html) {
  container.innerHTML = html;
  return container;
}

/**
 * Delegacja zdarzeń: `on(root, 'click', '[data-act="edit"]', (el, ev) => …)`.
 * Zwraca funkcję odpinającą — przydatną przy przełączaniu widoków.
 */
export function on(root, type, selector, handler) {
  const listener = (ev) => {
    const el = ev.target.closest(selector);
    if (el && root.contains(el)) handler(el, ev);
  };
  root.addEventListener(type, listener);
  return () => root.removeEventListener(type, listener);
}

/** Odczytuje wartości formularza jako obiekt (checkbox → boolean, number → liczba). */
export function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else if (el.type === 'number') out[el.name] = el.value === '' ? undefined : Number(el.value);
    else out[el.name] = el.value;
  }
  return out;
}

/** Zaznacza pola z błędami walidacji zwróconymi przez API. */
export function markFieldErrors(form, details = []) {
  form.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
  form.querySelectorAll('.err').forEach((el) => el.remove());
  let first = null;
  for (const item of details) {
    const field = form.elements[item.field];
    if (!field) continue;
    field.classList.add('invalid');
    const msg = document.createElement('div');
    msg.className = 'err';
    msg.textContent = item.message;
    field.parentElement?.appendChild(msg);
    if (!first) first = field;
  }
  first?.focus();
  first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/** Buduje `<option>`; `selected` porównywane po wartości. */
export function options(items, selected, { valueKey = 'id', labelKey = 'name', placeholder = '' } = {}) {
  const head = placeholder ? `<option value="">${esc(placeholder)}</option>` : '';
  return head + items.map((item) => {
    const value = typeof item === 'string' ? item : item[valueKey];
    const label = typeof item === 'string' ? item : item[labelKey];
    return `<option value="${attr(value)}"${String(selected ?? '') === String(value) ? ' selected' : ''}>${esc(label)}</option>`;
  }).join('');
}

/** Lista podpowiedzi `<datalist>` dla pól tekstowych. */
export function datalist(id, values) {
  const unique = [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'pl'));
  return `<datalist id="${attr(id)}">${unique.map((v) => `<option value="${attr(v)}"></option>`).join('')}</datalist>`;
}

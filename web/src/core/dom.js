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

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];


/**
 * Rejestr uchwytów delegowanych, trzymany na samym węźle kontenera.
 *
 * Powód jest praktyczny. Widoki wiążą uchwyty przy KAŻDYM odświeżeniu listy,
 * a `innerHTML` wymienia wyłącznie dzieci — kontener zostaje ten sam i zbiera
 * kolejne kopie tego samego uchwytu. Skutek jest cichy i groźny: po drugim
 * odświeżeniu jedno kliknięcie wysyła dwa żądania. Wyszło to na przywracaniu
 * zamkniętego placu — drugie żądanie wracało z 409 „magazyn jest już aktywny”,
 * a przy operacji bez takiej blokady powstałby po prostu podwójny zapis.
 */
const DELEGATES = Symbol('uchwyty delegowane');

/**
 * Delegacja zdarzeń: `on(root, 'click', '[data-act="edit"]', (el, ev) => …)`.
 *
 * Para `typ|selektor` ma na danym kontenerze dokładnie JEDEN uchwyt: ponowne
 * wiązanie zastępuje poprzedni, więc widok może wołać `on()` przy każdym
 * renderze i nie musi pamiętać o sprzątaniu.
 *
 * Zwraca funkcję odpinającą — przydatną przy przełączaniu widoków.
 */
export function on(root, type, selector, handler) {
  const rejestr = (root[DELEGATES] ??= new Map());
  const klucz = `${type}|${selector}`;
  rejestr.get(klucz)?.();

  const listener = (ev) => {
    const el = ev.target.closest(selector);
    if (el && root.contains(el)) handler(el, ev);
  };
  root.addEventListener(type, listener);

  const off = () => {
    root.removeEventListener(type, listener);
    if (rejestr.get(klucz) === off) rejestr.delete(klucz);
  };
  rejestr.set(klucz, off);
  return off;
}

/**
 * Zdejmuje wszystkie uchwyty delegowane z kontenera.
 *
 * Woła to router przy zmianie widoku: element `#view` przeżywa nawigację,
 * więc bez tego uchwyty poprzedniego widoku zostawałyby na żywym węźle
 * i reagowały na cudzy DOM przy zbieżnych selektorach (`[data-tab]`,
 * `[data-edit]` powtarzają się w kilku widokach).
 */
export function detachAll(root) {
  const rejestr = root?.[DELEGATES];
  if (!rejestr) return;
  for (const off of [...rejestr.values()]) off();
  rejestr.clear();
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
    return `<option value="${esc(value)}"${String(selected ?? '') === String(value) ? ' selected' : ''}>${esc(label)}</option>`;
  }).join('');
}

/** Lista podpowiedzi `<datalist>` dla pól tekstowych. */
export function datalist(id, values) {
  const unique = [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'pl'));
  return `<datalist id="${esc(id)}">${unique.map((v) => `<option value="${esc(v)}"></option>`).join('')}</datalist>`;
}

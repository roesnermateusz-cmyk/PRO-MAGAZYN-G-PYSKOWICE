/** Wspólne elementy interfejsu: powiadomienia, modale, nagłówki, tabele. */
import { esc, $ } from './dom.js';
import { ICONS } from '../components/icons.js';
// Główka wydruku potrzebuje nazwy firmy i zalogowanego użytkownika.
// Kierunek importu jest bezpieczny: `store` zależy od `api`, a `api` od
// `warehouse` — żaden z nich nie sięga z powrotem po warstwę interfejsu.
import { store } from './store.js';

/* ---------------------------- Powiadomienia --------------------------- */

let toastTimer = null;

/**
 * Krótkie powiadomienie na dole ekranu.
 * @param {string} message treść
 * @param {'ok'|'err'} [kind]
 */
export function toast(message, kind = 'ok') {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('err', kind === 'err');
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'err' ? 5200 : 2800);
}

/** Powiadomienie o błędzie z obiektu wyjątku. */
export function toastError(err) {
  toast(err?.message || 'Wystąpił nieoczekiwany błąd.', 'err');
}

/* -------------------------------- Modal ------------------------------- */

let modalCleanup = null;

/**
 * Otwiera modal.
 * @param {{title:string, body:string, footer?:string, onMount?:(box:HTMLElement)=>void}} options
 */
export function openModal({ title, body, footer = '', onMount }) {
  const bg = $('#modalBg');
  const box = $('#modalBox');
  box.innerHTML = `
    <div class="modal-h">
      <h2>${esc(title)}</h2>
      <button class="icon-btn" data-modal-close aria-label="Zamknij">${ICONS.close}</button>
    </div>
    <div class="modal-b">${body}</div>
    ${footer ? `<div class="modal-f">${footer}</div>` : ''}`;
  bg.classList.add('open');
  document.body.style.overflow = 'hidden';

  const close = (ev) => {
    if (ev.target.closest('[data-modal-close]') || ev.target === bg) closeModal();
  };
  const onKey = (ev) => { if (ev.key === 'Escape') closeModal(); };
  bg.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  modalCleanup = () => {
    bg.removeEventListener('click', close);
    document.removeEventListener('keydown', onKey);
  };

  onMount?.(box);
  box.querySelector('input, select, textarea, button:not([data-modal-close])')?.focus();
}

export function closeModal() {
  $('#modalBg').classList.remove('open');
  $('#modalBox').innerHTML = '';
  document.body.style.overflow = '';
  modalCleanup?.();
  modalCleanup = null;
}

/**
 * Modal potwierdzenia z opcjonalnym polem uzasadnienia.
 * @returns {Promise<string|null>} tekst uzasadnienia, pusty string lub `null` przy anulowaniu
 */
export function confirmDialog({ title, message, confirmLabel = 'Potwierdź', danger = false, reasonLabel = '' }) {
  return new Promise((resolve) => {
    openModal({
      title,
      body: `
        <p style="margin-bottom:${reasonLabel ? '14px' : '0'}">${esc(message)}</p>
        ${reasonLabel ? `
          <div class="fld">
            <label for="cd-reason">${esc(reasonLabel)}</label>
            <textarea id="cd-reason" rows="3" placeholder="Opisz powód — trafi do rejestru korekt."></textarea>
          </div>` : ''}`,
      footer: `
        <button class="btn" data-cd="cancel">Anuluj</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-cd="ok">${esc(confirmLabel)}</button>`,
      onMount(box) {
        box.querySelector('[data-cd="cancel"]').onclick = () => { closeModal(); resolve(null); };
        box.querySelector('[data-cd="ok"]').onclick = () => {
          const reason = box.querySelector('#cd-reason')?.value.trim() ?? '';
          closeModal();
          resolve(reason);
        };
      },
    });
  });
}

/* --------------------------- Podgląd załącznika ------------------------ */

export function showLightbox(url) {
  const box = $('#lightbox');
  $('#lightboxImg').src = url;
  box.classList.add('open');
  box.onclick = () => {
    box.classList.remove('open');
    $('#lightboxImg').src = '';
  };
}

/* ------------------------------- Szablony ------------------------------ */

/** Nagłówek strony z okruszkiem i przyciskami akcji. */
export function pageHead(title, crumb, actions = '') {
  return `<div class="page-head">
    <div><div class="crumb">${esc(crumb)}</div><h1>${esc(title)}</h1></div>
    <div class="page-actions">${actions}</div>
  </div>`;
}

/**
 * Główka wydruku — widoczna WYŁĄCZNIE na papierze i w PDF.
 *
 * Kartka wyjęta z drukarki musi bronić się sama. Bez tego nagłówka wydruk
 * stanu magazynu to anonimowa tabela liczb: nie wiadomo, czyja, na jaki
 * dzień, z jakiego magazynu ani kto ją wyciągnął — a właśnie taka kartka
 * trafia do segregatora i do kontroli.
 *
 * Data wydruku jest zapisywana w chwili renderowania widoku, nie w chwili
 * naciśnięcia „Drukuj”. Różnica to sekundy i nie ma znaczenia praktycznego,
 * a pozwala trzymać nagłówek zwykłym HTML-em zamiast dopisywać go do drzewa
 * tuż przed `window.print()`.
 *
 * @param {object} opts
 * @param {string} opts.title nazwa wydruku („Stany magazynowe”)
 * @param {string} [opts.scope] zakres: okres, magazyn, filtry
 * @param {string} [opts.note] dodatkowy wiersz (np. numer dokumentu)
 */
export function printHeader({ title, scope = '', note = '' }) {
  const firma = store.meta?.company ?? {};
  const kto = store.user?.fullName || store.user?.email || '—';
  const kiedy = new Date().toLocaleString('pl-PL', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  return `<div class="print-head">
    <div class="ph-top">
      <div>
        <div class="ph-firma">${esc(firma.name ?? 'ResInvest Commodities')}</div>
        ${firma.address ? `<div class="ph-adres">${esc(firma.address)}</div>` : ''}
      </div>
      <div class="ph-meta">
        <div>Wydruk: ${esc(kiedy)}</div>
        <div>Sporządził: ${esc(kto)}</div>
      </div>
    </div>
    <h2 class="ph-tytul">${esc(title)}</h2>
    ${scope ? `<div class="ph-zakres">${esc(scope)}</div>` : ''}
    ${note ? `<div class="ph-zakres">${esc(note)}</div>` : ''}
  </div>`;
}

/** Kafel wskaźnika. */
export function kpi({ label, value, unit = '', delta = '', icon = 'chart', variant = '' }) {
  return `<div class="kpi ${variant}">
    <div class="k-ic">${ICONS[icon] || ICONS.chart}</div>
    <div style="min-width:0">
      <div class="lab">${esc(label)}</div>
      <div class="val">${esc(value)}${unit ? `<small>${esc(unit)}</small>` : ''}</div>
      ${delta ? `<div class="delta">${delta}</div>` : ''}
    </div>
  </div>`;
}

/** Komunikat pustego zbioru. */
export function empty(title, hint = '') {
  return `<div class="empty"><b>${esc(title)}</b>${esc(hint)}</div>`;
}

export const loading = (text = 'Wczytywanie…') => `<div class="loading">${esc(text)}</div>`;

/** Pasek komunikatu (ostrzeżenie, informacja, błąd). */
export function alertBox(level, message) {
  const icon = { warning: ICONS.warn, danger: ICONS.warn, info: ICONS.info, success: ICONS.check }[level] || ICONS.info;
  return `<div class="alert ${level}">${icon}<div>${esc(message)}</div></div>`;
}

/** Pieczątka numeru dokumentu — kolor zależny od serii. */
export function docStamp(docNo) {
  const series = String(docNo || '').split('/')[0];
  return `<span class="stamp ${esc(series)}">${esc(docNo || '—')}</span>`;
}

export const typeTag = (type) => `<span class="tag ${esc(type)}">${esc(type)}</span>`;

/** Sterowanie stronicowaniem listy. */
export function pager({ total, limit, offset }, action = 'page') {
  if (total <= limit) return '';
  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  return `<div class="pager">
    <button class="btn btn-sm" data-${action}="prev" ${offset === 0 ? 'disabled' : ''}>← Poprzednie</button>
    <span>${from}–${to} z ${total}</span>
    <button class="btn btn-sm" data-${action}="next" ${to >= total ? 'disabled' : ''}>Następne →</button>
  </div>`;
}

/** Wskaźnik pryzmy (SVG) — wypełnienie proporcjonalne do stanu. */
let gaugeSeq = 0;

export function pileGauge(fraction, negative = false) {
  const f = Math.max(0, Math.min(1, Number(fraction) || 0));
  const H = 56;
  const W = 160;
  const clip = H * f;
  const shape = `M0 ${H} L${W * 0.30} 6 Q${W * 0.5} -4 ${W * 0.68} 10 L${W} ${H} Z`;
  // Identyfikator gradientu musi być unikalny — na stronie bywa kilkanaście pryzm.
  const gid = `pile-grad-${(gaugeSeq += 1)}`;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${gid}" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#4C9668"/><stop offset="1" stop-color="#8FC49B"/>
    </linearGradient></defs>
    <path d="${shape}" fill="#ECF1EA"/>
    <g clip-path="inset(${H - clip}px 0 0 0)">
      <path d="${shape}" fill="${negative ? '#E5BDB4' : `url(#${gid})`}"/>
    </g>
    <path d="M0 ${H} L${W * 0.30} 6 Q${W * 0.5} -4 ${W * 0.68} 10 L${W} ${H}" fill="none" stroke="#C7D4C5" stroke-width="1.2"/>
  </svg>`;
}
